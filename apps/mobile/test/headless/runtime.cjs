const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setImmediate: realImmediate } = require('node:timers');
const { open } = require('./sqlite.cjs');
const actions = require('./actions.cjs');

exports.run = async function run(jest) {
  const ipc = global.__HEADLESS_IPC__;
  assert(ipc?.send, 'Device requires an IPC owner');
  const spec = JSON.parse(process.env.HITHER_HEADLESS_DEVICE);
  const failures = [];
  const reportError = console.error;
  console.error = (...args) => {
    if (args.some(value => typeof value === 'string' && value.includes('overlapping act() calls'))) {
      failures.push('React reported overlapping act() calls');
    }
    reportError(...args);
  };
  const fatal = message => {
    failures.push(message);
    throw new Error(message);
  };
  const check = () => { if (failures.length) throw new Error(failures.join('\n')); };
  const strict = (name, value) => new Proxy(value, {
    get(target, key) {
      if (typeof key === 'symbol' || ['__esModule', 'then', 'toJSON', '$$typeof'].includes(key)) return target[key];
      if (!Reflect.has(target, key)) return fatal(`Unsupported external ${name}.${String(key)}`);
      return target[key];
    },
  });
  const send = value => ipc.send({ generation: spec.generation, ...value });
  const stage = value => send({ type: 'stage', value });
  stage('starting guard');
  let nextRequest = 0;
  let disposing = false;
  let hangShutdown = false;
  let releaseActTurn;
  const requests = new Map();
  const cancelled = new Set();
  function request(operation, signal) {
    if (disposing) return Promise.resolve({ data: null, error: { message: 'device disposed', code: 'ABORT_ERR' } });
    const id = ++nextRequest;
    return new Promise((resolve, reject) => {
      const abort = () => {
        requests.delete(id);
        cancelled.add(id);
        send({ type: 'cancel', id });
        resolve({ data: null, error: { message: 'aborted', code: 'ABORT_ERR' } });
      };
      requests.set(id, { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) });
      signal?.addEventListener('abort', abort, { once: true });
      send({ type: 'request', id, operation });
    });
  }
  const guard = name => () => fatal(`Forbidden real network ${name}`);
  global.fetch = guard('fetch');
  global.WebSocket = guard('WebSocket');
  for (const [module, methods] of Object.entries({
    'node:http': ['request', 'get'], 'node:https': ['request', 'get'],
    'node:net': ['connect', 'createConnection'], 'node:tls': ['connect'],
  })) for (const method of methods) require(module)[method] = guard(`${module}.${method}`);
  require('node:net').Socket.prototype.connect = guard('Socket.connect');
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    require('node:child_process')[method] = guard(`child_process.${method}`);
  }
  global.__DEV__ = false;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://headless.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'headless-fixture-only';
  jest.useFakeTimers({ now: spec.now, doNotFake: ['setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] });

  const store = name => {
    const file = path.join(spec.directory, `${name}.json`);
    let values = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const write = () => fs.writeFileSync(file, JSON.stringify(values));
    return {
      getItem: async key => values[key] ?? null,
      setItem: async (key, value) => { values[key] = value; write(); },
      removeItem: async key => { delete values[key]; write(); },
    };
  };
  const storage = store('async');
  const secure = store('secure');
  const appListeners = new Set();
  const watches = new Set();
  const retiredWatches = new Set();
  const channels = new Set();
  const handles = new Map();
  const permission = { status: 'granted', canAskAgain: true, granted: true };
  let sdk;
  let sdkStorage;
  const authKey = 'sb-headless-auth-token';
  let session;
  async function authenticate(userId) {
    session = { access_token: `fixture-${userId}`, refresh_token: `refresh-${userId}`,
      expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: userId, is_anonymous: false } };
    await sdkStorage.setItem(authKey, JSON.stringify(session));
  }
  const appState = {
    currentState: 'active',
    addEventListener: (event, fn) => {
      assert.equal(event, 'change');
      appListeners.add(fn);
      return { remove: () => appListeners.delete(fn) };
    },
  };
  const noRender = () => fatal('Native presentation was rendered');
  const alertQueue = [];
  jest.doMock('react-native', () => strict('react-native', {
    Platform: { OS: spec.platform ?? 'ios', Version: 26, select: options => options[spec.platform ?? 'ios'] ?? options.default },
    AppState: appState,
    Alert: { alert: (...args) => { alertQueue.push(args); } },
    Linking: strict('Linking', {}),
    StyleSheet: { create: value => value, absoluteFill: {} },
    View: noRender,
  }));
  jest.doMock('@react-native-async-storage/async-storage', () => strict('AsyncStorage', storage));
  jest.doMock('expo-secure-store', () => strict('SecureStore', {
    getItemAsync: secure.getItem, setItemAsync: secure.setItem, deleteItemAsync: secure.removeItem,
  }));
  jest.doMock('expo-crypto', () => ({ randomUUID: crypto.randomUUID }));
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async name => {
      assert.equal(path.basename(name), name, 'Database path escapes device');
      if (!handles.has(name)) handles.set(name, open(path.join(spec.directory, name)));
      return handles.get(name);
    },
  }));
  jest.doMock('expo-location', () => strict('expo-location', {
    Accuracy: { High: 6, Balanced: 3, Low: 2 },
    requestForegroundPermissionsAsync: async () => ({ ...permission }),
    getForegroundPermissionsAsync: async () => ({ ...permission }),
    getBackgroundPermissionsAsync: async () => ({ ...permission }),
    watchPositionAsync: async (options, callback) => {
      assert(options && typeof callback === 'function');
      watches.add(callback);
      return { remove: () => { watches.delete(callback); retiredWatches.add(callback); } };
    },
  }));
  jest.doMock('expo-modules-core', () => strict('expo-modules-core', {
    requireOptionalNativeModule: name => {
      if (!['HitherLocation', 'HitherMaps', 'HitherNotifications', 'HitherLiveActivity', 'HitherMetrics'].includes(name)) {
        return fatal(`Unknown optional native module ${name}`);
      }
      return null;
    },
  }));
  jest.doMock('expo-constants', () => ({ __esModule: true, default: {
    expoConfig: { version: 'headless' }, nativeBuildVersion: 'headless',
    executionEnvironment: 'storeClient', appOwnership: 'expo',
  }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
  jest.doMock('expo-updates', () => strict('Updates', { isEmbeddedLaunch: true, updateId: null, runtimeVersion: 'headless' }));
  jest.doMock('expo-notifications', () => strict('Notifications', { setNotificationHandler: handler => assert(handler.handleNotification) }));
  jest.doMock('expo-glass-effect', () => strict('Glass', { GlassView: noRender, isLiquidGlassAvailable: () => false }));
  jest.doMock('expo-blur', () => ({ BlurView: noRender }));
  jest.doMock('expo-file-system/legacy', () => strict('FileSystem', {}));
  jest.doMock('react-native-url-polyfill/auto', () => ({}));

  function builder(kind, name, args) {
    const steps = [];
    let signal;
    let flight;
    const query = {
      then(resolve, reject) {
        if (!flight) flight = signal?.aborted ? Promise.resolve({ data: null, error: { message: 'aborted', code: 'ABORT_ERR' } })
          : request({ kind, name, args, steps, userId: session.user.id }, signal).then(result => {
            if (signal?.aborted) return { data: null, error: { message: 'aborted', code: 'ABORT_ERR' } };
            return result;
          });
        return flight.then(resolve, reject);
      },
      catch(reject) { return this.then(value => value, reject); },
      finally(fn) { return this.then(value => value).finally(fn); },
      abortSignal(value) { signal = value; return this; },
      setHeader(name, value) { assert.equal(name, 'Authorization'); assert(value.startsWith('Bearer fixture-')); return this; },
    };
    for (const method of ['select', 'eq', 'is', 'gt', 'order', 'limit', 'maybeSingle', 'single', 'upsert']) {
      query[method] = (...values) => { steps.push([method, ...values]); return query; };
    }
    return strict(`Supabase.${kind}.${name}`, query);
  }
  jest.doMock('@supabase/supabase-js', () => ({ createClient: (url, key, options) => {
    assert.equal(url, process.env.EXPO_PUBLIC_SUPABASE_URL);
    assert.equal(key, 'headless-fixture-only');
    sdkStorage = options.auth.storage;
    sdk = strict('Supabase', {
      auth: strict('auth', {
        getSession: async () => ({ data: { session }, error: null }),
        refreshSession: async () => fatal('Unexpected fixture token refresh'),
        stopAutoRefresh: () => {},
      }),
      rpc: (name, args = {}) => builder('rpc', name, args),
      from: name => builder('table', name, {}),
      channel: name => {
        const bindings = [];
        const channel = {
          name, bindings,
          on(type, filter, callback) {
            assert.equal(type, 'postgres_changes');
            assert.equal(filter.schema, 'public');
            assert(['member_locations', 'memberships', 'itinerary_items', 'daily_accommodations', 'groups', 'profiles',
              'navigation_sessions', 'navigation_member_states'].includes(filter.table), `Unknown realtime table ${filter.table}`);
            bindings.push({ filter, callback });
            return this;
          },
          subscribe(callback) { channels.add(this); callback?.('SUBSCRIBED'); return this; },
        };
        return strict('channel', channel);
      },
      removeChannel: async channel => { channels.delete(channel); return 'ok'; },
    });
    return sdk;
  } }));

  const React = require('react');
  stage('external seams installed');
  const { act: renderAct, create } = require('react-test-renderer');
  let previousAct = Promise.resolve();
  // IPC may await concurrent responses, but React requires each act scope to finish first.
  const act = callback => {
    const current = previousAct.then(() => renderAct(callback));
    previousAct = current.catch(() => {});
    return current;
  };
  const { useGroupState } = require('../../src/state/useGroupState');
  const { useNavigationSession } = require('../../src/state/useNavigationSession');
  const { useDeviceLocation } = require('../../src/screens/MapScreen/hooks/useDeviceLocation');
  const { useJourneyNavigation } = require('../../src/screens/MapScreen/hooks/useJourneyNavigation');
  const privacy = require('../../src/state/locationPrivacy');
  const core = require('../../src/state/coreDataSync');
  const { getLocalAuthActorId } = require('../../src/api/supabase');
  stage('production imports loaded');
  const persistedSession = await sdkStorage.getItem(authKey);
  if (persistedSession) {
    session = JSON.parse(persistedSession);
    assert.equal(typeof session.user?.id, 'string', 'Invalid persisted fixture actor');
    assert.equal(session.access_token, `fixture-${session.user.id}`, 'Invalid persisted fixture session');
  } else await authenticate(spec.userId);
  stage('auth persisted');
  const app = { userId: session.user.id, groupId: null, sharingEnabled: true,
    destinationService: require('../../src/api/services/DestinationService') };
  const mapRef = { current: null };
  const carouselRef = { current: null };
  const t = key => key;
  const setSelectedIndex = () => {};
  function Probe() {
    app.group = useGroupState(app.groupId, { myUserId: app.userId });
    app.navigation = useNavigationSession(app.groupId, null, app.userId);
    app.location = useDeviceLocation({ groupId: app.groupId, highAccuracy: false,
      sharingEnabled: app.sharingEnabled, hasMembership: Boolean(app.groupId) });
    const destinations = app.group.state?.destinations ?? [];
    app.journey = useJourneyNavigation({
      groupId: app.groupId, actorId: app.userId, state: app.group.state,
      isLeader: app.group.state?.members.some(m => m.userId === app.userId && m.role === 'leader') ?? false,
      destinations, selectedDestination: destinations[0], fromCoords: app.location.deviceCoords ?? undefined,
      refresh: app.group.refresh, t, mapRef, carouselRef, setSelectedIndex,
      navigationSession: app.navigation.session, terminalSession: app.navigation.terminalSession,
      startSession: app.navigation.start, cancelSession: app.navigation.cancel,
      refreshNavigationSession: app.navigation.refresh,
      onOptimisticGathering: app.group.applyOptimisticGathering,
    });
    return null;
  }
  let root;
  app.render = async () => { root.update(React.createElement(Probe)); };
  await act(async () => { root = create(React.createElement(Probe)); });
  stage('null root mounted');
  const turn = () => new Promise(resolve => realImmediate(resolve));
  async function observation() {
    const database = require('../../src/state/hitherDatabase');
    const db = await database.getHitherDatabase();
    return {
      pid: process.pid, generation: spec.generation, actorId: await getLocalAuthActorId(),
      group: { state: app.group.state, loading: app.group.loading, error: app.group.error,
        dataSource: app.group.dataSource, snapshotFreshness: app.group.snapshotFreshness,
        emptyLocalSnapshot: app.group.emptyLocalSnapshot, refreshing: app.group.refreshing },
      location: { coordinates: app.location.deviceCoords, accuracy: app.location.deviceAccuracyM,
        acceptedAt: app.location.deviceCoordsAcceptedAtMs, appState: app.location.appState },
      journey: { targetId: app.journey.navTargetId, sharedTargetId: app.journey.sharedTargetId,
        status: app.journey.journeyStatus, busy: app.journey.journeyBusy },
      navigation: { session: app.navigation.session, error: app.navigation.error },
      durable: { locations: await db.getAllAsync('SELECT * FROM location_outbox'),
        operations: app.groupId ? await core.listOpenCoreOperations(app.groupId) : [],
        snapshot: app.groupId ? await require('../../src/state/coreDataStore').readCoreSnapshot(app.groupId) : null },
      external: { watches: watches.size, channels: channels.size, listeners: appListeners.size, alerts: alertQueue.length,
        heldActTurn: Boolean(releaseActTurn) },
      pending: [...requests.keys()], timers: jest.getTimerCount(), fatal: [...failures], now: Date.now(),
    };
  }
  let finish;
  const disposed = new Promise(resolve => { finish = resolve; });
  async function command(message) {
    const { kind } = message.command;
    if (kind === 'observe') return observation();
    if (kind === 'barrier') { await act(turn); return { pending: [...requests.keys()] }; }
    if (kind === 'advance') {
      assert(Number.isSafeInteger(message.command.ms) && message.command.ms >= 0 && message.command.ms <= 86400000);
      await act(async () => { await jest.advanceTimersByTimeAsync(message.command.ms); });
      return;
    }
    if (kind === 'perform') {
      if (!actions.has(message.command.name)) return fatal(`Unsupported action ${message.command.name}`);
      let result;
      await act(async () => { result = actions.perform(app, message.command.name, message.command.input); });
      const completed = await result;
      await act(turn);
      return completed;
    }
    if (kind === 'input') {
      const input = message.command.input;
      await act(async () => {
        if (input.kind === 'gps' || input.kind === 'retiredGps') {
          assert(Number.isFinite(input.latitude) && Math.abs(input.latitude) <= 90);
          assert(Number.isFinite(input.longitude) && Math.abs(input.longitude) <= 180);
          const sample = { coords: { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy ?? 5 },
            timestamp: input.timestamp ?? Date.now() };
          for (const callback of [...(input.kind === 'gps' ? watches : retiredWatches)]) callback(sample);
        } else if (input.kind === 'appState') {
          assert(['active', 'inactive', 'background'].includes(input.value));
          appState.currentState = input.value;
          for (const listener of [...appListeners]) listener(input.value);
        } else if (input.kind === 'consentContext') {
          assert.equal(typeof input.enabled, 'boolean');
          await storage.setItem(privacy.LOCATION_SHARING_KEY, String(input.enabled));
          privacy.setLocationSharingConsent(input.enabled);
          app.sharingEnabled = input.enabled;
          await app.render();
        } else if (input.kind === 'account') {
          assert.equal(typeof input.userId, 'string');
          await authenticate(input.userId);
          app.userId = input.userId;
          await app.render();
        } else if (input.kind === 'permission') {
          assert(['granted', 'denied'].includes(input.status));
          permission.status = input.status;
          permission.granted = input.status === 'granted';
        } else if (input.kind === 'alert') {
          const alert = alertQueue.shift();
          assert(alert, 'No pending Alert');
          const button = alert[2]?.[input.index];
          assert(button, 'Unknown Alert choice');
          button.onPress?.();
        } else return fatal(`Unknown external input ${input.kind}`);
      });
      return;
    }
    if (kind === 'event') {
      await act(async () => {
        for (const channel of channels) for (const { filter, callback } of channel.bindings) {
          const event = message.command.event;
          if (filter.table !== event.table || (filter.event !== '*' && filter.event !== event.eventType)) continue;
          if (filter.filter) {
            const [column, value] = filter.filter.split('=eq.');
            if ((event.new?.[column] ?? event.old?.[column]) !== value) continue;
          }
          callback(event);
        }
      });
      return;
    }
    if (kind === 'probe') {
      if (message.command.name === 'holdActTurn') {
        await act(() => new Promise(resolve => { releaseActTurn = resolve; }));
        return;
      }
      if (message.command.name === 'releaseActTurn') {
        assert(releaseActTurn, 'No held React turn');
        releaseActTurn();
        releaseActTurn = undefined;
        return;
      }
      if (message.command.name === 'hangShutdown') { hangShutdown = true; return; }
      try {
        if (message.command.name === 'network') await fetch('https://example.invalid');
        else if (message.command.name === 'sdk') await sdk.rpc('unsupported_headless_probe');
        else if (message.command.name === 'native') require('expo-location').unexpected();
        else fatal('Unknown harness probe');
      } catch {}
      return;
    }
    if (kind === 'close') {
      if (hangShutdown) await new Promise(() => {});
      disposing = true;
      await act(async () => root.unmount());
      for (const [id, pending] of requests) {
        pending.cleanup();
        cancelled.add(id);
        send({ type: 'cancel', id });
        pending.resolve({ data: null, error: { message: 'device disposed', code: 'ABORT_ERR' } });
      }
      requests.clear();
      await turn();
      const residual = { watches: watches.size, channels: channels.size, listeners: appListeners.size,
        pending: requests.size, timers: jest.getTimerCount(), fatal: [...failures] };
      for (const db of handles.values()) await db.closeAsync();
      jest.clearAllTimers();
      jest.useRealTimers();
      assert.equal(residual.watches, 0, 'GPS listener leaked');
      assert.equal(residual.channels, 0, 'Realtime channel leaked');
      assert.equal(residual.listeners, 0, 'AppState listener leaked');
      finish();
      return residual;
    }
    return fatal(`Unknown command ${kind}`);
  }
  const receive = message => {
    if (message.generation !== spec.generation) return;
    if (message.type === 'response') {
      const pending = requests.get(message.id);
      if (!pending) {
        if (cancelled.delete(message.id)) return;
        failures.push(`Unknown response ${message.id}`);
        return;
      }
      requests.delete(message.id);
      pending.cleanup();
      if (message.fatal) failures.push(message.fatal);
      pending.resolve(message.result);
      return;
    }
    if (message.type !== 'command') { failures.push(`Unknown IPC ${message.type}`); return; }
    void command(message).then(result => {
      if (message.command.kind !== 'close') check();
      send({ type: 'result', id: message.id, result });
    }).catch(error => send({ type: 'result', id: message.id, error: error.stack ?? String(error) }));
  };
  ipc.on(receive);
  send({ type: 'ready' });
  await disposed;
  ipc.off(receive);
};
