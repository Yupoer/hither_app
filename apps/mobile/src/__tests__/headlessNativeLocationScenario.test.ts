import type { BackgroundJourneyConfig } from '../state/backgroundJourneyController';

const { createExternalNative } = require('../../test/headless/external-native.cjs');
const { createStrict } = require('../../test/headless/runtime.cjs');

describe.each(['ios', 'android'])('real background location wrapper and owner on %s', platform => {
  let native: ReturnType<typeof createExternalNative>;
  let state: { currentState: string };
  let values: Map<string, string>;
  let tasks: Map<string, object>;
  let sdk: { foreground: string; background: string; startError: string | null; stopError: string | null; hasError: string | null };
  let calls: { method: string; value?: unknown }[];
  const failures: string[] = [];
  const strict = createStrict((message: string) => { failures.push(message); throw new Error(message); });
  let wrapper: typeof import('../native/backgroundLocation');
  let privacy: typeof import('../state/locationPrivacy');
  let owner: ReturnType<typeof import('../state/backgroundJourneyController')['createBackgroundJourneyController']>;
  let taskName: string;
  let configKey: string;
  const config = (patch: Partial<BackgroundJourneyConfig> = {}): BackgroundJourneyConfig => ({
    actorId: 'native-location-actor', groupId: 'native-location-group', navigationSessionId: 'journey', destinationId: 'target',
    destination: { latitude: 25.1, longitude: 121.1 }, arrivalRadiusMeters: 50, initialDistanceM: 1000,
    sequence: 0, travelMode: 'walk', sharingEnabled: true, hasMembership: true,
    powerMode: 'journey', teamNavigationActive: true, appState: 'background', permissionsPrepared: true,
    target: { id: 'target', title: 'Target', order: 0, day: 1, coordinates: { latitude: 25.1, longitude: 121.1 } }, ...patch,
  });
  async function settle() { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); }
  function load() {
    privacy = require('../state/locationPrivacy');
    privacy.setLocationAccessContext('native-location-group', true, true);
    wrapper = require('../native/backgroundLocation');
    const controller = require('../state/backgroundJourneyController');
    taskName = controller.BACKGROUND_JOURNEY_TASK;
    configKey = controller.BACKGROUND_JOURNEY_KEY;
    owner = controller.createBackgroundJourneyController(wrapper.backgroundLocationAdapter, require('@react-native-async-storage/async-storage'));
  }
  async function startJourney() {
    await expect(wrapper.prepareNativeBackgroundLocation(true)).resolves.toBe(true);
    state.currentState = 'background';
    await expect(owner.start(config())).resolves.toBe('started');
  }
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    failures.length = 0;
    state = { currentState: 'active' };
    values = new Map([['pref.sharingEnabled', 'true']]);
    tasks = new Map();
    calls = [];
    sdk = { foreground: 'granted', background: 'granted', startError: null, stopError: null, hasError: null };
    native = createExternalNative({ platform, strict, profile: { nativeLocation: true } });
    const storage = strict('AsyncStorage', {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
    });
    jest.doMock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: storage, ...storage }));
    jest.doMock('react-native', () => strict('react-native', { AppState: state, Platform: { OS: platform } }));
    jest.doMock('expo-modules-core', () => strict('expo-modules-core', {
      requireOptionalNativeModule: (name: string) => {
        if (!Object.hasOwn(native.nativeModules, name)) throw new Error(`Unknown optional native module ${name}`);
        return native.nativeModules[name];
      },
    }));
    jest.doMock('expo-location', () => strict('expo-location', {
      requestForegroundPermissionsAsync: async () => { calls.push({ method: 'expo.foregroundPermission' }); return { status: sdk.foreground }; },
      requestBackgroundPermissionsAsync: async () => { calls.push({ method: 'expo.backgroundPermission' }); return { status: sdk.background }; },
      getBackgroundPermissionsAsync: async () => ({ status: sdk.background }),
      hasStartedLocationUpdatesAsync: async (name: string) => { if (sdk.hasError) throw new Error(sdk.hasError); return tasks.has(name); },
      startLocationUpdatesAsync: async (name: string, options: object) => {
        calls.push({ method: 'expo.start', value: { name, options } });
        if (sdk.startError) throw new Error(sdk.startError);
        tasks.set(name, options);
      },
      stopLocationUpdatesAsync: async (name: string) => {
        calls.push({ method: 'expo.stop', value: name });
        if (sdk.stopError) throw new Error(sdk.stopError);
        tasks.delete(name);
      },
    }));
  });
  afterEach(async () => {
    if (wrapper) {
      await owner.stop();
      await wrapper.prepareNativeBackgroundLocation(false);
      expect(native.dispose().location).toMatchObject({ running: false, prepared: false });
      expect(native.dispose().location.processListeners).toBeLessThanOrEqual(1);
    }
    expect(tasks.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    expect(failures).toEqual([]);
  });

  it('MAP-LOC-07 transfers one real controller owner between passive presence and a prepared live journey', async () => {
    load();
    state.currentState = 'background';
    await expect(owner.start(config({ powerMode: 'allDay' }))).resolves.toBe('started');
    expect(tasks.get(taskName)).toMatchObject({ accuracy: 2, activityType: 1, showsBackgroundLocationIndicator: false });
    state.currentState = 'active';
    await startJourney();
    expect(await owner.load()).toMatchObject({ navigationSessionId: 'journey', destinationId: 'target', powerMode: 'journey' });
    expect(wrapper.nativeBackgroundAvailable).toBe(platform === 'ios');
    expect(native.observe().location).toMatchObject({ supported: platform === 'ios', running: platform === 'ios' });
    expect(tasks.size).toBe(platform === 'ios' ? 0 : 1);
    if (platform === 'android') expect(tasks.get(taskName)).toMatchObject({ accuracy: 4, activityType: 3, showsBackgroundLocationIndicator: true });
    const starts = () => calls.filter(call => call.method === 'expo.start').length
      + native.observe().receipts.filter((call: { method: string }) => call.method === 'nativeLocation.start').length;
    const started = starts();
    await owner.start(config());
    expect(starts()).toBe(started);
    await owner.start(config({ powerMode: 'allDay' }));
    expect(native.observe().location).toMatchObject({ running: false, prepared: false });
    expect(tasks.get(taskName)).toMatchObject({ accuracy: 2, activityType: 1, showsBackgroundLocationIndicator: false });
    await owner.stop();
    expect(values.has(configKey)).toBe(false);
    expect(tasks.size).toBe(0);
  });

  it.each(['foreground', 'background'])('MAP-LOC-07 preserves %s permission denial before the real controller acquires an owner', async denied => {
    load();
    if (denied === 'foreground') sdk.foreground = 'denied'; else sdk.background = 'denied';
    await expect(owner.preparePermissions()).resolves.toBe('permission_denied');
    expect(calls.map(call => call.method)).toEqual(denied === 'foreground'
      ? ['expo.foregroundPermission'] : ['expo.foregroundPermission', 'expo.backgroundPermission']);
    calls.length = 0;
    state.currentState = 'background';
    await expect(owner.start(config({ permissionsPrepared: false }))).resolves.toBe('permission_denied');
    expect(calls).toEqual([]);
    expect(values.has(configKey)).toBe(false);
    expect(native.observe().location.running).toBe(false);
  });

  it('MAP-LOC-07 rejects foreground acquisition and revoked real privacy consent without retaining GPS', async () => {
    load();
    await expect(wrapper.backgroundLocationAdapter.startLocationUpdatesAsync(taskName, {})).rejects.toThrow('location_owner_changed');
    privacy.setLocationSharingConsent(false);
    state.currentState = 'background';
    await expect(wrapper.backgroundLocationAdapter.startLocationUpdatesAsync(taskName, {})).rejects.toThrow('location_access_denied');
    await expect(owner.start(config({ sharingEnabled: false }))).resolves.toBe('hidden');
    expect(values.has(configKey)).toBe(false);
    expect(calls.some(call => call.method === 'expo.start')).toBe(false);
    expect(native.observe().receipts.some((call: { method: string }) => call.method === 'nativeLocation.start')).toBe(false);
  });

  it('MAP-LOC-07 keeps unsupported native builds on the real Expo fallback and denies passive GPS without background permission', async () => {
    native = createExternalNative({ platform, strict, profile: { nativeLocation: true, nativeLocationLiveUpdates: false } });
    load();
    expect(wrapper.nativeBackgroundAvailable).toBe(false);
    await startJourney();
    expect(tasks.get(taskName)).toMatchObject({ activityType: 3, showsBackgroundLocationIndicator: true });
    expect(native.observe().receipts.filter((call: { method: string }) => call.method.startsWith('nativeLocation.'))).toEqual([]);
    await owner.stop();
    sdk.background = 'denied';
    await expect(owner.start(config({ powerMode: 'allDay' }))).rejects.toThrow('passive_background_permission_denied');
    expect(values.has(configKey)).toBe(false);
    expect(tasks.size).toBe(0);
  });

  it('MAP-LOC-07 rolls back persisted ownership when the external native or Expo start fails', async () => {
    load();
    await wrapper.prepareNativeBackgroundLocation(true);
    state.currentState = 'background';
    if (platform === 'ios') await native.input({ kind: 'nativeLocationConfigure', patch: { startResult: false } });
    else sdk.startError = 'expo_start_failed';
    await expect(owner.start(config())).rejects.toThrow(platform === 'ios' ? 'background_location_not_prepared' : 'expo_start_failed');
    expect(values.has(configKey)).toBe(false);
    expect(tasks.size).toBe(0);
    expect(native.observe().location.running).toBe(false);
    if (platform === 'ios') await native.input({ kind: 'nativeLocationConfigure', patch: { startResult: true, startError: 'native_start_failed' } });
    await expect(owner.start(config())).rejects.toThrow(platform === 'ios' ? 'native_start_failed' : 'expo_start_failed');
    expect(values.has(configKey)).toBe(false);
  });

  it('MAP-LOC-07 retains the durable owner after a stop error and supports an explicit retry', async () => {
    load();
    await startJourney();
    if (platform === 'ios') await native.input({ kind: 'nativeLocationConfigure', patch: { stopError: 'native_stop_failed' } });
    else sdk.stopError = 'expo_stop_failed';
    await expect(owner.stop()).rejects.toThrow(platform === 'ios' ? 'native_stop_failed' : 'expo_stop_failed');
    expect(values.has(configKey)).toBe(true);
    expect(platform === 'ios' ? native.observe().location.running : tasks.has(taskName)).toBe(true);
    await native.input({ kind: 'nativeLocationConfigure', patch: { stopError: null } });
    sdk.stopError = null;
    await owner.stop();
    expect(values.has(configKey)).toBe(false);
    expect(platform === 'ios' ? native.observe().location.running : tasks.has(taskName)).toBe(false);
  });

  it('MAP-LOC-07 forwards an existing iOS owner sample through the real wrapper and disposes every temporary refresh listener', async () => {
    load();
    await startJourney();
    const observed = jest.fn();
    wrapper.observeNativeBackgroundLocation(observed);
    const sample = { timestamp: Date.now(), coords: { latitude: 25.01, longitude: 121.01, accuracy: 5 }, stationary: false };
    const refresh = wrapper.nextBackgroundLocation(new AbortController().signal);
    await settle();
    if (platform === 'android') {
      await expect(refresh).resolves.toBeNull();
      expect(native.observe().location.listeners).toBe(0);
      expect(observed).not.toHaveBeenCalled();
      return;
    }
    expect(native.observe().location.listeners).toBe(2);
    await native.input({ kind: 'nativeLocation', sample });
    await expect(refresh).resolves.toEqual(sample);
    expect(observed).toHaveBeenCalledWith(sample);
    expect(native.observe().location.listeners).toBe(1);
    const abort = new AbortController();
    const cancelled = wrapper.nextBackgroundLocation(abort.signal);
    await settle();
    abort.abort();
    await expect(cancelled).resolves.toBeNull();
    expect(native.observe().location.listeners).toBe(1);
    const timeout = wrapper.nextBackgroundLocation(new AbortController().signal);
    await settle();
    await jest.advanceTimersByTimeAsync(15000);
    await expect(timeout).resolves.toBeNull();
    expect(native.observe().location.listeners).toBe(1);
    expect(native.observe().receipts.filter((call: { method: string }) => call.method === 'nativeLocation.start')).toHaveLength(1);
  });

  it('MAP-LOC-07 releases a real access-signal refresh when sharing is revoked and does not acquire a replacement stream', async () => {
    load();
    await startJourney();
    const access = await privacy.captureLocationAccess();
    expect(access).not.toBeNull();
    if (!access) throw new Error('Location access was not established');
    const refresh = wrapper.nextBackgroundLocation(access.signal);
    await settle();
    values.set(privacy.LOCATION_SHARING_KEY, 'false');
    privacy.setLocationSharingConsent(false);
    await expect(refresh).resolves.toBeNull();
    await settle();
    expect(native.observe().location).toMatchObject({ running: false, prepared: false, listeners: 0 });
    await owner.stop();
    expect(tasks.size).toBe(0);
    expect(values.has(configKey)).toBe(false);
  });

  it('MAP-LOC-07 preserves native stream errors and removes the pending refresh on its real timeout', async () => {
    load();
    await startJourney();
    if (platform === 'android') {
      await expect(wrapper.nextBackgroundLocation(new AbortController().signal)).resolves.toBeNull();
      expect(native.observe().location.running).toBe(false);
      expect(tasks.has(taskName)).toBe(true);
      return;
    }
    const refresh = wrapper.nextBackgroundLocation(new AbortController().signal);
    await settle();
    await native.input({ kind: 'nativeLocationError', error: { code: 'location_stream_failed' } });
    await expect(wrapper.backgroundLocationAdapter.hasStartedLocationUpdatesAsync(taskName)).resolves.toBe(false);
    await jest.advanceTimersByTimeAsync(15000);
    await expect(refresh).resolves.toBeNull();
    expect(native.observe().location.listeners).toBe(0);
    await expect(owner.start(config())).resolves.toBe('started');
    expect(native.observe().location.running).toBe(true);
  });
});
