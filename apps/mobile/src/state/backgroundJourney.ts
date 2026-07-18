import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ackNavigationSession } from '../api/services/NavigationService';
import { liveActivity } from '../native';
import { distanceMeters } from '../utils/geo';
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

if (!TaskManager.isTaskDefined(BACKGROUND_JOURNEY_TASK)) {
  TaskManager.defineTask<BackgroundLocationTaskData>(
    BACKGROUND_JOURNEY_TASK,
    async ({ data, error }) => {
      await diagnostics.write({
        event: 'location_callback',
        success: !error && Boolean(data?.locations?.length),
        errorCode: error ? 'background_task_error' : undefined,
        count: data?.locations?.length ?? 0,
        source: 'background_task',
      });
      if (error || !data?.locations?.length) return;
      const config = await controller.load();
      if (!config) return;

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
      await AsyncStorage.setItem(
        BACKGROUND_JOURNEY_KEY,
        JSON.stringify({ ...config, sequence, arrivalState: arrival }),
      );
      // Local Live Activity always updates from device GPS — works offline and
      // when cloud sharing is off. Upload is gated separately below.
      await liveActivity.updateAllGroupActivities({
        groupName: '',
        navigationSessionId: config.navigationSessionId ?? undefined,
        status: 'active',
        distanceMeters: distanceM,
        progress: arrival.progress,
        travelMode: config.travelMode,
      });
      if (arrival.status !== previousArrival.status) {
        await diagnostics.write({
          event: arrival.status === 'arrived' ? 'arrival_confirmed' : 'arrival_candidate',
          navigationSessionId: config.navigationSessionId,
          accuracyM,
          distanceM,
          sequence,
        });
      }

      const uploadAllowed =
        config.sharingEnabled && trackingMode !== 'hidden';
      if (!uploadAllowed) {
        await purgeLocationOutbox();
        await diagnostics.write({
          event: 'location_rejected_sharing_disabled',
          source: 'background_task',
          navigationSessionId: config.navigationSessionId,
        });
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
        await diagnostics.write({
          event: 'location_rejected_distance',
          navigationSessionId: config.navigationSessionId,
          trackingMode,
          distanceM,
          accuracyM,
          sequence,
        });
        return;
      }

      await enqueueLocationOutbox({
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
      });
      await diagnostics.write({
        event: 'location_outbox_enqueued',
        navigationSessionId: config.navigationSessionId,
        trackingMode,
        source: 'background_task',
        sequence,
      });
      uploadGate = { lastCoords: coords, lastAtMs: now };
      await diagnostics.write({
        event: 'location_upload_started',
        navigationSessionId: config.navigationSessionId,
        sequence,
      });
      const upload = await flushLocationOutbox();
      await diagnostics.write({
        event: upload.sent > 0 ? 'location_upload_succeeded' : 'location_upload_failed',
        navigationSessionId: config.navigationSessionId,
        sent: upload.sent,
        remaining: upload.remaining,
        errorCode: upload.sent > 0 ? undefined : 'pending_retry',
        sequence,
      });
      if (
        config.navigationSessionId &&
        arrival.status !== previousArrival.status &&
        (arrival.status === 'arriving' || arrival.status === 'arrived')
      ) {
        await ackNavigationSession(config.navigationSessionId, arrival.status, {
          distanceM,
          accuracyM,
          sequence,
        }).catch(() => undefined);
      }
      if (config.navigationSessionId && arrival.status === 'arrived') {
        // A background arrival ends both local activities and the matching
        // Supabase rows; the closed itinerary point remains historical.
        await clearLiveActivities({ groupIds: [config.groupId] });
        await AsyncStorage.setItem(
          BACKGROUND_JOURNEY_KEY,
          JSON.stringify({
            ...config,
            navigationSessionId: null,
            teamNavigationActive: false,
            powerMode: 'allDay',
            arrivalState: arrival,
          }),
        );
      }
      await diagnostics.flush().catch(() => undefined);
    },
  );
}

export function startBackgroundJourney(
  config: BackgroundJourneyConfig,
): Promise<'started' | 'permission_denied' | 'hidden'> {
  return controller.start(config);
}

export function stopBackgroundJourney(): Promise<void> {
  uploadGate = { lastCoords: null, lastAtMs: 0 };
  motionState = createMotionState();
  return controller.stop();
}

export function loadBackgroundJourney(): Promise<BackgroundJourneyConfig | null> {
  return controller.load();
}
