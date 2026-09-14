import { AppState } from 'react-native';
import { captureLocationAccess, isLocationAccessCurrent, subscribeLocationAccessChanges, isLocationAccessEnabled, setLocationSharingConsent, LOCATION_SHARING_KEY } from './locationPrivacy';
import { backgroundLocationAdapter, observeNativeBackgroundLocation, prepareNativeBackgroundLocation, nativeBackgroundAvailable } from '../native/backgroundLocation';
import { enqueueArrival } from './arrivalSync';
import { getCoreOperationOutbox, flushCoreOperationOutbox } from './coreDataSync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { updateLiveActivityProgress } from '../api/services/LiveActivityService';
import { ackNavigationSession, getBackgroundNavigationContext } from '../api/services/NavigationService';
import { liveActivity } from '../native';
import { distanceMeters } from '../utils/geo';
import {
  compactBackgroundTimeline,
  exceedsWatchdogBudget,
  nextBackgroundCallbackId,
  timeBackgroundStage,
  type BackgroundOpTimingEntry,
  type BackgroundOpTimeline,
} from '../utils/backgroundOpTiming';
import {
  createMotionState,
  locationPolicy,
  reduceMotionState,
  shouldUploadSample,
  type LocationGateState,
  type MotionState,
} from '../utils/locationPolicy';
import {
  createArrivalState,
  reduceArrival,
} from '../utils/navigationArrival';
import { derivePersonalProgress } from '../utils/personalProgress';
import {
  backgroundPresenceConfig,
  BACKGROUND_JOURNEY_TASK,
  createBackgroundJourneyController,
  resolveBackgroundTrackingMode,
  type BackgroundJourneyConfig,
} from './backgroundJourneyController';
import { diagnostics } from './diagnostics';
import {
  enqueueLocationOutbox,
  flushLocationOutbox,
  purgeLocationOutbox,
} from './locationOutbox';

interface BackgroundLocationTaskData {
  locations: Location.LocationObject[];
}

const controller = createBackgroundJourneyController(backgroundLocationAdapter, AsyncStorage);

/** Process-local gate so background batches don't spam upserts. */
let uploadGate: LocationGateState = { lastCoords: null, lastAtMs: 0 };
/** Motion cadence for dynamic background upload heartbeat. */
let motionState: MotionState = createMotionState();
let lastCloudProgressAt = 0;
let lastLocalProgressAt = 0;
let lastLocalProgressSignature = '';
let lastControlSyncAt = 0;
let controlSync: Promise<void> | null = null;
let latestSample: { epoch: number; timestamp: number } | null = null;

/**
 * Fire-and-forget timeline write. `totalMs` is wall clock for callback work only
 * (stages + untimed side paths timed into stages); the telemetry write itself
 * is intentionally not awaited so it cannot push the critical path over budget.
 * Completed callbacks keep success=true; budget headroom uses event + errorCode.
 */
function writeTimeline(
  timeline: BackgroundOpTimeline,
  navigationSessionId: string | null | undefined,
): void {
  const overBudget = exceedsWatchdogBudget(timeline.totalMs);
  void diagnostics
    .write({
      event: overBudget ? 'background_op_near_watchdog' : 'background_op_timeline',
      navigationSessionId: navigationSessionId ?? null,
      durationMs: timeline.totalMs,
      count: timeline.stages.length,
      // Slow-but-healthy is not a failure; event name + errorCode flag budget.
      success: true,
      errorCode: overBudget ? 'watchdog_budget' : undefined,
      source: 'background_task',
      // Allow-listed string only — stage names + ms, no coords/tokens.
      reason: compactBackgroundTimeline(timeline),
    })
    .catch(() => undefined);
}

async function processBackgroundLocations({ data, error }: { data?: BackgroundLocationTaskData; error?: unknown }): Promise<void> {
      const callbackStarted = Date.now();
      const stages: BackgroundOpTimingEntry[] = [];
      const callbackId = nextBackgroundCallbackId();
      let navigationSessionId: string | null | undefined;

      const finish = () => {
        if (stages.length === 0) return;
        // Measure wall clock after all callback work; do not await telemetry I/O.
        const timeline: BackgroundOpTimeline = {
          callbackId,
          startedAt: callbackStarted,
          stages,
          totalMs: Math.max(0, Date.now() - callbackStarted),
        };
        writeTimeline(timeline, navigationSessionId);
      };

      try {
        if (error) {
          await diagnostics.write({
            event: 'location_callback',
            success: false,
            errorCode: 'background_task_error',
            count: data?.locations?.length ?? 0,
            source: 'background_task',
          });
          return;
        }
        if (!data?.locations?.length) return;

        let config = await timeBackgroundStage(stages, 'config_load', () =>
          controller.load(),
        );
        if (!config || !controller.isCurrent(config)) return;
        if (Date.now() - lastControlSyncAt > 60_000) {
          await reconcileBackgroundNavigation(config.groupId).catch(() => undefined);
          config = await controller.load();
          if (!config || !controller.isCurrent(config)) return;
        }
        const access = await captureLocationAccess(config.groupId, true);
        if (!access || !config.sharingEnabled || config.hasMembership === false) {
          await stopBackgroundJourney();
          await purgeLocationOutbox();
          return;
        }
        if (AppState.currentState === 'active') return;
        navigationSessionId = config.navigationSessionId;

        const trackingMode = resolveBackgroundTrackingMode(config);
        const latest = data.locations[data.locations.length - 1];
        const coords = {
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
        };
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)
          || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) return;
        if (!Number.isFinite(latest.timestamp) || (latestSample && latestSample.epoch === config.trackingEpoch
          && latest.timestamp <= latestSample.timestamp)) return;
        latestSample = { epoch: config.trackingEpoch ?? 0, timestamp: latest.timestamp };
        const now = Date.now();
        const accuracyM = Math.max(0, latest.coords.accuracy ?? 0);
        const distanceM = distanceMeters(coords, config.destination);
        const previousArrival = config.arrivalState ??
          createArrivalState(config.initialDistanceM);
        const arrival = reduceArrival(
          previousArrival,
          { distanceM, accuracyM },
          { radiusM: config.arrivalRadiusMeters },
        );
        let arrivalConfirmed = false;
        if (arrival.status === 'arrived' && config.actorId && config.target && config.powerMode === 'journey') {
          const rows = await getCoreOperationOutbox().listByGroup(config.groupId);
          if (!controller.isCurrent(config) || !isLocationAccessCurrent(access)) return;
          const operation = rows.find(op => op.operationType === 'record_arrival'
            && op.entityId === config.destinationId && op.payload.actorId === config.actorId && op.payload.userId === config.actorId)
            ?? await enqueueArrival({ groupId: config.groupId, actorId: config.actorId, userId: config.actorId,
              destination: config.target, arrivedAt: new Date(latest.timestamp).toISOString(), completeSolo: config.completeSolo === true });
          arrivalConfirmed = operation.status !== 'conflict';
        }
        const sequence = config.sequence + 1;
        // Local Live Activity always updates from device GPS — works offline and
        // when cloud sharing is off. Upload is gated separately below.
        const progress = derivePersonalProgress({
          deviceCoords: coords,
          targetCoords: config.destination,
          initialDistanceM: config.initialDistanceM,
          distanceSource: config.distanceSource ?? 'fallback',
          startCoords: config.startCoords,
          hasDepartedStart: config.hasDepartedStart,
          previousProgressMax: config.previousProgressMax,
          travelMode: config.travelMode,
          routeAnchorGps: config.routeAnchorGps,
          routeAnchorRemainingM: config.routeAnchorRemainingM,
          routeEtaSeconds: config.etaSeconds,
          arrived: arrivalConfirmed,
        });
        const displayProgress = progress.progress ?? 0;
        const memberArrived = config.memberIds?.map((id, index) => id === config.actorId
          ? arrivalConfirmed : config.memberArrived?.[index] ?? false) ?? config.memberArrived;
        const stored = await timeBackgroundStage(stages, 'async_storage_write', () =>
          controller.update(config, {
            ...config, sequence, arrivalState: arrival, previousProgressMax: displayProgress, memberArrived,
          }),
        );
        if (!stored || !controller.isCurrent(config) || !isLocationAccessCurrent(access)) return;
        const displaySignature = JSON.stringify([config.navigationSessionId, arrival.status, memberArrived, config.accentHex]);
        if (config.powerMode === 'journey' && (displaySignature !== lastLocalProgressSignature || now - lastLocalProgressAt >= 10_000)) {
          lastLocalProgressSignature = displaySignature;
          lastLocalProgressAt = now;
          await timeBackgroundStage(stages, 'live_activity_update', () =>
          liveActivity.updateAllGroupActivities({
            groupName: config.groupName ?? '',
            gatheringTitle: config.gatheringTitle ?? config.groupName,
            navigationSessionId: config.navigationSessionId ?? undefined,
            status: 'active',
            distanceMeters: progress.distanceMeters ?? undefined,
            etaSeconds: progress.etaSeconds ?? undefined,
            accentHex: config.accentHex,
            progress: displayProgress,
            travelMode: config.travelMode,
            memberEmojis: config.memberEmojis,
            memberArrived,
            gatheredCount: memberArrived?.filter(Boolean).length,
            memberCount: config.memberEmojis?.length,
          }),
        );
        }
        if (!controller.isCurrent(config) || !isLocationAccessCurrent(access)) return;
        if (arrivalConfirmed) {
          // Durable local arrival first; uploads must never hold up the local surface.
          void flushCoreOperationOutbox().catch(() => undefined);
          if (config.completeSolo) {
            await liveActivity.endAllGroupActivities();
            await startBackgroundJourney(backgroundPresenceConfig(config));
            return;
          }
        }
        if (arrival.status !== previousArrival.status) {
          await timeBackgroundStage(stages, 'diagnostics_write', () =>
            diagnostics.write({
              event: arrival.status === 'arrived' ? 'arrival_confirmed' : 'arrival_candidate',
              navigationSessionId: config.navigationSessionId,
              accuracyM,
              distanceM,
              sequence,
            }),
          );
        }

        const uploadAllowed =
          config.sharingEnabled && trackingMode !== 'hidden';
        if (!uploadAllowed) {
          await timeBackgroundStage(stages, 'outbox_flush', () => purgeLocationOutbox());
          await timeBackgroundStage(stages, 'diagnostics_write', () =>
            diagnostics.write({
              event: 'location_rejected_sharing_disabled',
              source: 'background_task',
              navigationSessionId: config.navigationSessionId,
            }),
          );
          return;
        }

        const powerMode =
          trackingMode === 'passiveBackground' && config.powerMode === 'allDay'
            ? 'allDay'
            : 'journey';
        const policy = locationPolicy(
          trackingMode === 'teamNavigation' ||
            trackingMode === 'navigationMax' ||
            trackingMode === 'manualHighAccuracy' ||
            (powerMode === 'journey' && Boolean(config.highAccuracy)),
          powerMode,
        );
        motionState = reduceMotionState(motionState, coords, now, policy, accuracyM);
        const shouldUpload = shouldUploadSample(
          coords,
          now,
          uploadGate,
          policy,
          motionState.cadence,
        );
        if (!shouldUpload && arrival.status === previousArrival.status) {
          await timeBackgroundStage(stages, 'diagnostics_write', () =>
            diagnostics.write({
              event: 'location_rejected_distance',
              navigationSessionId: config.navigationSessionId,
              trackingMode,
              distanceM,
              accuracyM,
              sequence,
            }),
          );
          return;
        }

        if (!controller.isCurrent(config) || !isLocationAccessCurrent(access)) return;
        await timeBackgroundStage(stages, 'outbox_enqueue', () =>
          enqueueLocationOutbox({
            id: Crypto.randomUUID(),
            groupId: config.groupId,
            navigationSessionId: config.navigationSessionId,
            capturedAt: latest.timestamp,
            coords: {
              ...coords,
              accuracy: accuracyM,
              speed: latest.coords.speed,
              course: latest.coords.heading,
            },
            trackingMode,
            source: 'background_task',
            sequence,
          }),
        );
        await timeBackgroundStage(stages, 'diagnostics_write', () =>
          diagnostics.write({
            event: 'location_outbox_enqueued',
            navigationSessionId: config.navigationSessionId,
            trackingMode,
            source: 'background_task',
            sequence,
          }),
        );
        uploadGate = { lastCoords: coords, lastAtMs: now };
        const upload = await timeBackgroundStage(stages, 'outbox_flush', () =>
          flushLocationOutbox(),
        );
        if (upload.retryScheduled > 0) {
          await diagnostics.write({
            event: 'location_upload_failed',
            navigationSessionId: config.navigationSessionId,
            count: upload.retryScheduled,
            remaining: upload.remaining,
            errorCode: 'retry_scheduled',
            sequence,
          });
        } else if (upload.discarded > 0) {
          await diagnostics.write({
            event: 'location_upload_discarded',
            navigationSessionId: config.navigationSessionId,
            count: upload.discarded,
            remaining: upload.remaining,
            errorCode: 'permanent_reject',
            sequence,
          });
        }
        if (config.powerMode === 'journey' && controller.isCurrent(config) && isLocationAccessCurrent(access)
          && (arrival.status !== previousArrival.status || now - lastCloudProgressAt >= 30_000)) {
          lastCloudProgressAt = now;
          await updateLiveActivityProgress(config.groupId, config.destinationId, progress, config.accentHex, latest.timestamp).catch(() => undefined);
        }
        if (
          config.navigationSessionId &&
          arrival.status !== previousArrival.status &&
          arrival.status === 'arriving' && controller.isCurrent(config)
        ) {
          await timeBackgroundStage(stages, 'session_ack', () =>
            // The durable arrival RPC owns the final arrived ACK.
            ackNavigationSession(
              config.navigationSessionId!,
              'arriving',
              {
                distanceM,
                accuracyM,
                sequence,
              },
            ),
          );
        }

      } finally {
        finish();
      }
}

// Serialize/coalesce callbacks: never overlap arrival writes or replay an old batch.
let pendingBatch: { data?: BackgroundLocationTaskData; error?: unknown } | null = null;
let processing: Promise<void> | null = null;
export function handleBackgroundLocations(payload: { data?: BackgroundLocationTaskData; error?: unknown }): Promise<void> {
  pendingBatch = payload;
  if (!processing) processing = (async () => {
    while (pendingBatch) {
      const next = pendingBatch;
      pendingBatch = null;
      await processBackgroundLocations(next);
    }
  })().finally(() => { processing = null; });
  return processing;
}
if (!TaskManager.isTaskDefined(BACKGROUND_JOURNEY_TASK)) {
  TaskManager.defineTask<BackgroundLocationTaskData>(BACKGROUND_JOURNEY_TASK, handleBackgroundLocations);
}
observeNativeBackgroundLocation(sample => {
  void handleBackgroundLocations({ data: { locations: [sample] } }).catch(() => undefined);
});
subscribeLocationAccessChanges(() => {
  if (!isLocationAccessEnabled()) {
    pendingBatch = null;
    void stopBackgroundJourney().catch(() => undefined);
    void purgeLocationOutbox().catch(() => undefined);
  }
});


export async function startBackgroundJourney(
  config: BackgroundJourneyConfig,
): Promise<'started' | 'permission_denied' | 'hidden' | 'cancelled'> {
  const access = await captureLocationAccess(config.groupId);
  if (!access || !config.sharingEnabled || config.hasMembership === false) {
    await stopBackgroundJourney();
    return 'hidden';
  }
  const previous = await controller.load();
  if (previous?.navigationSessionId !== config.navigationSessionId || previous?.groupId !== config.groupId) {
    uploadGate = { lastCoords: null, lastAtMs: 0 };
    motionState = createMotionState();
    latestSample = null;
    lastLocalProgressSignature = '';
    lastLocalProgressAt = 0;
  }
  if (!isLocationAccessCurrent(access)) return 'cancelled';
  return controller.start(config);
}

export async function prepareBackgroundJourneyPermissions(allowPrompt = true): Promise<'ready' | 'permission_denied'> {
  const access = await captureLocationAccess();
  if (!access || AppState.currentState !== 'active') return 'permission_denied';
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();
  let ready = foreground.status === 'granted' && (nativeBackgroundAvailable || background.status === 'granted');
  if (!ready && allowPrompt) {
    const allowed = foreground.status === 'granted' || (await Location.requestForegroundPermissionsAsync()).status === 'granted';
    ready = allowed && (nativeBackgroundAvailable || (await Location.requestBackgroundPermissionsAsync()).status === 'granted');
  }
  if (!isLocationAccessCurrent(access) || AppState.currentState !== 'active') return 'permission_denied';
  if (ready) ready = await prepareNativeBackgroundLocation(true);
  return ready ? 'ready' : 'permission_denied';
}

export function stopBackgroundJourney(): Promise<void> {
  uploadGate = { lastCoords: null, lastAtMs: 0 };
  motionState = createMotionState();
  return controller.stop();
}

export function loadBackgroundJourney(): Promise<BackgroundJourneyConfig | null> {
  return controller.load();
}

/** Push + piggyback recovery only. No background timer or teammate-location reads. */
export function reconcileBackgroundNavigation(groupId: string): Promise<void> {
  if (controlSync) return controlSync;
  controlSync = (async () => {
    const access = await captureLocationAccess(groupId);
    if (!access || AppState.currentState === 'active') return;
    const config = await controller.load();
    if (!config || config.groupId !== groupId) return;
    lastControlSyncAt = Date.now();
    const next = await getBackgroundNavigationContext(groupId);
    if (!isLocationAccessCurrent(access) || !controller.isCurrent(config)) return;
    if (!next.hasMembership || next.actorId !== config.actorId || !next.sharingEnabled) {
      setLocationSharingConsent(false);
      if (!next.sharingEnabled) await AsyncStorage.setItem(LOCATION_SHARING_KEY, 'false');
      await stopBackgroundJourney();
      await purgeLocationOutbox();
      return;
    }
    if (!next.session || !next.target) {
      if (config.powerMode === 'journey') {
        await liveActivity.endAllGroupActivities();
        await startBackgroundJourney(backgroundPresenceConfig(config));
      }
      return;
    }
    if (next.session.id === config.navigationSessionId) return;
    const target = next.target;
    const initialDistanceM = uploadGate.lastCoords ? distanceMeters(uploadGate.lastCoords, target.coordinates) : 0;
    await startBackgroundJourney({ ...backgroundPresenceConfig(config), target,
      destinationId: target.id, destination: target.coordinates,
      navigationSessionId: next.session.id, sessionExpiresAt: next.session.expiresAt,
      gatheringTitle: target.title, powerMode: 'journey', teamNavigationActive: true,
      arrivalRadiusMeters: next.session.destination.arrivalRadiusMeters, initialDistanceM,
      distanceSource: 'fallback', memberArrived: config.memberIds?.map(() => false) });
    await liveActivity.observeExistingActivities();
  })().finally(() => { controlSync = null; });
  return controlSync;
}
