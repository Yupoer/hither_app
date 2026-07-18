import type { Coordinates } from '../types';
import { distanceMeters } from './geo';

/**
 * Power modes for the 8h ≈ 20% battery budget goal:
 *
 * - `foreground` — app open on map (UI-responsive).
 * - `allDay` — phone locked / background group presence. Designed so a full
 *   day of sharing (~8h) stays near ≤20% on modern phones when mostly walking
 *   or idle. Uses Low accuracy + multi-minute deferred batches.
 * - `journey` — navigating to a gathering point in background; denser than
 *   allDay but still capped. `highAccuracy` only applies here / foreground.
 *
 * Continuous High accuracy for 8h will typically drain 40%+ and is intentionally
 * outside this budget — the precise toggle is short-burst only.
 *
 * Upload cadence is **dynamic**: while the device is moving, use the denser
 * `uploadHeartbeatMs`; after a quiet period, switch to
 * `uploadHeartbeatStationaryMs` (still a real heartbeat — not "off").
 */
export type LocationPowerMode = 'foreground' | 'allDay' | 'journey';

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
}

/** Resolve one authoritative mode before configuring any location consumer. */
export function resolveTrackingMode(input: TrackingModeInput): TrackingMode {
  if (!input.sharingEnabled) return 'hidden';
  if (input.teamNavigationActive && input.manualHighAccuracy) {
    return 'navigationMax';
  }
  if (input.teamNavigationActive) return 'teamNavigation';
  if (input.manualHighAccuracy) return 'manualHighAccuracy';
  return input.appState === 'active' ? 'foreground' : 'passiveBackground';
}

export interface LocationPolicy {
  accuracy: 'low' | 'balanced' | 'high';
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
   * Also used as the independent timer tick base.
   */
  uploadHeartbeatMs: number;
  /**
   * Upload heartbeat while **stationary** for a while.
   * Still reports liveness — just less often than moving.
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
 * Rough expected drain share for GPS+radio alone (device-dependent).
 * Not a guarantee — screen-on map time dominates if the app stays open.
 */
export const POWER_BUDGET_NOTE = {
  allDay8hTargetPct: 20,
  precise8hEstimatePct: 40,
} as const;

export function locationPolicy(
  highAccuracy: boolean,
  powerMode: LocationPowerMode = 'foreground',
): LocationPolicy {
  // All-day background: ignore highAccuracy — budget requires Low GPS.
  if (powerMode === 'allDay') {
    return {
      accuracy: 'low',
      distanceInterval: 120,
      timeInterval: 120_000,
      uiMinDistanceM: 40,
      uiMinIntervalMs: 30_000,
      uploadMinDistanceM: 120,
      uploadMinIntervalMs: 120_000,
      // Moving: ~1–2 uploads / 3 min; stationary rest: 5 min liveness.
      uploadHeartbeatMs: 180_000,
      uploadHeartbeatStationaryMs: 300_000,
      stationaryAfterMs: 120_000,
      routeMinDistanceM: 80,
      routeMinIntervalMs: 60_000,
      routeCoordDecimals: 3,
      realtimeLocationDebounceMs: 5_000,
    };
  }

  if (powerMode === 'journey') {
    return highAccuracy
      ? {
          accuracy: 'high',
          distanceInterval: 20,
          timeInterval: 10_000,
          uiMinDistanceM: 8,
          uiMinIntervalMs: 2_000,
          uploadMinDistanceM: 25,
          uploadMinIntervalMs: 15_000,
          uploadHeartbeatMs: 25_000,
          uploadHeartbeatStationaryMs: 60_000,
          stationaryAfterMs: 45_000,
          routeMinDistanceM: 20,
          routeMinIntervalMs: 12_000,
          routeCoordDecimals: 5,
          realtimeLocationDebounceMs: 2_000,
        }
      : {
          accuracy: 'balanced',
          distanceInterval: 40,
          timeInterval: 25_000,
          uiMinDistanceM: 20,
          uiMinIntervalMs: 5_000,
          uploadMinDistanceM: 45,
          uploadMinIntervalMs: 30_000,
          uploadHeartbeatMs: 45_000,
          uploadHeartbeatStationaryMs: 90_000,
          stationaryAfterMs: 60_000,
          routeMinDistanceM: 40,
          routeMinIntervalMs: 30_000,
          routeCoordDecimals: 4,
          realtimeLocationDebounceMs: 3_000,
        };
  }

  // Foreground (app open). Tighter while walking; calm when resting.
  return highAccuracy
    ? {
        accuracy: 'high',
        distanceInterval: 8,
        timeInterval: 5_000,
        uiMinDistanceM: 5,
        uiMinIntervalMs: 1_500,
        uploadMinDistanceM: 12,
        uploadMinIntervalMs: 8_000,
        uploadHeartbeatMs: 20_000,
        uploadHeartbeatStationaryMs: 60_000,
        stationaryAfterMs: 45_000,
        routeMinDistanceM: 15,
        routeMinIntervalMs: 8_000,
        routeCoordDecimals: 5,
        realtimeLocationDebounceMs: 1_500,
      }
    : {
        accuracy: 'balanced',
        distanceInterval: 30,
        timeInterval: 15_000,
        uiMinDistanceM: 12,
        uiMinIntervalMs: 4_000,
        uploadMinDistanceM: 30,
        uploadMinIntervalMs: 20_000,
        // Walking: ~every 45s if GPS quiet; resting: ~90s liveness.
        uploadHeartbeatMs: 45_000,
        uploadHeartbeatStationaryMs: 90_000,
        stationaryAfterMs: 60_000,
        routeMinDistanceM: 35,
        routeMinIntervalMs: 20_000,
        routeCoordDecimals: 4,
        realtimeLocationDebounceMs: 2_500,
      };
}

export function shouldWatchLocation(groupId: string | null, appState: string): boolean {
  return Boolean(groupId) && appState === 'active';
}

/** Background task should run only when the app is not active (single GPS owner). */
export function shouldRunBackgroundLocation(
  groupId: string | null,
  appState: string,
): boolean {
  return Boolean(groupId) && appState !== 'active';
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
): MotionState {
  const moved = prev.lastCoords
    ? distanceMeters(prev.lastCoords, sample)
    : Number.POSITIVE_INFINITY;
  const significant = !prev.lastCoords || moved >= policy.uploadMinDistanceM;
  const lastSignificantMoveAtMs = significant
    ? nowMs
    : prev.lastSignificantMoveAtMs;
  const quietMs = nowMs - lastSignificantMoveAtMs;
  const cadence: MotionCadence =
    quietMs >= policy.stationaryAfterMs ? 'stationary' : 'moving';
  return {
    cadence,
    lastSignificantMoveAtMs,
    lastCoords: sample,
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
  const moved = distanceMeters(last.lastCoords, sample);
  if (moved >= policy.uiMinDistanceM) return true;
  if (nowMs - last.lastAtMs >= policy.uiMinIntervalMs && moved >= policy.uiMinDistanceM * 0.4) {
    return true;
  }
  if (nowMs - last.lastAtMs < policy.uiMinIntervalMs) return false;
  return false;
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
  if (elapsed >= heartbeatMs) return true;
  const moved = distanceMeters(last.lastCoords, sample);
  if (moved >= policy.uploadMinDistanceM && elapsed >= policy.uploadMinIntervalMs) return true;
  if (moved >= policy.uploadMinDistanceM * 1.5 && elapsed >= policy.uploadMinIntervalMs * 0.5) {
    return true;
  }
  return false;
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
  if (moved >= policy.routeMinDistanceM && elapsed >= policy.routeMinIntervalMs * 0.4) {
    return true;
  }
  if (elapsed >= policy.routeMinIntervalMs && moved >= policy.routeMinDistanceM * 0.5) {
    return true;
  }
  return false;
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
