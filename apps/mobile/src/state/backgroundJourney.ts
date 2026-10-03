import { notifyJourneyApproach } from './journeyNotifications';
import { AppState } from 'react-native';
import type { LocationAccess } from './locationPrivacy';
import { captureLocationAccess, isLocationAccessCurrent, subscribeLocationAccessChanges, isLocationAccessEnabled, setLocationSharingConsent, LOCATION_SHARING_KEY } from './locationPrivacy';
import { backgroundLocationAdapter, observeNativeBackgroundLocation, prepareNativeBackgroundLocation, nativeBackgroundAvailable } from '../native/backgroundLocation';
import { enqueueArrival, projectArrivals } from './arrivalSync';
import { enqueueJourneyCompletion } from './journeyCompletion';
import { getCoreOperationOutbox, flushCoreOperationOutbox } from './coreDataSync';
import type { CoreOperation } from '../types/coreData';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { updateLiveActivityProgress } from '../api/services/LiveActivityService';
import { ackNavigationSession, getBackgroundNavigationContext } from '../api/services/NavigationService';
import { liveActivity } from '../native';
import { distanceMeters } from '../utils/geo';
import { canEvaluateSynchronizedArrival } from '../utils/synchronizedArrival';
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

/**
 * Foreground manual-undo tombstones survive the background task being
 * stopped while the app is active.  The marker is scoped to one destination
 * and navigation session; a released marker remains until that session is
 * replaced so a cold background launch cannot resurrect an old undo.
 */
export const BACKGROUND_MANUAL_UNDO_KEY = '@hither/background-manual-undo';
export interface BackgroundManualUndoMarker {
  actorId: string;
  groupId: string;
  destinationId: string;
  navigationSessionId: string;
  operationId?: string | null;
  occurredAt: string;
  suppressed: boolean;
}

function manualUndoMarkerKey(marker: Pick<BackgroundManualUndoMarker, 'actorId' | 'groupId' | 'destinationId' | 'navigationSessionId'>): string {
  return `${marker.actorId}:${marker.groupId}:${marker.destinationId}:${marker.navigationSessionId}`;
}

async function readManualUndoMarkers(): Promise<Record<string, BackgroundManualUndoMarker>> {
  try {
    const raw = await AsyncStorage.getItem(BACKGROUND_MANUAL_UNDO_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BackgroundManualUndoMarker>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeManualUndoMarker(marker: BackgroundManualUndoMarker): Promise<void> {
  try {
    const markers = await readManualUndoMarkers();
    markers[manualUndoMarkerKey(marker)] = marker;
    await AsyncStorage.setItem(BACKGROUND_MANUAL_UNDO_KEY, JSON.stringify(markers));
  } catch {
    // The durable arrival operation remains the source of truth if storage is
    // temporarily unavailable; background will still read its outbox marker.
  }
}

export function rememberBackgroundManualUndo(marker: BackgroundManualUndoMarker): Promise<void> {
  return writeManualUndoMarker({ ...marker, suppressed: true });
}

export function releaseBackgroundManualUndo(marker: BackgroundManualUndoMarker): Promise<void> {
  return writeManualUndoMarker({ ...marker, suppressed: false });
}

/**
 * Read the same account/session-scoped marker used by the native background
 * task. Foreground screens use this on mount/remount so a manual undo remains
 * effective even when the in-memory MapScreen refs were recreated.
 */
export async function loadBackgroundManualUndo(
  actorId: string,
  groupId: string,
  destinationId: string,
  navigationSessionId: string,
): Promise<BackgroundManualUndoMarker | null> {
  const markers = await readManualUndoMarkers();
  return markers[manualUndoMarkerKey({ actorId, groupId, destinationId, navigationSessionId })] ?? null;
}

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
let trackingGeneration = 0;

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

/** Re-read mutable owners after an awaited navigation/Live Activity teardown. */
function canContinueBackgroundSharing(config: BackgroundJourneyConfig, access: LocationAccess): boolean {
  return controller.isCurrent(config) && isLocationAccessCurrent(access)
    && AppState.currentState !== 'active';
}

async function processBackgroundLocations({ data, error }: { data?: BackgroundLocationTaskData; error?: unknown }, generation = trackingGeneration): Promise<void> {
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
        if (!config || generation !== trackingGeneration || !controller.isCurrent(config)) return;
        // Reuse real callbacks for control recovery; a journey needs timely target
        // changes, while passive presence retains its low-frequency owner.
        if (Date.now() - lastControlSyncAt >= (config.powerMode === 'journey' ? 15_000 : 150_000)) {
          await reconcileBackgroundNavigation(config.groupId, true).catch(() => undefined);
          config = await controller.load();
          if (!config || generation !== trackingGeneration || !controller.isCurrent(config)) return;
        }
        const access = await captureLocationAccess(config.groupId, true);
        if (generation !== trackingGeneration || !controller.isCurrent(config)) return;
        if (!access || !config.sharingEnabled || config.hasMembership === false) {
          await stopBackgroundJourney(false, config);
          await purgeLocationOutbox();
          return;
        }
        if (AppState.currentState === 'active' || generation !== trackingGeneration || !controller.isCurrent(config)) return;
        navigationSessionId = config.navigationSessionId;

        const trackingMode = resolveBackgroundTrackingMode(config);
        const latest = data.locations[data.locations.length - 1];
        const coords = {
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
        };
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)
          || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) return;
        if (!Number.isFinite(latest.timestamp) || latest.timestamp > Date.now() + 120_000
          || latest.timestamp <= (config.lastProcessedLocationAt ?? -Infinity)
          || (latestSample && latestSample.epoch === config.trackingEpoch
            && latest.timestamp <= latestSample.timestamp)) return;
        const now = Date.now();
        const accuracyM = latest.coords.accuracy ?? undefined;
        const freshArrivalFix = canEvaluateSynchronizedArrival({ sampledAt: latest.timestamp,
          now, accuracyM, radiusM: config.arrivalRadiusMeters });
        const distanceM = distanceMeters(coords, config.destination);
        // A foreground undo is a durable record_arrival(false). Background
        // callbacks can run after the tap (or on another process), so read
        // the same outbox and carry a per-operation suppression marker. The
        // marker is cleared only after a fix leaves the geofence; otherwise
        // the next callback would immediately re-create the arrival.
        // The background task may already be running when the foreground
        // records an undo. Read the account/session-scoped tombstone on every
        // callback so an ACK/compaction or a cold callback cannot resurrect
        // the old arrival from stale controller state.
        const persistedManualUndo = config.actorId && config.navigationSessionId && config.target
          ? await loadBackgroundManualUndo(
            config.actorId,
            config.groupId,
            config.destinationId,
            config.navigationSessionId,
          )
          : null;
        let manualUndoOperationId = persistedManualUndo?.operationId ?? config.manualUndoOperationId ?? null;
        let manualUndoOccurredAt = persistedManualUndo?.occurredAt ?? config.manualUndoOccurredAt ?? null;
        let manualUndoSuppressed = persistedManualUndo?.suppressed ?? config.manualUndoSuppressed === true;
        let arrivalRows: CoreOperation[] = [];
        if (config.actorId && config.target && config.navigationSessionId && config.powerMode === 'journey') {
          arrivalRows = await getCoreOperationOutbox().listByGroup(config.groupId);
          if (!controller.isCurrent(config) || !isLocationAccessCurrent(access)) return;
          const latestArrival = arrivalRows
            .filter(op => op.operationType === 'record_arrival'
              && op.entityId === config.destinationId
              && op.payload.actorId === config.actorId
              && op.payload.userId === config.actorId
              && (op.payload.navigationSessionId ?? null) === (config.navigationSessionId ?? null)
              && op.status !== 'conflict')
            .sort((a, b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt))
            .at(-1);
          if (latestArrival?.payload.arrived === false
            && latestArrival.id !== manualUndoOperationId) {
            manualUndoOperationId = latestArrival.id;
            manualUndoOccurredAt = typeof latestArrival.payload.occurredAt === 'string'
              ? latestArrival.payload.occurredAt
              : new Date(latestArrival.createdAt).toISOString();
            manualUndoSuppressed = true;
          }
          const undoTime = Date.parse(manualUndoOccurredAt ?? '');
          if (manualUndoSuppressed && freshArrivalFix && distanceM > config.arrivalRadiusMeters
            && (!Number.isFinite(undoTime) || latest.timestamp > undoTime)) {
            manualUndoSuppressed = false;
            await releaseBackgroundManualUndo({
              actorId: config.actorId,
              groupId: config.groupId,
              destinationId: config.destinationId,
              navigationSessionId: config.navigationSessionId,
              operationId: manualUndoOperationId,
              occurredAt: manualUndoOccurredAt ?? new Date().toISOString(),
              suppressed: false,
            });
          }
        }
        const previousArrival = config.arrivalState ??
          createArrivalState(config.initialDistanceM);
        const arrival = manualUndoSuppressed
          ? createArrivalState(distanceM)
          : freshArrivalFix && config.powerMode === 'journey' ? reduceArrival(
            previousArrival,
            { distanceM, accuracyM },
            { radiusM: config.arrivalRadiusMeters },
          ) : previousArrival;
        const latestPersonalArrival = arrivalRows.filter(op => op.operationType === 'record_arrival'
          && op.entityId === config.destinationId && op.payload.actorId === config.actorId
          && op.payload.userId === config.actorId && op.status !== 'conflict'
          && op.payload.navigationSessionId === config.navigationSessionId)
          .sort((a, b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt)).at(-1);
        const undoTime = Date.parse(manualUndoOccurredAt ?? '');
        let arrivalConfirmed = !manualUndoSuppressed && (latestPersonalArrival
          ? latestPersonalArrival.payload.arrived !== false && (!Number.isFinite(undoTime)
            || (typeof latestPersonalArrival.payload.occurredAt === 'string'
              && Date.parse(latestPersonalArrival.payload.occurredAt) > undoTime))
          : config.arrivedMemberIds?.includes(config.actorId ?? '') === true);
        if (!arrivalConfirmed && !manualUndoSuppressed && freshArrivalFix && arrival.status === 'arrived' && config.actorId && config.target && config.powerMode === 'journey') {
          const undoTime = manualUndoOccurredAt ? Date.parse(manualUndoOccurredAt) : Number.NaN;
          const operation = arrivalRows.find(op => op.operationType === 'record_arrival'
            && op.entityId === config.destinationId && op.payload.actorId === config.actorId && op.payload.userId === config.actorId
            && (op.payload.navigationSessionId ?? null) === (config.navigationSessionId ?? null)
            && op.payload.arrived !== false && op.status !== 'conflict'
            && (!Number.isFinite(undoTime)
              || (typeof op.payload.occurredAt === 'string'
                && Date.parse(op.payload.occurredAt) > undoTime)))
            ?? await enqueueArrival({ groupId: config.groupId, actorId: config.actorId, userId: config.actorId,
              navigationSessionId: config.navigationSessionId,
              destination: config.target, arrivedAt: new Date(latest.timestamp).toISOString(),
              occurredAt: new Date(latest.timestamp).toISOString(), completeSolo: config.completeSolo === true });
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
        const arrivedMemberIds = (config.arrivedMemberIds ?? []).filter(id => id !== config.actorId);
        if (arrivalConfirmed && config.actorId) arrivedMemberIds.push(config.actorId);
        const stored = await timeBackgroundStage(stages, 'async_storage_write', () =>
          controller.update(config, {
            ...config, sequence, arrivalState: arrival, previousProgressMax: displayProgress, memberArrived,
            arrivedMemberIds, lastProcessedLocationAt: latest.timestamp,
            manualUndoOperationId,
            manualUndoOccurredAt,
            manualUndoSuppressed,
          }),
        );
        if (!stored || !controller.isCurrent(config) || !isLocationAccessCurrent(access)) return;
        latestSample = { epoch: config.trackingEpoch ?? 0, timestamp: latest.timestamp };
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
        if (config.actorId && config.navigationSessionId) {
          const completionConfig = config;
          const completion = await enqueueJourneyCompletion({
            groupId: config.groupId, destinationId: config.destinationId,
            navigationSessionId: config.navigationSessionId, actorId: config.actorId,
            scopeSubgroupId: config.scopeSubgroupId, leaderId: config.leaderId,
            navigationMemberIds: config.navigationMemberIds ?? [], arrivedMemberIds,
            isCurrent: () => controller.isCurrent(completionConfig) && isLocationAccessCurrent(access),
          });
          if (completion && completion.status !== 'conflict'
            && controller.isCurrent(config) && isLocationAccessCurrent(access)) {
            await liveActivity.endAllGroupActivities();
            if (canContinueBackgroundSharing(config, access)) await startBackgroundJourney(backgroundPresenceConfig(config));
            return;
          }
        }
        if (freshArrivalFix && config.powerMode === 'journey') {
          await notifyJourneyApproach(config.navigationSessionId, config.destinationId, config.gatheringTitle ?? '', {
            remainingM: progress.distanceMeters ?? distanceM, totalM: config.initialDistanceM,
            arrivalRadiusM: config.arrivalRadiusMeters, arrived: arrivalConfirmed, alreadyFired: false,
          }).catch(() => undefined);
        }
        if (arrivalConfirmed) {
          // Durable local arrival first; uploads must never hold up the local surface.
          void flushCoreOperationOutbox().catch(() => undefined);
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

        const powerMode = config.powerMode ?? 'journey';
        const policy = locationPolicy(
          // Team navigation explains why the journey is active; it does not
          // silently opt the user into precise/high-frequency uploads.
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
        if (controller.isCurrent(config) && isLocationAccessCurrent(access)
          && await AsyncStorage.getItem('@hither/pending-location-refresh')) {
          const { recoverPendingLocationRefreshFromSample } = await import('./backgroundLocationRefresh');
          await recoverPendingLocationRefreshFromSample(config.groupId, {
            timestamp: latest.timestamp, coordinates: coords, accuracy: accuracyM,
          }).catch(() => undefined);
        }
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

// Native batches may contain a brief geofence entry followed by an exit.
// Keep every fix and serialize callbacks so durable arrival writes cannot overlap.
const pendingBatches: { payload: { data?: BackgroundLocationTaskData; error?: unknown }; generation: number }[] = [];
let processing: Promise<void> | null = null;
export function handleBackgroundLocations(payload: { data?: BackgroundLocationTaskData; error?: unknown }): Promise<void> {
  pendingBatches.push({ payload, generation: trackingGeneration });
  if (!processing) processing = (async () => {
    let failure: unknown;
    while (pendingBatches.length) {
      const next = pendingBatches.shift()!;
      if (next.generation !== trackingGeneration) continue;
      if (next.payload.error || !next.payload.data?.locations.length) {
        await processBackgroundLocations(next.payload, next.generation);
        continue;
      }
      for (const location of [...next.payload.data.locations].sort((a, b) => a.timestamp - b.timestamp)) {
        if (next.generation !== trackingGeneration) break;
        try {
          await processBackgroundLocations({ data: { locations: [location] } }, next.generation);
        } catch (error) {
          // A failed durable write must not discard the remaining native fixes.
          failure ??= error;
        }
      }
    }
    if (failure) throw failure;
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
    pendingBatches.length = 0;
    void stopBackgroundJourney().catch(() => undefined);
    void purgeLocationOutbox().catch(() => undefined);
  }
});


export async function startBackgroundJourney(
  config: BackgroundJourneyConfig,
): Promise<'started' | 'permission_denied' | 'hidden' | 'cancelled'> {
  config = config.powerMode === 'allDay' || !config.navigationSessionId
    ? backgroundPresenceConfig(config) : config;
  const generation = ++trackingGeneration;
  const access = await captureLocationAccess(config.groupId);
  if (generation !== trackingGeneration) return 'cancelled';
  if (!access || !config.sharingEnabled || config.hasMembership === false) {
    await stopBackgroundJourney(true);
    return 'hidden';
  }
  const manualUndo = config.actorId && config.navigationSessionId
    ? await loadBackgroundManualUndo(config.actorId, config.groupId, config.destinationId, config.navigationSessionId)
    : null;
  if (generation !== trackingGeneration) return 'cancelled';
  const effectiveConfig = manualUndo
    ? {
        ...config,
        manualUndoOperationId: manualUndo.operationId ?? config.manualUndoOperationId,
        manualUndoOccurredAt: manualUndo.occurredAt,
        manualUndoSuppressed: manualUndo.suppressed,
      }
    : config;
  const previous = await controller.load();
  if (generation !== trackingGeneration) return 'cancelled';
  if (previous?.navigationSessionId !== effectiveConfig.navigationSessionId || previous?.groupId !== effectiveConfig.groupId
    || previous?.actorId !== effectiveConfig.actorId || previous?.scopeSubgroupId !== effectiveConfig.scopeSubgroupId) {
    uploadGate = { lastCoords: null, lastAtMs: 0 };
    motionState = createMotionState();
    latestSample = null;
    lastLocalProgressSignature = '';
    lastLocalProgressAt = 0;
  }
  if (!isLocationAccessCurrent(access)) return 'cancelled';
  return controller.start(effectiveConfig);
}

export async function prepareBackgroundJourneyPermissions(allowPrompt = true): Promise<'ready' | 'permission_denied'> {
  const access = await captureLocationAccess();
  if (!access || AppState.currentState !== 'active') return 'permission_denied';
  // iOS liveUpdates needs its activity session created while foregrounded.
  // Prepare before permission reads yield, so already-granted users can safely
  // finish those reads after locking without discarding a prepared owner.
  let nativePrepared = await prepareNativeBackgroundLocation(true);
  if (!isLocationAccessCurrent(access)) return 'permission_denied';
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();
  let ready = foreground.status === 'granted' && (nativeBackgroundAvailable || background.status === 'granted');
  if (!ready && allowPrompt) {
    if (!isLocationAccessCurrent(access) || AppState.currentState !== 'active') return 'permission_denied';
    const allowed = foreground.status === 'granted' || (await Location.requestForegroundPermissionsAsync()).status === 'granted';
    if (!isLocationAccessCurrent(access) || AppState.currentState !== 'active') return 'permission_denied';
    ready = allowed && (nativeBackgroundAvailable || (await Location.requestBackgroundPermissionsAsync()).status === 'granted');
  }
  if (!ready || !isLocationAccessCurrent(access)) return 'permission_denied';
  // A first-time grant may have made the initial native preparation fail.
  // Retry only in the foreground; permission alone cannot create a native
  // activity session after the app has already entered the background.
  if (!nativePrepared) {
    if (AppState.currentState !== 'active') return 'permission_denied';
    nativePrepared = await prepareNativeBackgroundLocation(true);
  }
  return nativePrepared && isLocationAccessCurrent(access) ? 'ready' : 'permission_denied';
}

export async function stopBackgroundJourney(releaseSession = false, expected?: BackgroundJourneyConfig): Promise<void> {
  if (expected && !controller.isCurrent(expected)) return;
  const generation = ++trackingGeneration;
  uploadGate = { lastCoords: null, lastAtMs: 0 };
  motionState = createMotionState();
  await controller.stop(expected);
  if (releaseSession && generation === trackingGeneration) await prepareNativeBackgroundLocation(false);
}

export function loadBackgroundJourney(): Promise<BackgroundJourneyConfig | null> {
  return controller.load();
}

/** Push + piggyback recovery only. No background timer or teammate-location reads. */
export function reconcileBackgroundNavigation(groupId: string, fromLocationTask = false): Promise<void> {
  if (processing && !fromLocationTask) {
    return processing.then(() => reconcileBackgroundNavigation(groupId), () => reconcileBackgroundNavigation(groupId));
  }
  if (controlSync) return controlSync;
  controlSync = (async () => {
    const access = await captureLocationAccess(groupId);
    if (!access || AppState.currentState === 'active') return;
    const config = await controller.load();
    if (!config || config.groupId !== groupId) return;
    lastControlSyncAt = Date.now();
    const next = await getBackgroundNavigationContext(groupId, config.scopeSubgroupId);
    if (!isLocationAccessCurrent(access) || !controller.isCurrent(config)) return;
    if (!next.hasMembership || next.actorId !== config.actorId || !next.sharingEnabled) {
      setLocationSharingConsent(false);
      if (!next.sharingEnabled) await AsyncStorage.setItem(LOCATION_SHARING_KEY, 'false');
      await stopBackgroundJourney(false, config);
      await purgeLocationOutbox();
      return;
    }
    if (!next.session || !next.target) {
      if (config.powerMode === 'journey') {
        await liveActivity.endAllGroupActivities();
        if (canContinueBackgroundSharing(config, access)) await startBackgroundJourney(backgroundPresenceConfig(config));
      }
      return;
    }
    if (next.session.id === config.navigationSessionId) {
      if (!next.navigationMemberIds || !next.arrivedMemberIds) return;
      const operations = await getCoreOperationOutbox().listByGroup(groupId);
      if (!controller.isCurrent(config) || !isLocationAccessCurrent(access)) return;
      const arrivedMemberIds = projectArrivals(next.arrivedMemberIds.map(userId => ({
        id: userId, groupId, destinationId: config.destinationId, userId,
        arrivedAt: null, source: 'manual' as const, markedBy: userId,
        navigationSessionId: next.session!.id,
      })), operations, next.actorId, next.session.id).map(row => row.userId);
      const undo = await loadBackgroundManualUndo(next.actorId, groupId, config.destinationId, next.session.id);
      if (undo?.suppressed) {
        const actorIndex = arrivedMemberIds.indexOf(next.actorId);
        if (actorIndex >= 0) arrivedMemberIds.splice(actorIndex, 1);
      }
      if (!controller.isCurrent(config) || !isLocationAccessCurrent(access)) return;
      const memberArrived = config.memberIds?.map(id => arrivedMemberIds.includes(id));
      const stored = await controller.update(config, { ...config,
        sequence: config.sequence + 1,
        navigationMemberIds: next.navigationMemberIds,
        arrivedMemberIds, leaderId: next.leaderId, memberArrived,
      });
      if (!stored || !controller.isCurrent(config) || !isLocationAccessCurrent(access)) return;
      const completion = await enqueueJourneyCompletion({
        groupId, destinationId: config.destinationId, navigationSessionId: next.session.id,
        actorId: next.actorId, scopeSubgroupId: config.scopeSubgroupId, leaderId: next.leaderId,
        navigationMemberIds: next.navigationMemberIds, arrivedMemberIds,
        isCurrent: () => controller.isCurrent(config) && isLocationAccessCurrent(access),
      });
      if (completion && completion.status !== 'conflict'
        && controller.isCurrent(config) && isLocationAccessCurrent(access)) {
        await liveActivity.endAllGroupActivities();
        if (canContinueBackgroundSharing(config, access)) await startBackgroundJourney(backgroundPresenceConfig(config));
      }
      return;
    }
    const target = next.target;
    const initialDistanceM = uploadGate.lastCoords ? distanceMeters(uploadGate.lastCoords, target.coordinates) : 0;
    await startBackgroundJourney({ ...backgroundPresenceConfig(config), target,
      scopeSubgroupId: target.subgroupId ?? config.scopeSubgroupId ?? null,
      destinationId: target.id, destination: target.coordinates,
      navigationSessionId: next.session.id, sessionExpiresAt: next.session.expiresAt,
      gatheringTitle: target.title, powerMode: 'journey', teamNavigationActive: true,
      navigationMemberIds: next.navigationMemberIds, arrivedMemberIds: next.arrivedMemberIds,
      leaderId: next.leaderId,
      arrivalRadiusMeters: next.session.destination.arrivalRadiusMeters, initialDistanceM,
      distanceSource: 'fallback', memberArrived: config.memberIds?.map(() => false) });
    await liveActivity.observeExistingActivities();
  })().finally(() => { controlSync = null; });
  return controlSync;
}
