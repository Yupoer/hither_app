import type { Coordinates } from '../types';
import type { TravelMode } from '../utils/geo';
import {
  locationPolicy,
  type LocationPowerMode,
} from '../utils/locationPolicy';

export const BACKGROUND_JOURNEY_TASK = 'hither-background-journey-location';
export const BACKGROUND_JOURNEY_KEY = '@hither/background-journey';

export interface BackgroundJourneyConfig {
  groupId: string;
  destinationId: string;
  destination: Coordinates;
  initialDistanceM: number;
  travelMode: TravelMode;
  /**
   * Only meaningful for `powerMode: 'journey'`.
   * All-day presence always uses the Low-accuracy budget profile.
   */
  highAccuracy?: boolean;
  /**
   * `allDay` — 8h≈20% budget group presence.
   * `journey` — denser nav tracking while going to a point.
   */
  powerMode?: 'allDay' | 'journey';
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

/**
 * expo-location Accuracy: Lowest=1 Low=2 Balanced=3 High=4 Highest=5 BestForNavigation=6
 * Options tuned for the power budget — see locationPolicy POWER_BUDGET_NOTE.
 */
export function backgroundLocationOptions(
  powerMode: 'allDay' | 'journey',
  highAccuracy: boolean,
): object {
  const mode: LocationPowerMode = powerMode;
  // Never allow highAccuracy to override allDay (budget).
  const policy = locationPolicy(
    powerMode === 'allDay' ? false : highAccuracy,
    mode,
  );

  const accuracyCode =
    policy.accuracy === 'high' ? 4 : policy.accuracy === 'low' ? 2 : 3;

  const deferredInterval =
    powerMode === 'allDay' ? 180_000 : highAccuracy ? 20_000 : 60_000;
  const deferredDistance =
    powerMode === 'allDay' ? 150 : highAccuracy ? 30 : 60;

  return {
    accuracy: accuracyCode,
    distanceInterval: policy.distanceInterval,
    timeInterval: policy.timeInterval,
    deferredUpdatesDistance: deferredDistance,
    deferredUpdatesInterval: deferredInterval,
    // Critical for 8h budget: let OS freeze GPS when the user is still.
    pausesUpdatesAutomatically: true,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle:
        powerMode === 'allDay' ? 'Hither 群組定位中' : 'Hither 導航中',
      notificationBody:
        powerMode === 'allDay'
          ? '以省電模式更新你在群組中的位置'
          : '持續更新你與集合點的距離',
    },
  };
}

function powerProfileKey(config: BackgroundJourneyConfig): string {
  const mode = config.powerMode ?? 'journey';
  const high = mode === 'allDay' ? false : Boolean(config.highAccuracy);
  return `${mode}:${high ? 'h' : 'n'}`;
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
      const profileChanged =
        alreadyStarted &&
        previous != null &&
        powerProfileKey(previous) !== powerProfileKey(config);

      if (alreadyStarted && profileChanged) {
        await location.stopLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK);
      }
      if (!alreadyStarted || profileChanged) {
        const mode = config.powerMode ?? 'journey';
        await location.startLocationUpdatesAsync(
          BACKGROUND_JOURNEY_TASK,
          backgroundLocationOptions(
            mode,
            mode === 'allDay' ? false : Boolean(config.highAccuracy),
          ),
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
