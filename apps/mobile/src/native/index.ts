/**
 * Native capability boundary (Route A).
 *
 * The JS layer touches device capabilities ONLY through `src/native/*`.
 * Import the namespaces from here so call sites read as `location.*`,
 * `notifications.*`, etc. and never reach for an Expo/native module directly.
 *
 *   import { location, maps } from '../native';
 *   const fix = await location.getCurrentLocation();
 *
 * Phase A backs these with Expo modules (Expo Go compatible). Phase B adds
 * custom Swift/Kotlin modules behind the same interfaces (EAS Dev Build).
 * `liquidGlass` is added in Phase C.
 */
export * as location from './location';
export * as maps from './maps';
export * as notifications from './notifications';
export * as liveActivity from './liveActivity';

export type { LocationSample, LocationSubscription } from './location';
export type { PlaceResult, MapRegion, DirectionsResult } from './maps';
export type { LocalNotificationInput } from './notifications';
export type { GroupActivityState, ActivityHandle } from './liveActivity';
