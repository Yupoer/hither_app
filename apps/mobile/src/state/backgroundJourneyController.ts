import type { Coordinates } from '../types';
import type { TravelMode } from '../utils/geo';

export const BACKGROUND_JOURNEY_TASK = 'hither-background-journey-location';
export const BACKGROUND_JOURNEY_KEY = '@hither/background-journey';

export interface BackgroundJourneyConfig {
  groupId: string;
  destinationId: string;
  destination: Coordinates;
  initialDistanceM: number;
  travelMode: TravelMode;
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

      await storage.setItem(BACKGROUND_JOURNEY_KEY, JSON.stringify(config));
      const alreadyStarted = await location.hasStartedLocationUpdatesAsync(
        BACKGROUND_JOURNEY_TASK,
      );
      if (!alreadyStarted) {
        await location.startLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK, {
          accuracy: 4,
          distanceInterval: 15,
          deferredUpdatesDistance: 30,
          deferredUpdatesInterval: 15_000,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Hither 導航中',
            notificationBody: '持續更新你與集合點的距離',
          },
        });
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
