const mockLocationApi = {
  Accuracy: { High: 4, Low: 2, Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
};
const mockAppState = { currentState: 'active' as string };
const mockAccess = {
  generation: 1,
  groupId: 'group-1',
  signal: new AbortController().signal,
};
const mockCaptureAccess = jest.fn();
const mockIsAccessCurrent = jest.fn();
const mockSubscribeAccess = jest.fn();
const mockAccessUnsubscribe = jest.fn();
let mockAccessListener: (() => void) | undefined;
const mockNextBackgroundLocation = jest.fn();
const mockDebugActive = jest.fn();
const mockDebugSample = jest.fn();
const mockSubscribeDebug = jest.fn();
let mockDebugListener: ((sample: unknown) => void) | undefined;

jest.mock('expo-location', () => mockLocationApi);
jest.mock('react-native', () => ({ AppState: mockAppState }));
jest.mock('../native/backgroundLocation', () => ({
  nextBackgroundLocation: (...args: unknown[]) => mockNextBackgroundLocation(...args),
}));
jest.mock('../state/locationPrivacy', () => ({
  captureLocationAccess: (...args: unknown[]) => mockCaptureAccess(...args),
  isLocationAccessCurrent: (...args: unknown[]) => mockIsAccessCurrent(...args),
  subscribeLocationAccessChanges: (...args: unknown[]) => mockSubscribeAccess(...args),
}));
jest.mock('../native/debugLocation', () => ({
  isDebugRouteActive: () => mockDebugActive(),
  getDebugLocationSample: () => mockDebugSample(),
  subscribeDebugLocation: (listener: (sample: unknown) => void) => {
    mockDebugListener = listener;
    return mockSubscribeDebug(listener);
  },
}));

import {
  classifyLocationPermissionUx,
  getCurrentLocation,
  getPermissionState,
  requestPermission,
  watchLocation,
} from '../native/location';
import type { LocationPermissionState } from '../native/location';

const nativePosition = {
  coords: { latitude: 25.0478, longitude: 121.517, accuracy: 7 },
  timestamp: 123_456,
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('native location boundary lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppState.currentState = 'active';
    mockCaptureAccess.mockResolvedValue(mockAccess);
    mockIsAccessCurrent.mockReturnValue(true);
    mockSubscribeAccess.mockImplementation((listener: () => void) => {
      mockAccessListener = listener;
      return mockAccessUnsubscribe;
    });
    mockLocationApi.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLocationApi.getForegroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
    });
    mockLocationApi.getBackgroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
    });
    mockLocationApi.watchPositionAsync.mockImplementation(
      (_options: unknown, _onSample: (position: unknown) => void) =>
        Promise.resolve({ remove: jest.fn() }),
    );
    mockNextBackgroundLocation.mockResolvedValue(null);
    mockDebugActive.mockReturnValue(false);
    mockDebugSample.mockReturnValue(null);
    mockSubscribeDebug.mockImplementation(() => jest.fn());
    mockAccessListener = undefined;
    mockDebugListener = undefined;
  });

  it('classifies foreground, background, approximate, and invalid accuracy states', () => {
    const base = {
      foregroundStatus: 'granted',
      foregroundCanAskAgain: true,
      backgroundStatus: 'granted',
      backgroundCanAskAgain: true,
    } as unknown as LocationPermissionState;
    expect(classifyLocationPermissionUx({ ...base, foregroundStatus: 'denied' } as LocationPermissionState)).toBe('foreground_denied');
    expect(classifyLocationPermissionUx({ ...base, backgroundStatus: 'denied' } as LocationPermissionState)).toBe('background_denied');
    expect(classifyLocationPermissionUx(base, 500)).toBe('approximate_only');
    expect(classifyLocationPermissionUx(base, Number.NaN)).toBe('granted');
    expect(classifyLocationPermissionUx(base, null)).toBe('granted');
  });

  it('requests permission and reads background state with a safe fallback', async () => {
    await expect(requestPermission()).resolves.toBe(true);
    mockLocationApi.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    await expect(requestPermission()).resolves.toBe(false);

    mockLocationApi.getForegroundPermissionsAsync.mockResolvedValueOnce({
      status: 'denied',
      canAskAgain: false,
    });
    await expect(getPermissionState()).resolves.toEqual({
      foregroundStatus: 'denied',
      foregroundCanAskAgain: false,
      backgroundStatus: null,
      backgroundCanAskAgain: true,
    });

    await expect(getPermissionState()).resolves.toEqual({
      foregroundStatus: 'granted',
      foregroundCanAskAgain: true,
      backgroundStatus: 'granted',
      backgroundCanAskAgain: true,
    });
    mockLocationApi.getBackgroundPermissionsAsync.mockRejectedValueOnce(new Error('platform unavailable'));
    await expect(getPermissionState()).resolves.toMatchObject({
      foregroundStatus: 'granted',
      backgroundStatus: null,
    });
  });

  it('returns debug samples before asking the OS for a foreground fix', async () => {
    const debug = {
      coordinates: { latitude: 25, longitude: 121 },
      accuracy: 1,
      timestamp: 10,
    };
    mockDebugActive.mockReturnValue(true);
    mockDebugSample.mockReturnValue(debug);
    await expect(getCurrentLocation(true, 'journey')).resolves.toEqual(debug);
    expect(mockLocationApi.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockLocationApi.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('gets a foreground fix with the selected policy and rechecks permission', async () => {
    let onPosition!: (position: unknown) => void;
    const remove = jest.fn();
    mockLocationApi.watchPositionAsync.mockImplementationOnce((options: unknown, callback: (position: unknown) => void) => {
      onPosition = callback;
      expect(options).toMatchObject({ accuracy: 4, distanceInterval: 8, timeInterval: 5_000 });
      return Promise.resolve({ remove });
    });

    const reading = getCurrentLocation(true, 'journey');
    await settle();
    onPosition(nativePosition);
    await expect(reading).resolves.toEqual({
      coordinates: { latitude: 25.0478, longitude: 121.517 },
      accuracy: 7,
      timestamp: 123_456,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(mockSubscribeAccess).toHaveBeenCalledTimes(1);
    expect(mockAccessUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('cancels a foreground one-shot on access revocation and on timeout', async () => {
    const remove = jest.fn();
    mockLocationApi.watchPositionAsync.mockResolvedValueOnce({ remove });
    const cancelled = getCurrentLocation();
    await settle();
    mockAccessListener?.();
    await expect(cancelled).resolves.toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);

    jest.useFakeTimers();
    mockLocationApi.watchPositionAsync.mockImplementationOnce(() => new Promise(() => undefined));
    const timedOut = getCurrentLocation();
    await settle();
    await jest.advanceTimersByTimeAsync(15_000);
    await expect(timedOut).resolves.toBeNull();
    jest.useRealTimers();
  });

  it('uses the existing background owner while inactive and rejects stale access', async () => {
    mockAppState.currentState = 'background';
    mockNextBackgroundLocation.mockResolvedValueOnce(nativePosition);
    await expect(getCurrentLocation(false, 'allDay')).resolves.toEqual({
      coordinates: { latitude: 25.0478, longitude: 121.517 },
      accuracy: 7,
      timestamp: 123_456,
    });
    expect(mockLocationApi.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

    mockNextBackgroundLocation.mockResolvedValueOnce(nativePosition);
    mockIsAccessCurrent.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(getCurrentLocation()).resolves.toBeNull();
  });

  it('streams native and debug fixes, then removes every listener', async () => {
    let onPosition!: (position: unknown) => void;
    const nativeRemove = jest.fn();
    const debugRemove = jest.fn();
    mockSubscribeDebug.mockImplementationOnce(() => debugRemove);
    mockLocationApi.watchPositionAsync.mockImplementationOnce((_options: unknown, callback: (position: unknown) => void) => {
      onPosition = callback;
      return Promise.resolve({ remove: nativeRemove });
    });
    const onSample = jest.fn();
    const stop = await watchLocation(onSample, false, 'foreground');
    onPosition(nativePosition);
    mockDebugListener?.({ coordinates: { latitude: 25, longitude: 121 }, timestamp: 2 });
    expect(onSample).toHaveBeenCalledTimes(2);
    stop();
    expect(nativeRemove).toHaveBeenCalledTimes(1);
    expect(debugRemove).toHaveBeenCalledTimes(1);
    expect(mockAccessUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not forward inactive, denied, revoked, or failed streams', async () => {
    mockAppState.currentState = 'background';
    await expect(watchLocation(jest.fn())).resolves.toEqual(expect.any(Function));
    expect(mockLocationApi.watchPositionAsync).not.toHaveBeenCalled();

    mockAppState.currentState = 'active';
    mockLocationApi.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    await expect(watchLocation(jest.fn())).resolves.toEqual(expect.any(Function));

    mockLocationApi.watchPositionAsync.mockRejectedValueOnce(new Error('watch failed'));
    await expect(watchLocation(jest.fn())).resolves.toEqual(expect.any(Function));
    expect(mockSubscribeDebug).toHaveBeenCalled();

    mockLocationApi.watchPositionAsync.mockResolvedValueOnce({ remove: jest.fn() });
    mockIsAccessCurrent.mockReturnValue(false);
    await expect(watchLocation(jest.fn())).resolves.toEqual(expect.any(Function));
  });
});
