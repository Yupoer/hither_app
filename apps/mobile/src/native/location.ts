import { nextBackgroundLocation } from './backgroundLocation';
/** Device positioning boundary; consent is checked before and after asynchronous work. */
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { captureLocationAccess, isLocationAccessCurrent, subscribeLocationAccessChanges } from '../state/locationPrivacy';
import type { Coordinates } from '../types';
import { locationPolicy } from '../utils/locationPolicy';
import {
  getDebugLocationSample,
  isDebugRouteActive,
  subscribeDebugLocation,
} from './debugLocation';


/** A single positioning sample. */
export interface LocationSample {
  coordinates: Coordinates;
  /** Horizontal accuracy in metres, when the platform reports it. */
  accuracy?: number | null;
  /** Epoch milliseconds the fix was taken. */
  timestamp: number;
}

export interface LocationPermissionState {
  foregroundStatus: Location.PermissionStatus;
  foregroundCanAskAgain: boolean;
  backgroundStatus: Location.PermissionStatus | null;
  backgroundCanAskAgain: boolean;
}

/**
 * UI-facing permission class for Android UX copy.
 * Domain logic must not depend on platform-specific branches of this type.
 */
export type LocationPermissionUx =
  | 'granted'
  | 'foreground_denied'
  | 'background_denied'
  | 'approximate_only';

/**
 * Classify permission for user messaging. Approximate-only is inferred when
 * foreground is granted but the latest sample accuracy is very coarse
 * (≥ 500 m); callers pass the latest accuracy when available.
 */
export function classifyLocationPermissionUx(
  state: LocationPermissionState,
  latestAccuracyM?: number | null,
): LocationPermissionUx {
  if (state.foregroundStatus !== 'granted') return 'foreground_denied';
  if (state.backgroundStatus != null && state.backgroundStatus !== 'granted') {
    return 'background_denied';
  }
  if (
    latestAccuracyM != null &&
    Number.isFinite(latestAccuracyM) &&
    latestAccuracyM >= 500
  ) {
    return 'approximate_only';
  }
  return 'granted';
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

export async function getPermissionState(): Promise<LocationPermissionState> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    return {
      foregroundStatus: foreground.status,
      foregroundCanAskAgain: foreground.canAskAgain,
      backgroundStatus: null,
      backgroundCanAskAgain: true,
    };
  }

  try {
    const background = await Location.getBackgroundPermissionsAsync();
    return {
      foregroundStatus: foreground.status,
      foregroundCanAskAgain: foreground.canAskAgain,
      backgroundStatus: background.status,
      backgroundCanAskAgain: background.canAskAgain,
    };
  } catch {
    return {
      foregroundStatus: foreground.status,
      foregroundCanAskAgain: foreground.canAskAgain,
      backgroundStatus: null,
      backgroundCanAskAgain: true,
    };
  }
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
  const access = await captureLocationAccess();
  if (!access) return null;
  if (isDebugRouteActive()) {
    const debugSample = getDebugLocationSample();
    if (debugSample) return debugSample;
  }
  const granted = AppState.currentState === 'active'
    ? await requestPermission()
    : (await Location.getForegroundPermissionsAsync()).status === 'granted';
  if (!granted || !isLocationAccessCurrent(access)) {
    return null;
  }
  if (AppState.currentState !== 'active') {
    const fix = await nextBackgroundLocation(access.signal);
    return fix && isLocationAccessCurrent(access) ? toSample(fix) : null;
  }
  return new Promise<LocationSample | null>((resolve) => {
    let sub: Location.LocationSubscription | undefined;
    let settled = false;
    let unsubscribe = () => {};
    const finish = (sample: LocationSample | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      sub?.remove();
      if (!sample) { resolve(null); return; }
      void Location.getForegroundPermissionsAsync().then(permission =>
        resolve(permission.status === 'granted' && isLocationAccessCurrent(access) ? sample : null),
      ).catch(() => resolve(null));
    };
    const timeout = setTimeout(() => finish(null), 15_000);
    unsubscribe = subscribeLocationAccessChanges(() => finish(null));
    void Location.watchPositionAsync(expoLocationOptions(highAccuracy),
      position => finish(toSample(position)), () => finish(null))
      .then(subscription => {
        sub = subscription;
        if (settled || !isLocationAccessCurrent(access)) { sub.remove(); finish(null); }
      }).catch(() => finish(null));
  });
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
  const access = await captureLocationAccess();
  if (!access || AppState.currentState !== 'active') return () => {};
  const granted = await requestPermission();
  if (!granted || !isLocationAccessCurrent(access)) {
    return () => {};
  }
  let unsubscribeDebug = () => {};
  try {
    const accept = (sample: LocationSample) => {
      if (isLocationAccessCurrent(access) && AppState.currentState === 'active') onSample(sample);
    };
    unsubscribeDebug = subscribeDebugLocation(accept);
    const sub = await Location.watchPositionAsync(
      expoLocationOptions(highAccuracy),
      (position) => {
        if (!isDebugRouteActive()) accept(toSample(position));
      },
    );
    const stop = () => {
      unsubscribeDebug();
      sub.remove();
    };
    if (!isLocationAccessCurrent(access)) { stop(); return () => {}; }
    const unsubscribeAccess = subscribeLocationAccessChanges(stop);
    return () => { unsubscribeAccess(); stop(); };
  } catch {
    unsubscribeDebug();
    return () => {};
  }
}
