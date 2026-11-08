const mockPrepare = jest.fn(async (_enabled: boolean) => true);
const mockHasNative = jest.fn(async () => false);
const mockStartNative = jest.fn(async (_options: object) => true);
const mockStopNative = jest.fn(async () => undefined);
const mockHasExpo = jest.fn(async () => false);
const mockStartExpo = jest.fn(async (_name: string, _options: object) => undefined);
const mockStopExpo = jest.fn(async () => undefined);
const mockBackgroundPermission = jest.fn(async () => ({ status: 'granted' }));
const mockForegroundPermission = jest.fn(async () => ({ status: 'granted' }));
const mockOneShot = jest.fn<Promise<import('expo-location').LocationObject>, [import('expo-location').LocationOptions]>();
const mockAppState = { currentState: 'active' };
const mockRemoveListener = jest.fn();
let mockBackgroundListener: ((sample: import('expo-location').LocationObject) => void) | undefined;
jest.mock('react-native', () => ({ AppState: mockAppState }));
let mockAllowed = true;
let mockAccessChanged: (() => void) | undefined;
const mockAccess = { generation: 1, groupId: 'g', signal: new AbortController().signal };
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => ({
  supportsBackgroundLiveUpdates: () => true,
  prepareBackgroundLocation: (enabled: boolean) => mockPrepare(enabled),
  hasBackgroundLocation: () => mockHasNative(),
  startBackgroundLocation: (options: object) => mockStartNative(options),
  stopBackgroundLocation: () => mockStopNative(),
  addListener: (name: string, listener: typeof mockBackgroundListener) => {
    if (name === 'onBackgroundLocation') mockBackgroundListener = listener;
    return { remove: mockRemoveListener };
  },
}) }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: () => mockBackgroundPermission(),
  getForegroundPermissionsAsync: () => mockForegroundPermission(),
  getCurrentPositionAsync: (options: import('expo-location').LocationOptions) => mockOneShot(options),
  Accuracy: { Balanced: 3 },
  hasStartedLocationUpdatesAsync: () => mockHasExpo(),
  startLocationUpdatesAsync: (name: string, options: object) => mockStartExpo(name, options),
  stopLocationUpdatesAsync: () => mockStopExpo(),
}));
jest.mock('../state/locationPrivacy', () => ({
  captureLocationAccess: async () => mockAllowed ? mockAccess : null,
  isLocationAccessCurrent: () => mockAllowed,
  isLocationAccessEnabled: () => mockAllowed,
  isLocationAccessPending: () => false,
  subscribeLocationAccessChanges: (listener: () => void) => { mockAccessChanged = listener; return () => undefined; },
}));
import { backgroundLocationAdapter, captureBackgroundRefreshFix, nextBackgroundLocation, observeNativeBackgroundLocation, prepareNativeBackgroundLocation } from '../native/backgroundLocation';
import { getBackgroundRefreshLocation } from '../native/location';
import { backgroundPresenceConfig, backgroundLocationOptions, hasActiveBackgroundJourney, resolveBackgroundTrackingMode, type BackgroundJourneyConfig } from '../state/backgroundJourneyController';
const task = 'hither-background-journey-location';
beforeEach(async () => {
  mockAppState.currentState = 'active'; mockAllowed = true;
  mockPrepare.mockReset().mockResolvedValue(true); mockStartNative.mockReset().mockResolvedValue(true);
  await prepareNativeBackgroundLocation(false);
  jest.clearAllMocks(); mockBackgroundPermission.mockResolvedValue({ status: 'granted' });
  mockForegroundPermission.mockResolvedValue({ status: 'granted' });
  mockOneShot.mockReset();
  mockHasExpo.mockResolvedValue(false); mockHasNative.mockResolvedValue(false);
  mockBackgroundListener = undefined;
});
async function settle() { for (let index = 0; index < 20; index += 1) await Promise.resolve(); }

it('uses the passive Always-permission Expo owner without a live navigation activity for all-day presence', async () => {
  const passiveOptions = { accuracy: 2, activityType: 1, distanceInterval: 150, timeInterval: 150_000,
    showsBackgroundLocationIndicator: false };
  mockAppState.currentState = 'background';
  await backgroundLocationAdapter.startLocationUpdatesAsync(task, passiveOptions);
  expect(mockStartExpo).toHaveBeenCalledWith(task, passiveOptions);
  expect(mockStartNative).not.toHaveBeenCalled();
  expect(mockPrepare).not.toHaveBeenCalledWith(true);
});

it('releases a prepared navigation activity on sharing OFF even when no location update stream ever started', async () => {
  await prepareNativeBackgroundLocation(true);
  expect(mockHasNative).not.toHaveBeenCalled();
  expect(mockStartNative).not.toHaveBeenCalled();
  mockAllowed = false;
  mockAccessChanged?.();
  await settle();
  expect(mockPrepare.mock.calls.map(([enabled]) => enabled)).toEqual([true, false]);
});

it('does not retain a native owner when sharing OFF races a delayed native start', async () => {
  let release!: (allowed: boolean) => void;
  mockStartNative.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await prepareNativeBackgroundLocation(true);
  mockAppState.currentState = 'background';
  const pending = backgroundLocationAdapter.startLocationUpdatesAsync(task, { activityType: 3, accuracy: 4, showsBackgroundLocationIndicator: true });
  const rejection = expect(pending).rejects.toThrow('location_access_denied');
  await settle();
  expect(mockStartNative).toHaveBeenCalledTimes(1);
  mockAllowed = false;
  mockAccessChanged?.();
  release(true);
  await rejection;
  expect(mockPrepare).toHaveBeenLastCalledWith(false);
  expect(mockStopNative).toHaveBeenCalledTimes(1);
});

it('does not start passive GPS or a native activity when Always permission is missing', async () => {
  mockAppState.currentState = 'background';
  mockBackgroundPermission.mockResolvedValue({ status: 'denied' });
  await expect(backgroundLocationAdapter.startLocationUpdatesAsync(task, {
    activityType: 1, accuracy: 2, showsBackgroundLocationIndicator: false,
  })).rejects.toThrow();
  expect(mockStartNative).not.toHaveBeenCalled();
  expect(mockStartExpo).not.toHaveBeenCalled();
  expect(mockPrepare).not.toHaveBeenCalledWith(true);
});

it('cancels a delayed preparation when Pause releases the activity before its promise resolves', async () => {
  let release!: (prepared: boolean) => void;
  mockPrepare.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const preparing = prepareNativeBackgroundLocation(true);
  await settle();
  const paused = prepareNativeBackgroundLocation(false);
  release(true);
  await expect(preparing).resolves.toBe(false);
  await paused;
  expect(mockPrepare).toHaveBeenLastCalledWith(false);
});

it('keeps the newer Start prepared when an older delayed preparation finishes after Pause and Start', async () => {
  let release!: (prepared: boolean) => void;
  mockPrepare.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const older = prepareNativeBackgroundLocation(true);
  await settle();
  const paused = prepareNativeBackgroundLocation(false);
  const newer = prepareNativeBackgroundLocation(true);
  release(true);
  await expect(older).resolves.toBe(false);
  await paused;
  await expect(newer).resolves.toBe(true);
  expect(mockPrepare.mock.calls.map(([enabled]) => enabled)).toEqual([true, false, true]);
  expect(mockPrepare).toHaveBeenLastCalledWith(true);
});

it('does not create a native activity from a cold background preparation call', async () => {
  mockAppState.currentState = 'background';
  await expect(prepareNativeBackgroundLocation(true)).resolves.toBe(false);
  expect(mockPrepare).not.toHaveBeenCalledWith(true);
});

it('does not acquire background GPS while the map still owns the foreground', async () => {
  await expect(backgroundLocationAdapter.startLocationUpdatesAsync(task, {
    activityType: 1, accuracy: 2, showsBackgroundLocationIndicator: false,
  })).rejects.toThrow();
  expect(mockStartExpo).not.toHaveBeenCalled();
  expect(mockStartNative).not.toHaveBeenCalled();
});

it('recognizes exactly one owner matching the passive or prepared journey profile', async () => {
  const passive = { activityType: 1, showsBackgroundLocationIndicator: false };
  const journey = { activityType: 3, showsBackgroundLocationIndicator: true };
  mockHasExpo.mockResolvedValue(true);
  await expect(backgroundLocationAdapter.hasMatchingLocationOwnerAsync!(task, passive)).resolves.toBe(true);
  mockHasNative.mockResolvedValue(true);
  await expect(backgroundLocationAdapter.hasMatchingLocationOwnerAsync!(task, passive)).resolves.toBe(false);
  await prepareNativeBackgroundLocation(true);
  await expect(backgroundLocationAdapter.hasMatchingLocationOwnerAsync!(task, journey)).resolves.toBe(false);
  mockHasExpo.mockResolvedValue(false);
  await expect(backgroundLocationAdapter.hasMatchingLocationOwnerAsync!(task, journey)).resolves.toBe(true);
  await prepareNativeBackgroundLocation(false);
  await expect(backgroundLocationAdapter.hasMatchingLocationOwnerAsync!(task, journey)).resolves.toBe(false);
});

it('forwards native samples to the journey observer without preparing or starting GPS', () => {
  const onSample = jest.fn();
  observeNativeBackgroundLocation(onSample);
  const sample = { timestamp: 1000, coords: { latitude: 25, longitude: 121, altitude: null,
    accuracy: 10, altitudeAccuracy: null, heading: null, speed: null } };
  mockBackgroundListener!(sample);
  expect(onSample).toHaveBeenCalledWith(sample);
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockStartNative).not.toHaveBeenCalled();
  expect(mockStartExpo).not.toHaveBeenCalled();
});

it('returns no native refresh for a passive Expo owner instead of acquiring a new stream', async () => {
  mockHasExpo.mockResolvedValue(true);
  await expect(nextBackgroundLocation(new AbortController().signal)).resolves.toBeNull();
  expect(mockBackgroundListener).toBeUndefined();
  expect(mockStartNative).not.toHaveBeenCalled();
  expect(mockStartExpo).not.toHaveBeenCalled();
});

it('refreshes from an existing native owner and releases its listener without starting another GPS stream', async () => {
  mockAppState.currentState = 'background';
  mockHasNative.mockResolvedValue(true);
  const refresh = captureBackgroundRefreshFix(mockAccess);
  await settle();
  const sample = { timestamp: 1000, coords: { latitude: 25, longitude: 121, altitude: null,
    accuracy: 10, altitudeAccuracy: null, heading: null, speed: null } };
  expect(mockBackgroundListener).toBeDefined();
  mockBackgroundListener!(sample);
  await expect(refresh).resolves.toEqual(sample);
  expect(mockRemoveListener).toHaveBeenCalledTimes(1);
  expect(mockStartNative).not.toHaveBeenCalled();
  expect(mockStartExpo).not.toHaveBeenCalled();
  expect(mockOneShot).not.toHaveBeenCalled();
});

it('aborts a pending existing-owner refresh and removes the temporary listener', async () => {
  mockHasNative.mockResolvedValue(true);
  const controller = new AbortController();
  const refresh = nextBackgroundLocation(controller.signal);
  await settle();
  controller.abort();
  await expect(refresh).resolves.toBeNull();
  expect(mockRemoveListener).toHaveBeenCalledTimes(1);
  expect(mockStopNative).not.toHaveBeenCalled();
});

it('times out an unresponsive existing owner without retaining a listener or acquiring a replacement owner', async () => {
  jest.useFakeTimers();
  try {
    mockHasNative.mockResolvedValue(true);
    const refresh = nextBackgroundLocation(new AbortController().signal);
    await settle();
    jest.advanceTimersByTime(15_000);
    await expect(refresh).resolves.toBeNull();
    expect(mockRemoveListener).toHaveBeenCalledTimes(1);
    expect(mockStartNative).not.toHaveBeenCalled();
    expect(mockStartExpo).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

const validJourney: BackgroundJourneyConfig = {
  groupId: 'g', navigationSessionId: 'server-session', destinationId: 'target',
  destination: { latitude: 25, longitude: 121 }, arrivalRadiusMeters: 50,
  initialDistanceM: 1000, sequence: 0, travelMode: 'walk', sharingEnabled: true,
  highAccuracy: true, powerMode: 'journey', teamNavigationActive: true,
  target: { id: 'target', title: 'Target', order: 0, day: 1, coordinates: { latitude: 25, longitude: 121 } },
};
it.each([
  { target: undefined },
  { navigationSessionId: null },
  { teamNavigationActive: false },
  { target: { ...validJourney.target!, id: 'another-point' } },
  { target: { ...validJourney.target!, closedAt: '2026-10-08T09:00:00Z' } },
])('never promotes missing or inactive destination intent into navigation GPS: %j', overrides => {
  const noJourney = { ...validJourney, ...overrides };
  expect(hasActiveBackgroundJourney(noJourney)).toBe(false);
  const presence = backgroundPresenceConfig(noJourney);
  expect(resolveBackgroundTrackingMode(presence)).toBe('passiveBackground');
  expect(backgroundLocationOptions(presence.powerMode!, presence.highAccuracy ?? false,
    resolveBackgroundTrackingMode(presence))).toMatchObject({ accuracy: 3, activityType: 1,
    showsBackgroundLocationIndicator: false, distanceInterval: 300 });
});

it('captures one passive refresh fix only with existing background authorization', async () => {
  mockAppState.currentState = 'background';
  mockHasExpo.mockResolvedValue(true);
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

it('releases a passive refresh task after the one-shot deadline', async () => {
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
