import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { updateMyLocation } from '../api/services/LocationService';
import {
  BACKGROUND_JOURNEY_TASK,
  createBackgroundJourneyController,
  type BackgroundJourneyConfig,
} from './backgroundJourneyController';

interface BackgroundLocationTaskData {
  locations: Location.LocationObject[];
}

const controller = createBackgroundJourneyController(Location, AsyncStorage);

if (!TaskManager.isTaskDefined(BACKGROUND_JOURNEY_TASK)) {
  TaskManager.defineTask<BackgroundLocationTaskData>(
    BACKGROUND_JOURNEY_TASK,
    async ({ data, error }) => {
      if (error || !data?.locations?.length) return;
      const config = await controller.load();
      if (!config) return;

      const latest = data.locations[data.locations.length - 1];
      await updateMyLocation(
        {
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
        },
        config.groupId,
      );
    },
  );
}

export function startBackgroundJourney(
  config: BackgroundJourneyConfig,
): Promise<'started' | 'permission_denied'> {
  return controller.start(config);
}

export function stopBackgroundJourney(): Promise<void> {
  return controller.stop();
}

export function loadBackgroundJourney(): Promise<BackgroundJourneyConfig | null> {
  return controller.load();
}
