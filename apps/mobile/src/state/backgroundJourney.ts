import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  locationPolicy,
  shouldUploadSample,
  type LocationGateState,
} from '../utils/locationPolicy';
import {
  BACKGROUND_JOURNEY_TASK,
  createBackgroundJourneyController,
  resolveBackgroundTrackingMode,
  type BackgroundJourneyConfig,
} from './backgroundJourneyController';
import {
  enqueueLocationOutbox,
  flushLocationOutbox,
} from './locationOutbox';

interface BackgroundLocationTaskData {
  locations: Location.LocationObject[];
}

const controller = createBackgroundJourneyController(Location, AsyncStorage);

/** Process-local gate so background batches don't spam upserts. */
let uploadGate: LocationGateState = { lastCoords: null, lastAtMs: 0 };

if (!TaskManager.isTaskDefined(BACKGROUND_JOURNEY_TASK)) {
  TaskManager.defineTask<BackgroundLocationTaskData>(
    BACKGROUND_JOURNEY_TASK,
    async ({ data, error }) => {
      if (error || !data?.locations?.length) return;
      const config = await controller.load();
      if (!config) return;

      const trackingMode = resolveBackgroundTrackingMode(config);
      if (trackingMode === 'hidden') return;

      const latest = data.locations[data.locations.length - 1];
      const coords = {
        latitude: latest.coords.latitude,
        longitude: latest.coords.longitude,
      };
      const now = Date.now();
      await flushLocationOutbox().catch(() => undefined);
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
      if (!shouldUploadSample(coords, now, uploadGate, policy)) return;

      await enqueueLocationOutbox({
        groupId: config.groupId,
        coordinates: coords,
        capturedAt: latest.timestamp,
      });
      uploadGate = { lastCoords: coords, lastAtMs: now };
      await flushLocationOutbox().catch(() => undefined);
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
  return controller.stop();
}

export function loadBackgroundJourney(): Promise<BackgroundJourneyConfig | null> {
  return controller.load();
}
