import * as Location from 'expo-location';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { AppState } from 'react-native';
import type { BackgroundLocationAdapter } from '../state/backgroundJourneyController';
import { captureLocationAccess, isLocationAccessCurrent, subscribeLocationAccessChanges, type LocationAccess } from '../state/locationPrivacy';
import { isForegroundLocationState } from '../utils/locationPolicy';
import { requestWithDeadline } from '../utils/requestDeadline';
import { reportLocationSourceHealth } from './locationSourceHealth';

const BACKGROUND_REFRESH_TIMEOUT_MS = 15_000;
const bridge = requireOptionalNativeModule<{
  supportsOrdinaryBackgroundLiveUpdates?: () => boolean;
  prepareBackgroundLocation(enabled: boolean): Promise<boolean>;
  hasBackgroundLocation(): Promise<boolean>;
  startBackgroundLocation(options: object): Promise<boolean>;
  stopBackgroundLocation(): Promise<void>;
  addListener(name: 'onBackgroundLocation', listener: (sample: Location.LocationObject) => void): void;
  addListener(name: 'onBackgroundLocationError', listener: (error: { code: string }) => void): void;
}>('HitherLocation');
const native = bridge?.supportsOrdinaryBackgroundLiveUpdates?.() === true ? bridge : null;
let sessionGeneration = 0;
let prepared: LocationAccess | null = null;
let preparation = Promise.resolve(false);

export function prepareNativeJourneyLocation(groupId: string | null): Promise<boolean> {
  if (!native) return preparation;
  const generation = ++sessionGeneration;
  prepared = null;
  const work = async () => {
    if (!groupId) return native.prepareBackgroundLocation(false);
    if (generation !== sessionGeneration || AppState.currentState !== 'active') return false;
    const access = await captureLocationAccess(groupId);
    if (!access || generation !== sessionGeneration || AppState.currentState !== 'active') return false;
    if (!await native.prepareBackgroundLocation(true)) return false;
    if (generation !== sessionGeneration || !isLocationAccessCurrent(access)) {
      await native.prepareBackgroundLocation(false);
      return false;
    }
    prepared = access;
    return true;
  };
  const result = preparation.then(work);
  preparation = result.catch(() => false);
  return result;
}

export function observeNativeJourneyLocation(onSample: (sample: Location.LocationObject) => void): void {
  native?.addListener('onBackgroundLocation', sample => {
    if (prepared && isLocationAccessCurrent(prepared)) onSample(sample);
  });
  native?.addListener('onBackgroundLocationError', ({ code }) => {
    if (prepared && isLocationAccessCurrent(prepared)) reportLocationSourceHealth({ kind: 'interrupted', message: code });
  });
}

subscribeLocationAccessChanges(() => {
  if (prepared && !isLocationAccessCurrent(prepared)) void prepareNativeJourneyLocation(null).catch(() => undefined);
});

export const backgroundLocationAdapter: BackgroundLocationAdapter = {
  requestForegroundPermissionsAsync: Location.requestForegroundPermissionsAsync,
  requestBackgroundPermissionsAsync: Location.requestBackgroundPermissionsAsync,
  async hasStartedLocationUpdatesAsync(name) {
    return Boolean(await native?.hasBackgroundLocation()) || await Location.hasStartedLocationUpdatesAsync(name);
  },
  async hasMatchingLocationOwnerAsync(name, profile) {
    if (profile === 'journey') await preparation;
    const wantsNative = profile === 'journey' && prepared != null && isLocationAccessCurrent(prepared);
    const nativeRunning = Boolean(await native?.hasBackgroundLocation());
    const expoRunning = await Location.hasStartedLocationUpdatesAsync(name);
    return wantsNative ? nativeRunning && !expoRunning : expoRunning && !nativeRunning;
  },
  async stopLocationUpdatesAsync(name) {
    await native?.stopBackgroundLocation();
    if (await Location.hasStartedLocationUpdatesAsync(name)) await Location.stopLocationUpdatesAsync(name);
  },
  async startLocationUpdatesAsync(name, options, profile) {
    const access = await captureLocationAccess();
    if (!access || AppState.currentState !== 'background') throw new Error('location_access_denied');
    if (profile === 'journey') await preparation;
    else if (prepared) await prepareNativeJourneyLocation(null);
    if ((await Location.getBackgroundPermissionsAsync()).status !== 'granted') {
      throw new Error('background_location_permission_denied');
    }
    if (!isLocationAccessCurrent(access) || AppState.currentState !== 'background') throw new Error('location_access_denied');
    if (native && profile === 'journey' && prepared && isLocationAccessCurrent(prepared)) {
      if (await Location.hasStartedLocationUpdatesAsync(name)) await Location.stopLocationUpdatesAsync(name);
      if (!isLocationAccessCurrent(access) || !await native.startBackgroundLocation(options)) {
        throw new Error('background_location_not_prepared');
      }
    } else {
      await Location.startLocationUpdatesAsync(name, options);
    }
    if (!isLocationAccessCurrent(access) || AppState.currentState !== 'background') {
      await backgroundLocationAdapter.stopLocationUpdatesAsync(name);
      throw new Error('location_access_denied');
    }
  },
};

export async function captureBackgroundRefreshFix(access: LocationAccess): Promise<Location.LocationObject | null> {
  const background = await Location.getBackgroundPermissionsAsync();
  if (background.status !== 'granted' || isForegroundLocationState(AppState.currentState)
    || !isLocationAccessCurrent(access)) return null;
  return requestWithDeadline(() => Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false,
  }), BACKGROUND_REFRESH_TIMEOUT_MS, access.signal);
}
