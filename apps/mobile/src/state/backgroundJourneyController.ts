import type { Destination, Coordinates } from '../types';
import type { TravelMode } from '../utils/geo';
import {
  locationPolicy,
  resolveTrackingMode,
  type LocationPowerMode,
  type TrackingMode,
} from '../utils/locationPolicy';
import type { ArrivalState } from '../utils/navigationArrival';
import { getActiveLanguage, translate } from '../i18n';

export const BACKGROUND_JOURNEY_TASK = 'hither-background-journey-location';
export const BACKGROUND_JOURNEY_KEY = '@hither/background-journey';

export interface BackgroundJourneyConfig {
  trackingEpoch?: number;
  actorId?: string;
  target?: Destination;
  completeSolo?: boolean;
  memberIds?: string[];
  groupId: string;
  navigationSessionId: string | null;
  destinationId: string;
  destination: Coordinates;
  arrivalRadiusMeters: number;
  initialDistanceM: number;
  distanceSource?: 'route' | 'fallback';
  routeAnchorGps?: Coordinates;
  routeAnchorRemainingM?: number;
  accentHex?: string;
  sequence: number;
  travelMode: TravelMode;
  sharingEnabled: boolean;
  hasMembership?: boolean;
  arrivalState?: ArrivalState;
  gatheringTitle?: string;
  groupName?: string;
  memberEmojis?: string[];
  memberArrived?: boolean[];
  startCoords?: Coordinates;
  hasDepartedStart?: boolean;
  previousProgressMax?: number;
  etaSeconds?: number;
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
  /**
   * MapScreen prepares both permission prompts while active.  Background
   * transitions pass this flag so starting the native task never prompts.
   */
  permissionsPrepared?: boolean;
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
    hasMembership: config.hasMembership ?? true,
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

  // Expo Accuracy: Lowest=1 Low=2 Balanced=3 High=4 Highest=5 BestForNavigation=6
  // Walking/team navigation must not default to BestForNavigation (6).
  const accuracyCode = mode === 'navigationMax' || mode === 'manualHighAccuracy'
    ? 5
    : mode === 'teamNavigation'
      ? 4
      : policy.accuracy === 'high'
        ? 4
        : policy.accuracy === 'low'
          ? 2
          : 3;

  const deferredInterval = powerMode === 'journey' ? 0 : mode === 'passiveBackground'
    ? 180_000
    : mode === 'navigationMax'
      ? 15_000
      : mode === 'teamNavigation' || mode === 'manualHighAccuracy'
        ? 30_000
        : highAccuracy
          ? 20_000
          : 60_000;
  const deferredDistance = powerMode === 'journey' ? 0 : mode === 'passiveBackground'
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
    // Fitness=3 for journey navigation; Other=1 for passive presence.
    activityType: powerMode === 'journey' ? 3 : 1,
    distanceInterval: policy.distanceInterval,
    timeInterval: policy.timeInterval,
    deferredUpdatesDistance: deferredDistance,
    deferredUpdatesInterval: deferredInterval,
    // Passive presence has only a declared heartbeat; do not let Core Location
    // pause it indefinitely after a stationary interval. Journey modes may use
    // the OS pause policy to conserve power while still actively navigating.
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: mode !== 'passiveBackground',
    foregroundService: {
      notificationTitle:
        powerMode === 'allDay'
          ? translate(getActiveLanguage(), 'fgs.groupTitle')
          : translate(getActiveLanguage(), 'fgs.navTitle'),
      notificationBody:
        powerMode === 'allDay'
          ? translate(getActiveLanguage(), 'fgs.groupBody')
          : translate(getActiveLanguage(), 'fgs.navBody'),
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
  let serial = Promise.resolve();
  let epoch = 0;
  const runSerial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = serial.then(work, work);
    serial = next.then(() => undefined, () => undefined);
    return next;
  };
  const isCurrent = (config: BackgroundJourneyConfig) => (config.trackingEpoch ?? 0) === epoch;
  const preparePermissions = async (): Promise<'ready' | 'permission_denied'> => {
    const foreground = await location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted') return 'permission_denied';

    const background = await location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted') return 'permission_denied';
    return 'ready';
  };

  return {
    preparePermissions,
    isCurrent,
    update(config: BackgroundJourneyConfig, next: BackgroundJourneyConfig): Promise<boolean> {
      return runSerial(async () => {
        if (!isCurrent(config)) return false;
        const raw = await storage.getItem(BACKGROUND_JOURNEY_KEY);
        const current = raw ? JSON.parse(raw) as BackgroundJourneyConfig : null;
        if (!isCurrent(config) || !current || current.sequence > next.sequence) return false;
        await storage.setItem(BACKGROUND_JOURNEY_KEY, JSON.stringify(next));
        return true;
      });
    },

    start(
      config: BackgroundJourneyConfig,
    ): Promise<'started' | 'permission_denied' | 'hidden' | 'cancelled'> {
      const requestedEpoch = epoch = Math.max(Date.now(), epoch + 1);
      return runSerial(async () => {
        if (requestedEpoch !== epoch) return 'cancelled';
        config = { ...config, trackingEpoch: requestedEpoch };
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

        if (config.permissionsPrepared !== true) {
          // An explicit false from MapScreen means this is a background
          // transition without an active-state permission preparation.  Do not
          // open a permission prompt from the background task.
          if (config.permissionsPrepared === false && config.appState != null) {
            return 'permission_denied';
          }
          if (await preparePermissions() !== 'ready') return 'permission_denied';
        }

        let previous: BackgroundJourneyConfig | null = null;
        const rawPrevious = await storage.getItem(BACKGROUND_JOURNEY_KEY);
        if (rawPrevious) {
          try {
            previous = JSON.parse(rawPrevious) as BackgroundJourneyConfig;
          } catch {
            previous = null;
          }
        }

        if (requestedEpoch !== epoch) return 'cancelled';
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
        if (requestedEpoch !== epoch) return 'cancelled';
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
      });
    },

    stop(expected?: BackgroundJourneyConfig): Promise<void> {
      if (expected && !isCurrent(expected)) return Promise.resolve();
      epoch = Math.max(Date.now(), epoch + 1);
      return runSerial(async () => {
        const started = await location.hasStartedLocationUpdatesAsync(
          BACKGROUND_JOURNEY_TASK,
        );
        if (started) {
          await location.stopLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK);
        }
        await storage.removeItem(BACKGROUND_JOURNEY_KEY);
      });
    },

    async load(): Promise<BackgroundJourneyConfig | null> {
      const raw = await storage.getItem(BACKGROUND_JOURNEY_KEY);
      if (!raw) return null;
      try {
        const config = JSON.parse(raw) as BackgroundJourneyConfig;
        if (epoch === 0) epoch = config.trackingEpoch ?? 0;
        return config;
      } catch {
        return null;
      }
    },
  };
}
