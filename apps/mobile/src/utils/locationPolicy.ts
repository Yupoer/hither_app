import type { Coordinates } from '../types';
import { distanceMeters } from './geo';

/** Foreground UI, passive presence, and journey profiles. Uploads only use real sensor fixes.
 * iOS live updates use the OS-managed default profile; Expo uses ordinary accuracy.
 * Battery targets require device measurements and are not guarantees.
 */
export type LocationPowerMode = 'foreground' | 'allDay' | 'journey';

/** A system cover does not transfer GPS ownership to the background task. */
export function isForegroundLocationState(appState: string): boolean {
  return appState === 'active' || appState === 'inactive';
}

/** Choose a single foreground acquisition owner from the local navigation intent. */
export function foregroundLocationConfiguration(input: {
  navigationActive: boolean;
  highAccuracy: boolean;
  sharingEnabled: boolean;
  hasMembership: boolean;
  appState: string;
}): { owner: 'none' | 'expo'; highAccuracy: boolean; powerMode: LocationPowerMode } {
  const allowed = input.sharingEnabled && input.hasMembership && isForegroundLocationState(input.appState);
  return {
    owner: allowed ? 'expo' : 'none',
    // Preserve the preference at the caller; a paused journey never promotes GPS.
    highAccuracy: input.navigationActive && input.highAccuracy,
    powerMode: input.navigationActive ? 'journey' : 'allDay',
  };
}

/**
 * Product-level tracking state. `LocationPowerMode` remains the low-level
 * battery profile; this type describes why that profile is active.
 */
export type TrackingMode =
  | 'hidden'
  | 'passiveBackground'
  | 'foreground'
  | 'teamNavigation'
  | 'navigationMax'
  | 'manualHighAccuracy';

/** Motion-aware upload tier. Independent of power mode / tracking mode. */
export type MotionCadence = 'moving' | 'stationary';

export interface TrackingModeInput {
  sharingEnabled: boolean;
  teamNavigationActive: boolean;
  manualHighAccuracy: boolean;
  appState: 'active' | 'background' | 'inactive';
  hasMembership?: boolean;
}

/** Resolve one authoritative mode before configuring any location consumer. */
export function resolveTrackingMode(input: TrackingModeInput): TrackingMode {
  if (!input.sharingEnabled || input.hasMembership === false) return 'hidden';
  if (input.teamNavigationActive && input.manualHighAccuracy) {
    return 'navigationMax';
  }
  if (input.teamNavigationActive) return 'teamNavigation';
  if (input.manualHighAccuracy && input.appState === 'active') return 'manualHighAccuracy';
  return input.appState === 'active' ? 'foreground' : 'passiveBackground';
}

export interface LocationPolicy {
  accuracy: 'balanced' | 'high';
  /** Native OS distance filter (metres). */
  distanceInterval: number;
  /** Android minimum interval between reports (ms). iOS largely ignores this. */
  timeInterval: number;
  /** Accept sample for local pin / distance UI. */
  uiMinDistanceM: number;
  uiMinIntervalMs: number;
  /** Accept sample for Supabase upload. */
  uploadMinDistanceM: number;
  uploadMinIntervalMs: number;
  /**
   * Upload heartbeat while **moving** (or right after a move).
   * Evaluated only when a timestamped sensor sample arrives.
   */
  uploadHeartbeatMs: number;
  /**
   * Upload heartbeat while **stationary** for a while.
   * No sample means no upload; never manufacture liveness from cached coordinates.
   */
  uploadHeartbeatStationaryMs: number;
  /**
   * After this quiet span with no significant move, cadence becomes stationary.
   */
  stationaryAfterMs: number;
  /** Recompute MapKit routes only after this move / interval. */
  routeMinDistanceM: number;
  routeMinIntervalMs: number;
  /** Decimal places for route cache / member signature keys. */
  routeCoordDecimals: number;
  /** Debounce for others' member_locations realtime events. */
  realtimeLocationDebounceMs: number;
}

/**
 * Legacy product targets, not measured drain or a platform guarantee.
 * Not a guarantee — screen-on map time dominates if the app stays open.
 */
export const POWER_BUDGET_NOTE = {
  allDay8hTargetPct: 20,
  precise8hEstimatePct: 40,
} as const;

export function syncTimingScale(highAccuracy: boolean, powerMode: LocationPowerMode): number {
  return powerMode === 'journey' ? highAccuracy ? 3 : 6 : 2;
}

export function locationPolicy(
  highAccuracy: boolean,
  powerMode: LocationPowerMode = 'foreground',
  background = false,
): LocationPolicy {
  const journey = powerMode === 'journey';
  const interval = journey ? highAccuracy ? 15_000 : 60_000 : background ? 600_000 : 300_000;
  const distance = journey ? highAccuracy ? 10 : 100 : 300;
  return {
    accuracy: journey ? 'high' : 'balanced',
    distanceInterval: distance,
    timeInterval: interval,
    uiMinDistanceM: journey ? highAccuracy ? 8 : 30 : 50,
    uiMinIntervalMs: journey ? highAccuracy ? 500 : 1_000 : 40_000,
    uploadMinDistanceM: distance,
    uploadMinIntervalMs: interval,
    uploadHeartbeatMs: journey ? highAccuracy ? 15_000 : 90_000 : interval,
    uploadHeartbeatStationaryMs: journey ? highAccuracy ? 180_000 : 360_000 : interval,
    stationaryAfterMs: journey ? 45_000 : 90_000,
    routeMinDistanceM: highAccuracy ? 20 : 100,
    routeMinIntervalMs: highAccuracy ? 36_000 : 300_000,
    routeCoordDecimals: highAccuracy ? 5 : 4,
    realtimeLocationDebounceMs: journey ? highAccuracy ? 6_000 : 30_000 : 12_000,
  };
}

export function routeLocationPolicy(highAccuracy: boolean, nearTarget: boolean): LocationPolicy {
  const policy = locationPolicy(highAccuracy, 'journey');
  return nearTarget ? { ...policy, routeMinDistanceM: highAccuracy ? 15 : 18,
    routeMinIntervalMs: highAccuracy ? 9_000 : 18_000 } : policy;
}

export function locationStaleAfterMs(highAccuracy: boolean, powerMode: LocationPowerMode, background = false): number {
  return Math.max(30_000, locationPolicy(highAccuracy, powerMode, background).timeInterval * 2);
}

export function shouldWatchLocation(
  groupId: string | null,
  appState: string,
  sharingEnabled = true,
  hasMembership = Boolean(groupId),
): boolean {
  return (
    Boolean(groupId)
    && isForegroundLocationState(appState)
    && sharingEnabled
    && hasMembership
  );
}

/** Only actual background transfers GPS ownership to the background task. */
export function shouldRunBackgroundLocation(
  groupId: string | null,
  appState: string,
  sharingEnabled = true,
  hasMembership = Boolean(groupId),
): boolean {
  return (
    Boolean(groupId)
    && appState === 'background'
    && sharingEnabled
    && hasMembership
  );
}

export interface LocationGateState {
  lastCoords: Coordinates | null;
  lastAtMs: number;
}

export interface MotionState {
  cadence: MotionCadence;
  /** Last time a significant move (uploadMinDistanceM) was observed. */
  lastSignificantMoveAtMs: number;
  lastCoords: Coordinates | null;
}

export function createMotionState(nowMs = 0): MotionState {
  return {
    cadence: 'moving',
    lastSignificantMoveAtMs: nowMs,
    lastCoords: null,
  };
}

/**
 * Update motion cadence from a new fix. Pure — callers own the ref.
 * Significant move → `moving` immediately; quiet for `stationaryAfterMs` → `stationary`.
 */
export function reduceMotionState(
  prev: MotionState,
  sample: Coordinates,
  nowMs: number,
  policy: LocationPolicy,
  accuracyM = 0,
): MotionState {
  const moved = prev.lastCoords
    ? distanceMeters(prev.lastCoords, sample)
    : Number.POSITIVE_INFINITY;
  // Keep an anchor until movement exceeds the sensor-noise floor; comparing
  // consecutive fixes classifies slow walking as stationary forever. Do not
  // reuse uploadMinDistanceM here: balanced journey uploads may require 10 m,
  // but several accurate 1 m fixes still prove that the user is moving.
  const threshold = Math.max(5, Math.min(100, Math.max(0, accuracyM)));
  const significant = !prev.lastCoords || moved >= threshold;
  const lastSignificantMoveAtMs = significant
    ? nowMs
    : prev.lastSignificantMoveAtMs;
  const quietMs = nowMs - lastSignificantMoveAtMs;
  const cadence: MotionCadence =
    quietMs >= policy.stationaryAfterMs ? 'stationary' : 'moving';
  return {
    cadence,
    lastSignificantMoveAtMs,
    lastCoords: significant ? sample : prev.lastCoords,
  };
}

/** Heartbeat interval for the current motion cadence. */
export function uploadHeartbeatForCadence(
  policy: LocationPolicy,
  cadence: MotionCadence,
): number {
  return cadence === 'stationary'
    ? policy.uploadHeartbeatStationaryMs
    : policy.uploadHeartbeatMs;
}

/**
 * Whether a sample should update local UI (pin / distance chip).
 * First sample always accepted. Manual refresh bypasses this at the call site.
 */
export function shouldAcceptUiSample(
  sample: Coordinates,
  nowMs: number,
  last: LocationGateState,
  policy: LocationPolicy,
): boolean {
  if (!last.lastCoords) return true;
  if (nowMs - last.lastAtMs < policy.uiMinIntervalMs) return false;
  return distanceMeters(last.lastCoords, sample) >= policy.uiMinDistanceM * 0.4;
}

/**
 * Whether a sample should be uploaded to Supabase.
 * First sample always accepted. Heartbeat keeps liveness when stationary,
 * using the motion-aware interval when `cadence` is provided.
 * Manual refresh bypasses this at the call site.
 */
export function shouldUploadSample(
  sample: Coordinates,
  nowMs: number,
  last: LocationGateState,
  policy: LocationPolicy,
  cadence: MotionCadence = 'moving',
): boolean {
  if (!last.lastCoords) return true;
  const elapsed = nowMs - last.lastAtMs;
  const heartbeatMs = uploadHeartbeatForCadence(policy, cadence);
  // Heartbeats have their own cadence so low-power profiles can keep liveness
  // without waiting for a movement interval. Distance-triggered uploads still
  // require the full minimum; there is no half-interval shortcut.
  if (elapsed >= heartbeatMs) return true;
  if (elapsed < policy.uploadMinIntervalMs) return false;
  return distanceMeters(last.lastCoords, sample) >= policy.uploadMinDistanceM;
}

/**
 * Whether self coordinates should trigger a MapKit route recompute.
 */
export function shouldRecomputeRoute(
  sample: Coordinates,
  nowMs: number,
  last: LocationGateState,
  policy: LocationPolicy,
): boolean {
  if (!last.lastCoords) return true;
  const elapsed = nowMs - last.lastAtMs;
  const moved = distanceMeters(last.lastCoords, sample);
  // Route calculation is a network/native operation. Enforce the full
  // interval for every coordinate, including a large move.
  return elapsed >= policy.routeMinIntervalMs && moved >= policy.routeMinDistanceM;
}

/** Quantize coordinates for stable cache keys / member signatures. */
export function quantizeCoord(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

export function quantizeCoordinates(
  coords: Coordinates,
  decimals: number,
): string {
  return `${quantizeCoord(coords.latitude, decimals)}:${quantizeCoord(coords.longitude, decimals)}`;
}

/**
 * True when a member_locations realtime payload is only about the current user.
 * Pure helper so tests don't pull the Supabase client graph.
 */
export function isOwnLocationChange(
  payload: { new?: Record<string, unknown> | null; old?: Record<string, unknown> | null },
  myUserId: string | null | undefined,
): boolean {
  if (!myUserId) return false;
  const nextId = payload.new?.user_id;
  const prevId = payload.old?.user_id;
  if (typeof nextId === 'string' && nextId === myUserId) return true;
  if (typeof prevId === 'string' && prevId === myUserId && nextId == null) return true;
  return false;
}
