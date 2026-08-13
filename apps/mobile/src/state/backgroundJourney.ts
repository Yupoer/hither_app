import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
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
import {
  BACKGROUND_JOURNEY_TASK,
  BACKGROUND_JOURNEY_KEY,
  createBackgroundJourneyController,
  resolveBackgroundTrackingMode,
  type BackgroundJourneyConfig,
} from './backgroundJourneyController';
import { diagnostics } from './diagnostics';
import { clearLiveActivities } from './useLiveActivity';
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
        if (!config) return;
        navigationSessionId = config.navigationSessionId;

        const trackingMode = resolveBackgroundTrackingMode(config);
        const latest = data.locations[data.locations.length - 1];
        const coords = {
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
        };
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
        const sequence = config.sequence + 1;
        await timeBackgroundStage(stages, 'async_storage_write', () =>
          AsyncStorage.setItem(
            BACKGROUND_JOURNEY_KEY,
            JSON.stringify({ ...config, sequence, arrivalState: arrival }),
          ),
        );
        // Local Live Activity always updates from device GPS — works offline and
        // when cloud sharing is off. Upload is gated separately below.
        await timeBackgroundStage(stages, 'live_activity_update', () =>
          liveActivity.updateAllGroupActivities({
            groupName: '',
            navigationSessionId: config.navigationSessionId ?? undefined,
            status: 'active',
            distanceMeters: distanceM,
            progress: arrival.progress,
            travelMode: config.travelMode,
          }),
        );
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
        if (!shouldUpload && arrival.status === 'enRoute') {
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
        if (
          config.navigationSessionId &&
          arrival.status !== previousArrival.status &&
          (arrival.status === 'arriving' || arrival.status === 'arrived')
        ) {
          await timeBackgroundStage(stages, 'session_ack', () =>
            // ArrivalStatus includes enRoute; branch above already narrows to arriving|arrived.
            ackNavigationSession(
              config.navigationSessionId!,
              arrival.status === 'arrived' ? 'arrived' : 'arriving',
              {
                distanceM,
                accuracyM,
                sequence,
              },
            ).catch(() => undefined),
          );
        }
        if (config.navigationSessionId && arrival.status === 'arrived') {
          // A background arrival ends both local activities and the matching
          // Supabase rows; the closed itinerary point remains historical.
          await timeBackgroundStage(stages, 'clear_live_activities', () =>
            clearLiveActivities({ groupIds: [config.groupId] }),
          );
          await timeBackgroundStage(stages, 'async_storage_write', () =>
            AsyncStorage.setItem(
              BACKGROUND_JOURNEY_KEY,
              JSON.stringify({
                ...config,
                navigationSessionId: null,
                teamNavigationActive: false,
                powerMode: 'allDay',
                arrivalState: arrival,
              }),
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
): Promise<'started' | 'permission_denied' | 'hidden'> {
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
