/**
 * Live Activity boundary (iOS ActivityKit / Dynamic Island).
 *
 * There is NO Expo-Go-compatible implementation: ActivityKit requires a
 * custom native module and a Dev Build. In Expo Go these are safe no-ops
 * with {@link isSupported} returning false, so screens can call them freely
 * without crashing. On an EAS Dev Build the native module
 * `HitherLiveActivity` (`apps/mobile/modules/hither-live-activity`) is
 * present and backs every call through the same interface.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Coordinates } from '../types';

/** Custom native module; `null` in Expo Go / when not built. */
const HitherLiveActivity = requireOptionalNativeModule<{
  isSupported(): boolean;
  startGroupActivity(state: GroupActivityState): Promise<ActivityHandle | null>;
  updateGroupActivity(
    handle: ActivityHandle,
    state: GroupActivityState,
  ): Promise<void>;
  endGroupActivity(handle: ActivityHandle): Promise<void>;
}>('HitherLiveActivity');

export interface GroupActivityState {
  groupName: string;
  gatheringTitle?: string;
  /** Distance from the user to the gathering point, in metres. */
  distanceMeters?: number;
  /** ETA in seconds. */
  etaSeconds?: number;
  gatheringCoordinates?: Coordinates;
  /** Flock progress toward the point, 0..1 (drives the Live Activity bar). */
  progress?: number;
  /** How many members have reached the point. */
  gatheredCount?: number;
  /** Total members in the group (for the avatar stack). */
  memberCount?: number;
}

/** Opaque id for an in-flight activity (native only). */
export type ActivityHandle = string;

/**
 * Whether Live Activities can actually run here. False in Expo Go / on
 * Android; true only on an iOS Dev Build with the native module. Gate UI
 * affordances on this.
 */
export function isSupported(): boolean {
  return HitherLiveActivity?.isSupported() ?? false;
}

/** Start a group Live Activity. Returns null when unsupported (Expo Go). */
export async function startGroupActivity(
  state: GroupActivityState,
): Promise<ActivityHandle | null> {
  if (!HitherLiveActivity) {
    return null;
  }
  return HitherLiveActivity.startGroupActivity(state);
}

/** Update a running Live Activity. No-op when unsupported. */
export async function updateGroupActivity(
  handle: ActivityHandle,
  state: GroupActivityState,
): Promise<void> {
  await HitherLiveActivity?.updateGroupActivity(handle, state);
}

/** End a running Live Activity. No-op when unsupported. */
export async function endGroupActivity(handle: ActivityHandle): Promise<void> {
  await HitherLiveActivity?.endGroupActivity(handle);
}
