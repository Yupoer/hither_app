/**
 * Live Activity boundary (iOS ActivityKit / Dynamic Island).
 *
 * There is NO Expo-Go-compatible implementation: ActivityKit requires a
 * custom native module and a Dev Build. In Expo Go these are safe no-ops,
 * so screens can call them freely
 * without crashing. On an EAS Dev Build the native module
 * `HitherLiveActivity` (`apps/mobile/modules/hither-live-activity`) is
 * present and backs every call through the same interface.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Coordinates } from '../types';

/** Custom native module; `null` in Expo Go / when not built. */
const HitherLiveActivity = requireOptionalNativeModule<{
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
  /** Active theme accent (hex, e.g. "#F5B142") so the Live Activity tints with
   * the app's theme instead of a baked-in colour. */
  accentHex?: string;
  /** Current travel mode ('walk' | 'transit' | 'drive') — drives the transit
   * glyph in the compact island + lock-screen header. */
  travelMode?: string;
  /** Member avatar emojis for the flock stack (empty string = no emoji set). */
  memberEmojis?: string[];
}

/** Opaque id for an in-flight activity (native only). */
export type ActivityHandle = string;

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
