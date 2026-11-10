import type { BackgroundJourneyConfig } from '../state/backgroundJourneyController';

const { createExternalNative } = require('../../test/headless/external-native.cjs');
const { createStrict } = require('../../test/headless/runtime.cjs');

describe.each(['ios', 'android'])('real background location wrapper and owner on %s', platform => {
  let native: ReturnType<typeof createExternalNative>;
  let values: Map<string, string>;
  let tasks: Map<string, object>;
  let sdk: { foreground: string; background: string; startError: string | null; stopError: string | null };
  let calls: string[];
  const failures: string[] = [];
  const strict = createStrict((message: string) => { failures.push(message); throw new Error(message); });
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

  beforeEach(() => {
    jest.resetModules();
    failures.length = 0;
    const state = { currentState: 'active' };
    values = new Map([['pref.sharingEnabled', 'true']]);
    tasks = new Map();
    calls = [];
    sdk = { foreground: 'granted', background: 'granted', startError: null, stopError: null };
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
      requestForegroundPermissionsAsync: async () => { calls.push('foregroundPermission'); return { status: sdk.foreground }; },
      requestBackgroundPermissionsAsync: async () => { calls.push('backgroundPermission'); return { status: sdk.background }; },
      getBackgroundPermissionsAsync: async () => ({ status: sdk.background }),
      hasStartedLocationUpdatesAsync: async (name: string) => tasks.has(name),
      startLocationUpdatesAsync: async (name: string, options: object) => {
        if (sdk.startError) throw new Error(sdk.startError);
        tasks.set(name, options);
      },
      stopLocationUpdatesAsync: async (name: string) => {
        if (sdk.stopError) throw new Error(sdk.stopError);
        tasks.delete(name);
      },
    }));
    require('../state/locationPrivacy').setLocationAccessContext('native-location-group', true, true);
    const { backgroundLocationAdapter } = require('../native/backgroundLocation');
    const controller = require('../state/backgroundJourneyController');
    taskName = controller.BACKGROUND_JOURNEY_TASK;
    configKey = controller.BACKGROUND_JOURNEY_KEY;
    owner = controller.createBackgroundJourneyController(backgroundLocationAdapter, storage);
    state.currentState = 'background';
  });

  afterEach(async () => {
    sdk.stopError = null;
    await owner.stop();
    expect(tasks.size).toBe(0);
    expect(native.dispose().location).toMatchObject({ running: false, prepared: false, processListeners: 0 });
    expect(failures).toEqual([]);
  });

  it('MAP-LOC-07 transfers one real controller owner between passive presence and the ordinary journey task', async () => {
    const passive = config({ powerMode: 'allDay' });
    await expect(owner.start(passive)).resolves.toBe('started');
    expect(tasks.get(taskName)).toMatchObject({ accuracy: 3, timeInterval: 600_000, showsBackgroundLocationIndicator: false });
    await expect(owner.start(config())).resolves.toBe('started');
    expect(await owner.load()).toMatchObject({ navigationSessionId: 'journey', destinationId: 'target', powerMode: 'journey' });
    expect(tasks.size).toBe(1);
    expect(tasks.get(taskName)).toMatchObject({ accuracy: 4, timeInterval: 60_000, activityType: 1, showsBackgroundLocationIndicator: false });
    await expect(owner.start(passive)).resolves.toBe('started');
    expect(tasks.get(taskName)).toMatchObject({ accuracy: 3, timeInterval: 600_000, showsBackgroundLocationIndicator: false });
    expect(native.observe().location).toMatchObject({ running: false, prepared: false });
  });

  it.each(['foreground', 'background'])('MAP-LOC-07 preserves %s permission denial before the real controller acquires an owner', async denied => {
    if (denied === 'foreground') sdk.foreground = 'denied'; else sdk.background = 'denied';
    await expect(owner.preparePermissions()).resolves.toBe('permission_denied');
    expect(calls).toEqual(denied === 'foreground' ? ['foregroundPermission'] : ['foregroundPermission', 'backgroundPermission']);
    calls.length = 0;
    await expect(owner.start(config({ permissionsPrepared: false }))).resolves.toBe('permission_denied');
    expect(calls).toEqual([]);
    expect(values.has(configKey)).toBe(false);
    expect(tasks.size).toBe(0);
    expect(native.observe().location).toMatchObject({ running: false, prepared: false });
  });

  it('MAP-LOC-07 rolls back persisted ownership when the Expo task fails to start', async () => {
    sdk.startError = 'expo_start_failed';
    await expect(owner.start(config())).rejects.toThrow('expo_start_failed');
    expect(values.has(configKey)).toBe(false);
    expect(tasks.size).toBe(0);
  });

  it('MAP-LOC-07 retains the durable owner after a stop error and supports an explicit retry', async () => {
    await expect(owner.start(config())).resolves.toBe('started');
    sdk.stopError = 'expo_stop_failed';
    await expect(owner.stop()).rejects.toThrow('expo_stop_failed');
    expect(values.has(configKey)).toBe(true);
    expect(tasks.has(taskName)).toBe(true);
    sdk.stopError = null;
    await owner.stop();
    expect(values.has(configKey)).toBe(false);
    expect(tasks.size).toBe(0);
  });
});
