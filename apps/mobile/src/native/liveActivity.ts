/**
 * Live Activity boundary (iOS ActivityKit / Dynamic Island + Android Live Updates).
 *
 * There is NO Expo-Go-compatible implementation: ActivityKit and Android
 * Live Updates require a custom native module and a Dev Build. In Expo Go
 * these are safe no-ops, so screens can call them freely without crashing.
 * On an EAS Dev Build the native module `HitherLiveActivity`
 * (`apps/mobile/modules/hither-live-activity`) is present and backs every
 * call through the same interface.
 *
 * iOS handles are ActivityKit activity ids; Android handles are stable
 * navigation session ids. Optional chaining on the module alone is not
 * enough — methods must also be optional-called.
 */
import {
  requireOptionalNativeModule,
  type EventSubscription,
} from 'expo-modules-core';
import type { Coordinates } from '../types';

/** Custom native module; `null` in Expo Go / when not built. */
interface PushTokenEvent {
  activityId: string;
  pushToken: string;
  navigationSessionId?: string;
}

interface PushToStartTokenEvent {
  token: string | null;
}

type HitherLiveActivityEvents = {
  onPushToken: (event: PushTokenEvent) => void;
  onPushToStartToken: (event: PushToStartTokenEvent) => void;
};

type HitherLiveActivityModule = {
  addListener?: <EventName extends keyof HitherLiveActivityEvents>(
    eventName: EventName,
    listener: HitherLiveActivityEvents[EventName],
  ) => EventSubscription;
  startPushToStartTokenObservation?: () => Promise<void>;
  observeExistingActivities?: () => Promise<void>;
  startGroupActivity?: (state: GroupActivityState) => Promise<ActivityStartResult | null>;
  updateGroupActivity?: (
    handle: ActivityHandle,
    state: GroupActivityState,
  ) => Promise<void>;
  updateAllGroupActivities?: (state: GroupActivityState) => Promise<void>;
  endGroupActivity?: (handle: ActivityHandle) => Promise<void>;
  endAllGroupActivities?: () => Promise<void>;
};

const HitherLiveActivity =
  requireOptionalNativeModule<HitherLiveActivityModule>('HitherLiveActivity');

const NOOP_SUBSCRIPTION: EventSubscription = { remove() {} };

export interface GroupActivityState {
  groupName: string;
  navigationSessionId?: string;
  status?: string;
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
  /** Per-member arrival flags aligned with `memberEmojis`. */
  memberArrived?: boolean[];
}

/** Opaque id for an in-flight activity (native only). */
export type ActivityHandle = string;

export interface ActivityStartResult {
  activityId: string;
  pushToken?: string;
}

/** Start a group Live Activity. Returns null when unsupported (Expo Go). */
export async function startGroupActivity(
  state: GroupActivityState,
): Promise<ActivityStartResult | null> {
  return (await HitherLiveActivity?.startGroupActivity?.(state)) ?? null;
}

export function addPushTokenListener(
  listener: (event: PushTokenEvent) => void,
): EventSubscription {
  return HitherLiveActivity?.addListener?.('onPushToken', listener) ?? NOOP_SUBSCRIPTION;
}

/** Update a running Live Activity. No-op when unsupported. */
export async function updateGroupActivity(
  handle: ActivityHandle,
  state: GroupActivityState,
): Promise<void> {
  await HitherLiveActivity?.updateGroupActivity?.(handle, state);
}

export function addPushToStartTokenListener(
  listener: (event: PushToStartTokenEvent) => void,
): EventSubscription {
  return (
    HitherLiveActivity?.addListener?.('onPushToStartToken', listener) ?? NOOP_SUBSCRIPTION
  );
}

export async function startPushToStartTokenObservation(): Promise<void> {
  await HitherLiveActivity?.startPushToStartTokenObservation?.();
}

export async function observeExistingActivities(): Promise<void> {
  await HitherLiveActivity?.observeExistingActivities?.();
}

/** Update every Hither activity from a headless background location callback. */
export async function updateAllGroupActivities(
  state: GroupActivityState,
): Promise<void> {
  await HitherLiveActivity?.updateAllGroupActivities?.(state);
}

/** End a running Live Activity. No-op when unsupported. */
export async function endGroupActivity(handle: ActivityHandle): Promise<void> {
  await HitherLiveActivity?.endGroupActivity?.(handle);
}

/** End every Hither Live Activity on this device. No-op when unsupported. */
export async function endAllGroupActivities(): Promise<void> {
  await HitherLiveActivity?.endAllGroupActivities?.();
}
