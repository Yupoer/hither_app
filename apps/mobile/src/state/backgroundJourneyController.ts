import type { Coordinates } from '../types';
import type { TravelMode } from '../utils/geo';
import { locationPolicy } from '../utils/locationPolicy';

export const BACKGROUND_JOURNEY_TASK = 'hither-background-journey-location';
export const BACKGROUND_JOURNEY_KEY = '@hither/background-journey';

export interface BackgroundJourneyConfig {
  groupId: string;
  destinationId: string;
  destination: Coordinates;
  initialDistanceM: number;
  travelMode: TravelMode;
  /** Align background GPS with the foreground accuracy preference. */
  highAccuracy?: boolean;
}

interface PermissionResult {
  status: string;
}

export interface BackgroundLocationAdapter {
  requestForegroundPermissionsAsync(): Promise<PermissionResult>;
  requestBackgroundPermissionsAsync(): Promise<PermissionResult>;
  hasStartedLocationUpdatesAsync(taskName: string): Promise<boolean>;
  startLocationUpdatesAsync(taskName: string, options: object): Promise<void>;
  stopLocationUpdatesAsync(taskName: string): Promise<void>;
}

export interface BackgroundStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** expo-location Accuracy.Balanced = 3, Accuracy.High = 4 */
export function backgroundLocationOptions(highAccuracy: boolean): object {
  const policy = locationPolicy(highAccuracy);
  if (highAccuracy) {
    return {
      accuracy: 4,
      distanceInterval: 15,
      deferredUpdatesDistance: 25,
      deferredUpdatesInterval: 12_000,
      pausesUpdatesAutomatically: true,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Hither 導航中',
        notificationBody: '持續更新你與集合點的距離',
      },
    };
  }
  return {
    accuracy: 3,
    distanceInterval: policy.distanceInterval,
    deferredUpdatesDistance: 50,
    deferredUpdatesInterval: 30_000,
    pausesUpdatesAutomatically: true,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Hither 導航中',
      notificationBody: '持續更新你與集合點的距離',
    },
  };
}

export function createBackgroundJourneyController(
  location: BackgroundLocationAdapter,
  storage: BackgroundStorageAdapter,
) {
  return {
    async start(
      config: BackgroundJourneyConfig,
    ): Promise<'started' | 'permission_denied'> {
      const foreground = await location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') return 'permission_denied';

      const background = await location.requestBackgroundPermissionsAsync();
      if (background.status !== 'granted') return 'permission_denied';

      let previous: BackgroundJourneyConfig | null = null;
      const rawPrevious = await storage.getItem(BACKGROUND_JOURNEY_KEY);
      if (rawPrevious) {
        try {
          previous = JSON.parse(rawPrevious) as BackgroundJourneyConfig;
        } catch {
          previous = null;
        }
      }

      await storage.setItem(BACKGROUND_JOURNEY_KEY, JSON.stringify(config));
      const alreadyStarted = await location.hasStartedLocationUpdatesAsync(
        BACKGROUND_JOURNEY_TASK,
      );
      const nextHigh = Boolean(config.highAccuracy);
      const profileChanged =
        alreadyStarted && Boolean(previous?.highAccuracy) !== nextHigh;

      if (alreadyStarted && profileChanged) {
        await location.stopLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK);
      }
      if (!alreadyStarted || profileChanged) {
        await location.startLocationUpdatesAsync(
          BACKGROUND_JOURNEY_TASK,
          backgroundLocationOptions(nextHigh),
        );
      }
      return 'started';
    },

    async stop(): Promise<void> {
      const started = await location.hasStartedLocationUpdatesAsync(
        BACKGROUND_JOURNEY_TASK,
      );
      if (started) {
        await location.stopLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK);
      }
      await storage.removeItem(BACKGROUND_JOURNEY_KEY);
    },

    async load(): Promise<BackgroundJourneyConfig | null> {
      const raw = await storage.getItem(BACKGROUND_JOURNEY_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as BackgroundJourneyConfig;
      } catch {
        return null;
      }
    },
  };
}
