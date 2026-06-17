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

export type LocationCallback = (sample: LocationSample) => void;

/** Opaque handle returned by {@link watchLocation}; pass to {@link stopLocationWatch}. */
export interface LocationSubscription {
  remove: () => void;
}

export interface WatchOptions {
  /** Minimum metres moved before a new sample is delivered. Default 10. */
  distanceIntervalMeters?: number;
  /** Minimum milliseconds between samples. Default 4000. */
  timeIntervalMs?: number;
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
export async function getCurrentLocation(): Promise<LocationSample | null> {
  // Prefer the custom native module (precise/background-capable) when built.
  if (HitherLocation) {
    try {
      return await HitherLocation.getCurrentLocation();
    } catch {
      // fall through to the Expo implementation
    }
  }
  const granted = await requestPermission();
  if (!granted) {
    return null;
  }
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return toSample(position);
  } catch {
    return null;
  }
}

/**
 * Stream position updates until {@link stopLocationWatch} is called.
 * Returns null if permission is denied.
 */
export async function watchLocation(
  callback: LocationCallback,
  options: WatchOptions = {},
): Promise<LocationSubscription | null> {
  const granted = await requestPermission();
  if (!granted) {
    return null;
  }
  const sub = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: options.distanceIntervalMeters ?? 10,
      timeInterval: options.timeIntervalMs ?? 4000,
    },
    (position) => callback(toSample(position)),
  );
  return sub;
}

/** Stop a {@link watchLocation} stream. No-op for a null handle. */
export function stopLocationWatch(
  subscription: LocationSubscription | null,
): void {
  subscription?.remove();
}
