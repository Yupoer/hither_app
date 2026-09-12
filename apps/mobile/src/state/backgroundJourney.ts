import { enqueueArrival } from './arrivalSync';
import { getCoreOperationOutbox, flushCoreOperationOutbox } from './coreDataSync';
import { fetchDestinationArrivals } from '../api/services/GatheringWorkflowService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { updateLiveActivityProgress } from '../api/services/LiveActivityService';
import { ackNavigationSession } from '../api/services/NavigationService';
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

const controller = createBackgroundJourneyController(Location, AsyncStorage);

/** Process-local gate so background batches don't spam upserts. */
let uploadGate: LocationGateState = { lastCoords: null, lastAtMs: 0 };
/** Motion cadence for dynamic background upload heartbeat. */
let motionState: MotionState = createMotionState();
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

if (!TaskManager.isTaskDefined(BACKGROUND_JOURNEY_TASK)) {
  TaskManager.defineTask<BackgroundLocationTaskData>(
    BACKGROUND_JOURNEY_TASK,
    async ({ data, error }) => {
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

        const config = await timeBackgroundStage(stages, 'config_load', () =>
          controller.load(),
        );
        if (!config || !controller.isCurrent(config)) return;
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
          if (!controller.isCurrent(config)) return;
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
        if (!stored || !controller.isCurrent(config)) return;
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
        if (!controller.isCurrent(config)) return;
        if (arrivalConfirmed) {
          // Durable local arrival first; uploads must never hold up the local surface.
          void flushCoreOperationOutbox().catch(() => undefined);
          if (config.completeSolo) {
            await liveActivity.endAllGroupActivities();
            await controller.stop(config);
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
        motionState = reduceMotionState(motionState, coords, now, policy);
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

        if (!controller.isCurrent(config)) return;
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
        await updateLiveActivityProgress(config.groupId, config.destinationId, progress, config.accentHex, latest.timestamp)
          .catch(() => undefined);
        if (config.memberIds && controller.isCurrent(config)) {
          const arrivals = await fetchDestinationArrivals(config.groupId).catch(() => null);
          if (arrivals) await controller.update(config, {
            ...config, sequence, arrivalState: arrival, previousProgressMax: displayProgress,
            memberArrived: config.memberIds.map(id => id === config.actorId ? arrivalConfirmed
              : arrivals.some(a => a.destinationId === config.destinationId && a.userId === id)),
          });
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
    },
  );
}

export function startBackgroundJourney(
  config: BackgroundJourneyConfig,
): Promise<'started' | 'permission_denied' | 'hidden' | 'cancelled'> {
  return controller.start(config);
}

export function prepareBackgroundJourneyPermissions(): Promise<'ready' | 'permission_denied'> {
  return controller.preparePermissions();
}

export function stopBackgroundJourney(): Promise<void> {
  uploadGate = { lastCoords: null, lastAtMs: 0 };
  motionState = createMotionState();
  return controller.stop();
}

export function loadBackgroundJourney(): Promise<BackgroundJourneyConfig | null> {
  return controller.load();
}
