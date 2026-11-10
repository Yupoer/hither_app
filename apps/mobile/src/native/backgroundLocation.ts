import * as Location from 'expo-location';
import { AppState } from 'react-native';
import type { BackgroundLocationAdapter } from '../state/backgroundJourneyController';
import { captureLocationAccess, isLocationAccessCurrent, type LocationAccess } from '../state/locationPrivacy';
import { isForegroundLocationState } from '../utils/locationPolicy';
import { requestWithDeadline } from '../utils/requestDeadline';

const BACKGROUND_REFRESH_TIMEOUT_MS = 15_000;

export const backgroundLocationAdapter: BackgroundLocationAdapter = {
  requestForegroundPermissionsAsync: Location.requestForegroundPermissionsAsync,
  requestBackgroundPermissionsAsync: Location.requestBackgroundPermissionsAsync,
  hasStartedLocationUpdatesAsync: Location.hasStartedLocationUpdatesAsync,
  stopLocationUpdatesAsync: Location.stopLocationUpdatesAsync,
  async startLocationUpdatesAsync(name, options) {
    const access = await captureLocationAccess();
    if (!access || AppState.currentState !== 'background') throw new Error('location_access_denied');
    if ((await Location.getBackgroundPermissionsAsync()).status !== 'granted') {
      throw new Error('background_location_permission_denied');
    }
    if (!isLocationAccessCurrent(access) || AppState.currentState !== 'background') throw new Error('location_access_denied');
    await Location.startLocationUpdatesAsync(name, options);
    if (!isLocationAccessCurrent(access) || AppState.currentState !== 'background') {
      await Location.stopLocationUpdatesAsync(name);
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
