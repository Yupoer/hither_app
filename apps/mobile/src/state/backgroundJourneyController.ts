import type { Coordinates } from '../types';
import type { TravelMode } from '../utils/geo';
import {
  locationPolicy,
  resolveTrackingMode,
  type LocationPowerMode,
  type TrackingMode,
} from '../utils/locationPolicy';
import type { ArrivalState } from '../utils/navigationArrival';

export const BACKGROUND_JOURNEY_TASK = 'hither-background-journey-location';
export const BACKGROUND_JOURNEY_KEY = '@hither/background-journey';

export interface BackgroundJourneyConfig {
  groupId: string;
  navigationSessionId: string | null;
  destinationId: string;
  destination: Coordinates;
  arrivalRadiusMeters: number;
  initialDistanceM: number;
  sequence: number;
  travelMode: TravelMode;
  sharingEnabled: boolean;
  arrivalState?: ArrivalState;
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
  /** True when the group has an active leader navigation session. */
  teamNavigationActive?: boolean;
  /** App state at the time the background task was configured. */
  appState?: 'active' | 'background' | 'inactive';
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

export function resolveBackgroundTrackingMode(
  config: BackgroundJourneyConfig,
): TrackingMode {
  const powerMode = config.powerMode ?? 'journey';
  const explicitMode =
    config.sharingEnabled === false ||
    config.teamNavigationActive != null ||
    config.appState != null;
  return resolveTrackingMode({
    sharingEnabled: config.sharingEnabled ?? true,
    teamNavigationActive: config.teamNavigationActive ?? false,
    // The legacy all-day profile intentionally ignores the high-accuracy
    // preference; navigation is the only background mode that can opt in.
    manualHighAccuracy: explicitMode
      ? Boolean(config.highAccuracy)
      : powerMode !== 'allDay' && Boolean(config.highAccuracy),
    appState: config.appState ?? 'background',
  });
}

/**
 * expo-location Accuracy: Lowest=1 Low=2 Balanced=3 High=4 Highest=5 BestForNavigation=6
 * Options tuned for the power budget — see locationPolicy POWER_BUDGET_NOTE.
 */
export function backgroundLocationOptions(
  powerMode: 'allDay' | 'journey',
  highAccuracy: boolean,
  trackingMode?: TrackingMode,
): object {
  const explicitMode = trackingMode != null;
  const mode: TrackingMode = trackingMode ?? (
    powerMode === 'allDay'
      ? 'passiveBackground'
      : highAccuracy
        ? 'manualHighAccuracy'
        : 'foreground'
  );
  const powerProfile: LocationPowerMode =
    mode === 'passiveBackground' ? 'allDay' : 'journey';
  // Never allow highAccuracy to override allDay (budget).
  const policy = locationPolicy(
    mode === 'navigationMax' || mode === 'manualHighAccuracy' || mode === 'teamNavigation',
    powerProfile,
  );

  const accuracyCode = !explicitMode
    ? policy.accuracy === 'high'
      ? 4
      : policy.accuracy === 'low'
        ? 2
        : 3
    : mode === 'navigationMax'
      ? 6
      : mode === 'teamNavigation' || mode === 'manualHighAccuracy'
        ? 5
        : policy.accuracy === 'high'
          ? 4
          : policy.accuracy === 'low'
            ? 2
            : 3;

  const deferredInterval = mode === 'passiveBackground'
    ? 180_000
    : mode === 'navigationMax'
      ? 15_000
      : mode === 'teamNavigation' || mode === 'manualHighAccuracy'
        ? 30_000
        : highAccuracy
          ? 20_000
          : 60_000;
  const deferredDistance = mode === 'passiveBackground'
    ? 150
    : mode === 'navigationMax'
      ? 20
      : mode === 'teamNavigation' || mode === 'manualHighAccuracy'
        ? 30
        : highAccuracy
          ? 30
          : 60;

  return {
    accuracy: accuracyCode,
    distanceInterval: policy.distanceInterval,
    timeInterval: policy.timeInterval,
    deferredUpdatesDistance: deferredDistance,
    deferredUpdatesInterval: deferredInterval,
    // Passive sharing may pause; navigation must continue while locked.
    pausesUpdatesAutomatically: explicitMode
      ? mode === 'passiveBackground'
      : true,
    showsBackgroundLocationIndicator: explicitMode
      ? mode !== 'passiveBackground'
      : true,
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
  if (
    config.sharingEnabled !== false &&
    config.teamNavigationActive == null &&
    config.appState == null
  ) {
    const legacyMode = config.powerMode ?? 'journey';
    return `${legacyMode}:${legacyMode === 'allDay' ? 'n' : config.highAccuracy ? 'h' : 'n'}`;
  }
  const mode = resolveBackgroundTrackingMode(config);
  return mode;
}

export function createBackgroundJourneyController(
  location: BackgroundLocationAdapter,
  storage: BackgroundStorageAdapter,
) {
  return {
    async start(
      config: BackgroundJourneyConfig,
    ): Promise<'started' | 'permission_denied' | 'hidden'> {
      const nextMode = resolveBackgroundTrackingMode(config);
      const alreadyStarted = await location.hasStartedLocationUpdatesAsync(
        BACKGROUND_JOURNEY_TASK,
      );

      if (nextMode === 'hidden') {
        if (alreadyStarted) {
          await location.stopLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK);
        }
        await storage.removeItem(BACKGROUND_JOURNEY_KEY);
        return 'hidden';
      }

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

      const persistedConfig = previous &&
        previous.groupId === config.groupId &&
        previous.destinationId === config.destinationId &&
        previous.navigationSessionId === config.navigationSessionId
        ? {
            ...config,
            sequence: Math.max(config.sequence, previous.sequence),
            arrivalState: config.arrivalState ?? previous.arrivalState,
          }
        : config;
      await storage.setItem(
        BACKGROUND_JOURNEY_KEY,
        JSON.stringify(persistedConfig),
      );
      const profileChanged =
        alreadyStarted &&
        previous != null &&
        powerProfileKey(previous) !== powerProfileKey(config);

      if (alreadyStarted && profileChanged) {
        await location.stopLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK);
      }
      if (!alreadyStarted || profileChanged) {
        await location.startLocationUpdatesAsync(
          BACKGROUND_JOURNEY_TASK,
          backgroundLocationOptions(
            config.powerMode ?? 'journey',
            Boolean(config.highAccuracy),
            config.sharingEnabled !== false &&
              config.teamNavigationActive == null &&
              config.appState == null
              ? undefined
              : nextMode,
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
