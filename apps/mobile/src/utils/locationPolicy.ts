import type { Coordinates } from '../types';
import { distanceMeters } from './geo';

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

export function locationPolicy(highAccuracy: boolean): LocationPolicy {
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
        // Peers are patched from the realtime payload — debounce only merges bursts.
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
  // Tiny jitter within min interval: drop.
  if (nowMs - last.lastAtMs < policy.uiMinIntervalMs) return false;
  // Interval elapsed but still essentially stationary: skip UI churn.
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
  // Significant move even if slightly under min interval (e.g. vehicle).
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

