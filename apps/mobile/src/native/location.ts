/**
 * Device location boundary.
 *
 * This is the ONLY module in the JS layer that imports `expo-location`.
 * Screens and state must go through these functions, never the Expo module
 * directly — that keeps the device-capability surface swappable (Route A:
 * a custom native module can later back the same interface, see
 * `apps/mobile/modules/hither-location` / Phase B).
 *
 * Phase A: backed by `expo-location` (foreground positioning, works in
 * Expo Go). Background / high-accuracy positioning is the native module's job.
 *
 * Phase B seam: if the custom native module `HitherLocation`
 * (`apps/mobile/modules/hither-location`) is present — i.e. on an EAS Dev
 * Build — it backs these calls instead; in Expo Go it is absent and the
 * Expo implementation below runs. The interface is identical either way.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Location from 'expo-location';
import type { Coordinates } from '../types';
import { locationPolicy } from '../utils/locationPolicy';

/**
 * Optional custom native module. `null` in Expo Go / when not built.
 * Typed loosely on purpose — the contract is the exported functions below,
 * not this proxy.
 */
const HitherLocation = requireOptionalNativeModule<{
  getCurrentLocation(): Promise<LocationSample | null>;
}>('HitherLocation');

/** A single positioning sample. */
export interface LocationSample {
  coordinates: Coordinates;
  /** Horizontal accuracy in metres, when the platform reports it. */
  accuracy?: number | null;
  /** Epoch milliseconds the fix was taken. */
  timestamp: number;
}

function toSample(p: Location.LocationObject): LocationSample {
  return {
    coordinates: {
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
    },
    accuracy: p.coords.accuracy,
    timestamp: p.timestamp,
  };
}

/**
 * Ask for foreground location permission. Returns true if granted.
 * Safe to call repeatedly; the OS only prompts once.
 */
export async function requestPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

/**
 * One-shot current position. Returns null if permission is denied or the
 * fix fails, so callers can fall back gracefully (the Map screen still works
 * without GPS by using a reference member).
 */
function expoLocationOptions(highAccuracy: boolean): Location.LocationOptions {
  const policy = locationPolicy(highAccuracy, 'foreground');
  const accuracy =
    policy.accuracy === 'high'
      ? Location.Accuracy.High
      : policy.accuracy === 'low'
        ? Location.Accuracy.Low
        : Location.Accuracy.Balanced;
  return {
    accuracy,
    distanceInterval: policy.distanceInterval,
    timeInterval: policy.timeInterval,
  };
}

export async function getCurrentLocation(
  highAccuracy = false,
): Promise<LocationSample | null> {
  // Prefer the custom native module (precise/background-capable) when built.
  if (HitherLocation) {
    try {
      const sample = await HitherLocation.getCurrentLocation();
      if (sample) {
        return sample;
      }
      // null => native module not wired yet; fall through to expo-location
    } catch {
      // fall through to the Expo implementation
    }
  }
  const granted = await requestPermission();
  if (!granted) {
    return null;
  }
  try {
    const position = await Location.getCurrentPositionAsync(
      expoLocationOptions(highAccuracy),
    );
    return toSample(position);
  } catch {
    return null;
  }
}

/**
 * Stream foreground position updates until the returned unsubscribe is called.
 * Returns a no-op unsubscribe if permission is denied, so callers can start it
 * unconditionally. Foreground only — background tracking is the native
 * module's job (Phase B). High accuracy is opt-in; low power is the default.
 */
export async function watchLocation(
  onSample: (sample: LocationSample) => void,
  highAccuracy = false,
): Promise<() => void> {
  const granted = await requestPermission();
  if (!granted) {
    return () => {};
  }
  try {
    const sub = await Location.watchPositionAsync(
      expoLocationOptions(highAccuracy),
      (position) => onSample(toSample(position)),
    );
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
