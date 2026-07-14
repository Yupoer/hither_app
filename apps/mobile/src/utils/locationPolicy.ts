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
 */
export type LocationPowerMode = 'foreground' | 'allDay' | 'journey';

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
  /** Upload even if nearly stationary so teammates see liveness. */
  uploadHeartbeatMs: number;
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
      // ~16 uploads/hour when stationary; main radio budget control.
      uploadHeartbeatMs: 300_000,
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
          uploadHeartbeatMs: 90_000,
          routeMinDistanceM: 20,
          routeMinIntervalMs: 12_000,
          routeCoordDecimals: 5,
          realtimeLocationDebounceMs: 2_000,
        }
      : {
          accuracy: 'balanced',
          distanceInterval: 50,
          timeInterval: 30_000,
          uiMinDistanceM: 20,
          uiMinIntervalMs: 5_000,
          uploadMinDistanceM: 60,
          uploadMinIntervalMs: 45_000,
          uploadHeartbeatMs: 180_000,
          routeMinDistanceM: 40,
          routeMinIntervalMs: 30_000,
          routeCoordDecimals: 4,
          realtimeLocationDebounceMs: 3_000,
        };
  }

  // Foreground (app open).
  return highAccuracy
    ? {
        accuracy: 'high',
        distanceInterval: 8,
        timeInterval: 5_000,
        uiMinDistanceM: 5,
        uiMinIntervalMs: 1_500,
        uploadMinDistanceM: 15,
        uploadMinIntervalMs: 8_000,
        uploadHeartbeatMs: 45_000,
        routeMinDistanceM: 15,
        routeMinIntervalMs: 8_000,
        routeCoordDecimals: 5,
        realtimeLocationDebounceMs: 1_500,
      }
    : {
        accuracy: 'balanced',
        distanceInterval: 50,
        timeInterval: 20_000,
        uiMinDistanceM: 15,
        uiMinIntervalMs: 4_000,
        uploadMinDistanceM: 50,
        uploadMinIntervalMs: 30_000,
        uploadHeartbeatMs: 120_000,
        routeMinDistanceM: 40,
        routeMinIntervalMs: 25_000,
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
 * First sample always accepted. Heartbeat keeps liveness when stationary.
 * Manual refresh bypasses this at the call site.
 */
export function shouldUploadSample(
  sample: Coordinates,
  nowMs: number,
  last: LocationGateState,
  policy: LocationPolicy,
): boolean {
  if (!last.lastCoords) return true;
  const elapsed = nowMs - last.lastAtMs;
  if (elapsed >= policy.uploadHeartbeatMs) return true;
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
