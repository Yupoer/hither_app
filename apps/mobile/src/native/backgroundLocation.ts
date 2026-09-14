import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Location from 'expo-location';
import type { BackgroundLocationAdapter } from '../state/backgroundJourneyController';
import { captureLocationAccess, isLocationAccessCurrent, isLocationAccessEnabled, subscribeLocationAccessChanges } from '../state/locationPrivacy';

type NativeFix = Location.LocationObject & { stationary?: boolean };
const native = requireOptionalNativeModule<{
  supportsBackgroundLiveUpdates?: () => boolean;
  prepareBackgroundLocation(enabled: boolean): Promise<boolean>;
  hasBackgroundLocation(): Promise<boolean>;
  startBackgroundLocation(options: object): Promise<boolean>;
  stopBackgroundLocation(): Promise<void>;
  addListener(name: string, listener: (sample: NativeFix) => void): { remove(): void };
}>('HitherLocation');
const supported = native?.supportsBackgroundLiveUpdates?.() === true;
export const nativeBackgroundAvailable = supported;

export async function prepareNativeBackgroundLocation(enabled: boolean): Promise<boolean> {
  return supported ? native!.prepareBackgroundLocation(enabled) : true;
}

export function observeNativeBackgroundLocation(onSample: (sample: NativeFix) => void): void {
  if (supported) native!.addListener('onBackgroundLocation', onSample);
}

subscribeLocationAccessChanges(() => {
  if (!isLocationAccessEnabled()) void prepareNativeBackgroundLocation(false).catch(() => undefined);
});

/** One background owner; Expo remains the older-iOS/Android fallback. */
export const backgroundLocationAdapter: BackgroundLocationAdapter = {
  requestForegroundPermissionsAsync: Location.requestForegroundPermissionsAsync,
  requestBackgroundPermissionsAsync: Location.requestBackgroundPermissionsAsync,
  async hasStartedLocationUpdatesAsync(name) {
    return (supported && await native!.hasBackgroundLocation())
      || await Location.hasStartedLocationUpdatesAsync(name);
  },
  async stopLocationUpdatesAsync(name) {
    if (supported) await native!.stopBackgroundLocation();
    if (await Location.hasStartedLocationUpdatesAsync(name)) await Location.stopLocationUpdatesAsync(name);
  },
  async startLocationUpdatesAsync(name, options) {
    const access = await captureLocationAccess();
    if (!access) throw new Error('location_access_denied');
    if (supported) {
      if (await Location.hasStartedLocationUpdatesAsync(name)) await Location.stopLocationUpdatesAsync(name);
      if (!isLocationAccessCurrent(access)) throw new Error('location_access_denied');
      if (!await native!.startBackgroundLocation(options)) throw new Error('background_location_not_prepared');
    } else {
      await Location.startLocationUpdatesAsync(name, options);
    }
    if (!isLocationAccessCurrent(access)) {
      await backgroundLocationAdapter.stopLocationUpdatesAsync(name);
      throw new Error('location_access_denied');
    }
  },
};

/** A refresh waits for the existing owner; it never starts a second GPS stream. */
export async function nextBackgroundLocation(signal: AbortSignal): Promise<NativeFix | null> {
  if (!supported || !await native!.hasBackgroundLocation() || signal.aborted) return null;
  return new Promise(resolve => {
    let subscription: { remove(): void } | undefined;
    const finish = (sample: NativeFix | null) => {
      clearTimeout(timeout);
      subscription?.remove();
      signal.removeEventListener('abort', abort);
      resolve(signal.aborted ? null : sample);
    };
    const abort = () => finish(null);
    const timeout = setTimeout(abort, 15_000);
    signal.addEventListener('abort', abort, {once:true});
    subscription = native!.addListener('onBackgroundLocation', finish);
    if (signal.aborted) abort();
  });
}
