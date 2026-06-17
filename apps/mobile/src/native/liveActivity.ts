/**
 * Live Activity boundary (iOS ActivityKit / Dynamic Island).
 *
 * There is NO Expo-Go-compatible implementation: ActivityKit requires a
 * custom native module and a Dev Build. Phase A therefore ships safe no-ops
 * with {@link isSupported} returning false, so screens can call these freely
 * without crashing in Expo Go. The real implementation arrives with
 * `apps/mobile/modules/hither-live-activity` (Phase B, EAS Dev Build),
 * backing this same interface.
 */
import type { Coordinates } from '../types';

export interface GroupActivityState {
  groupName: string;
  gatheringTitle?: string;
  /** Distance from the user to the gathering point, in metres. */
  distanceMeters?: number;
  /** ETA in seconds. */
  etaSeconds?: number;
  gatheringCoordinates?: Coordinates;
}

/** Opaque id for an in-flight activity (native only). */
export type ActivityHandle = string;

/**
 * Whether Live Activities can actually run here. Always false in Expo Go /
 * on Android. Gate UI affordances on this.
 */
export function isSupported(): boolean {
  return false;
}

/** Start a group Live Activity. No-op (returns null) until Phase B. */
export async function startGroupActivity(
  _state: GroupActivityState,
): Promise<ActivityHandle | null> {
  if (!isSupported()) {
    return null;
  }
  return null;
}

/** Update a running Live Activity. No-op until Phase B. */
export async function updateGroupActivity(
  _handle: ActivityHandle,
  _state: GroupActivityState,
): Promise<void> {
  // no-op
}

/** End a running Live Activity. No-op until Phase B. */
export async function endGroupActivity(
  _handle: ActivityHandle,
): Promise<void> {
  // no-op
}
