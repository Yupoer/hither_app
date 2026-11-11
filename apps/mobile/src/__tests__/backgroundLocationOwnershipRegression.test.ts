import type { LocationObject, LocationOptions } from 'expo-location';

const mockStartExpo = jest.fn(async (_name: string, _options: object): Promise<void> => undefined);
const mockStopExpo = jest.fn(async (_name: string) => undefined);
const mockExpoStarted = jest.fn(async () => false);
const mockNative = {
  supportsOrdinaryBackgroundLiveUpdates: () => true,
  prepareBackgroundLocation: jest.fn(async (enabled: boolean) => enabled),
  hasBackgroundLocation: jest.fn(async () => false),
  startBackgroundLocation: jest.fn(async (_options: object) => true),
  stopBackgroundLocation: jest.fn(async () => undefined),
  addListener: jest.fn(),
};
const mockBackgroundPermission = jest.fn(async () => ({ status: 'granted' }));
const mockOneShot = jest.fn<Promise<LocationObject>, [LocationOptions]>();
const mockAppState = { currentState: 'active' };
const mockAccess = { generation: 1, groupId: 'g', signal: new AbortController().signal };
let mockAllowed = true;
let mockAccessChanged: () => void;

jest.mock('react-native', () => ({ AppState: mockAppState, Platform: { OS: 'ios' } }));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => mockNative }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: () => mockBackgroundPermission(),
  getCurrentPositionAsync: (options: LocationOptions) => mockOneShot(options),
  Accuracy: { Balanced: 3 },
  hasStartedLocationUpdatesAsync: () => mockExpoStarted(),
  startLocationUpdatesAsync: (name: string, options: object) => mockStartExpo(name, options),
  stopLocationUpdatesAsync: (name: string) => mockStopExpo(name),
}));
jest.mock('../state/locationPrivacy', () => ({
  captureLocationAccess: async () => mockAllowed ? mockAccess : null,
  isLocationAccessCurrent: () => mockAllowed,
  subscribeLocationAccessChanges: (listener: () => void) => { mockAccessChanged = listener; },
}));

import { backgroundLocationAdapter, captureBackgroundRefreshFix, observeNativeJourneyLocation, prepareNativeJourneyLocation } from '../native/backgroundLocation';
import { getBackgroundRefreshLocation } from '../native/location';
import { locationSourceHealth } from '../native/locationSourceHealth';
import { BACKGROUND_JOURNEY_TASK, backgroundLocationOptions } from '../state/backgroundJourneyController';

const journeyOptions = backgroundLocationOptions('journey', true, 'navigationMax');

beforeEach(async () => {
  await prepareNativeJourneyLocation(null);
  jest.clearAllMocks();
  mockAppState.currentState = 'active';
  mockAllowed = true;
  mockBackgroundPermission.mockResolvedValue({ status: 'granted' });
  mockOneShot.mockReset();
});

it('uses ordinary Expo background tracking during the journey only with background permission', async () => {
  mockAppState.currentState = 'background';
  mockBackgroundPermission.mockResolvedValueOnce({ status: 'denied' });
  await expect(backgroundLocationAdapter.startLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK, journeyOptions, 'journey'))
    .rejects.toThrow('background_location_permission_denied');
  expect(mockStartExpo).not.toHaveBeenCalled();

  await backgroundLocationAdapter.startLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK, journeyOptions, 'journey');
  expect(mockStartExpo).toHaveBeenCalledWith(BACKGROUND_JOURNEY_TASK, expect.objectContaining({
    accuracy: 4, activityType: 1, showsBackgroundLocationIndicator: false,
  }));
});

it('does not acquire background GPS while the map still owns the foreground', async () => {
  await expect(backgroundLocationAdapter.startLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK, journeyOptions, 'journey'))
    .rejects.toThrow('location_access_denied');
  expect(mockStartExpo).not.toHaveBeenCalled();
});

it('stops a background task whose Expo start completes after consent is revoked', async () => {
  mockAppState.currentState = 'background';
  let signalStarted!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  let completeStart!: () => void;
  const completion = new Promise<void>(resolve => { completeStart = resolve; });
  mockStartExpo.mockImplementationOnce(async () => { signalStarted(); await completion; mockExpoStarted.mockResolvedValueOnce(true); });
  const pending = backgroundLocationAdapter.startLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK, journeyOptions, 'journey');
  const rejected = expect(pending).rejects.toThrow('location_access_denied');
  await started;
  mockAllowed = false;
  completeStart();
  await rejected;
  expect(mockStopExpo).toHaveBeenCalledWith(BACKGROUND_JOURNEY_TASK);
});

it('prepares only the ordinary native session in the foreground and acquires one stream in the background', async () => {
  await expect(prepareNativeJourneyLocation('g')).resolves.toBe(true);
  expect(mockNative.prepareBackgroundLocation).toHaveBeenCalledWith(true);
  expect(mockNative.startBackgroundLocation).not.toHaveBeenCalled();
  mockAppState.currentState = 'background';
  mockExpoStarted.mockResolvedValueOnce(true);
  await backgroundLocationAdapter.startLocationUpdatesAsync(BACKGROUND_JOURNEY_TASK, journeyOptions, 'journey');
  expect(mockStopExpo.mock.invocationCallOrder[0]).toBeLessThan(mockNative.startBackgroundLocation.mock.invocationCallOrder[0]);
  expect(mockNative.startBackgroundLocation).toHaveBeenCalledWith(expect.objectContaining({
    accuracy: 4, activityType: 1, showsBackgroundLocationIndicator: false,
  }));
  expect(mockStartExpo).not.toHaveBeenCalled();
});

it('releases a native session if consent changes while iOS is preparing it', async () => {
  let started = () => {};
  const inFlight = new Promise<void>(resolve => { started = resolve; });
  let complete = (_ready: boolean) => {};
  const nativeReply = new Promise<boolean>(resolve => { complete = resolve; });
  mockNative.prepareBackgroundLocation.mockImplementationOnce(() => { started(); return nativeReply; });
  const preparing = prepareNativeJourneyLocation('g');
  await inFlight;
  mockAllowed = false;
  complete(true);
  await expect(preparing).resolves.toBe(false);
  expect(mockNative.prepareBackgroundLocation).toHaveBeenLastCalledWith(false);
});

it('reports a native interruption and fences late events after consent is revoked', async () => {
  const onSample = jest.fn();
  observeNativeJourneyLocation(onSample);
  const sample = { timestamp: Date.now(), coords: { latitude: 25, longitude: 121, accuracy: 5 } };
  const emit = (event: string, payload: unknown) =>
    mockNative.addListener.mock.calls.find(([name]) => name === event)?.[1](payload);
  await expect(prepareNativeJourneyLocation('g')).resolves.toBe(true);
  emit('onBackgroundLocation', sample);
  emit('onBackgroundLocationError', { code: 'location_stream_failed' });
  expect(onSample).toHaveBeenCalledWith(sample);
  expect(locationSourceHealth()).toEqual({ kind: 'interrupted', message: 'location_stream_failed' });

  mockNative.prepareBackgroundLocation.mockRejectedValueOnce(new Error('native session unavailable'));
  mockAllowed = false;
  mockAccessChanged();
  emit('onBackgroundLocation', sample);
  emit('onBackgroundLocationError', { code: 'late_native_error' });
  await expect(prepareNativeJourneyLocation('g')).resolves.toBe(false);
  expect(mockNative.prepareBackgroundLocation).toHaveBeenLastCalledWith(false);
  expect(onSample).toHaveBeenCalledTimes(1);
  expect(locationSourceHealth()).toEqual({ kind: 'interrupted', message: 'location_stream_failed' });
});

it('recognizes the prepared native owner only when an Expo task is not also running', async () => {
  await expect(prepareNativeJourneyLocation('g')).resolves.toBe(true);
  mockAppState.currentState = 'background';
  mockNative.hasBackgroundLocation.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
  mockExpoStarted.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await expect(backgroundLocationAdapter.hasMatchingLocationOwnerAsync?.(BACKGROUND_JOURNEY_TASK, 'journey')).resolves.toBe(true);
  await expect(backgroundLocationAdapter.hasMatchingLocationOwnerAsync?.(BACKGROUND_JOURNEY_TASK, 'journey')).resolves.toBe(false);
});

it('captures one Balanced background refresh fix only with existing background authorization', async () => {
  mockAppState.currentState = 'background';
  mockBackgroundPermission.mockResolvedValueOnce({ status: 'denied' });
  await expect(captureBackgroundRefreshFix(mockAccess)).resolves.toBeNull();
  expect(mockOneShot).not.toHaveBeenCalled();

  const sample = {
    timestamp: Date.now(),
    coords: { latitude: 25, longitude: 121, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
  };
  mockOneShot.mockResolvedValueOnce(sample);
  await expect(getBackgroundRefreshLocation(mockAccess)).resolves.toEqual({
    timestamp: sample.timestamp, coordinates: { latitude: 25, longitude: 121 }, accuracy: 5,
  });
  expect(mockOneShot).toHaveBeenCalledTimes(1);
  expect(mockOneShot).toHaveBeenCalledWith({ accuracy: 3, mayShowUserSettingsDialog: false });
  expect(mockStartExpo).not.toHaveBeenCalled();
  expect(mockStopExpo).not.toHaveBeenCalled();
});

it('releases a background refresh after the one-shot deadline', async () => {
  jest.useFakeTimers();
  try {
    mockAppState.currentState = 'background';
    mockOneShot.mockImplementationOnce(() => new Promise(() => {}));
    const timedOut = expect(captureBackgroundRefreshFix(mockAccess)).rejects.toThrow('request_timeout');
    await jest.advanceTimersByTimeAsync(15_000);
    await timedOut;
  } finally {
    jest.useRealTimers();
  }
});
