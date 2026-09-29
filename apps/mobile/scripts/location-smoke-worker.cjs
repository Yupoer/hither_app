// Native boundaries only are replaced. Services, mapper, merge, outbox and refresh action are production code.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../src');
const directory = process.env.HITHER_SMOKE_DIR;
const index = process.env.HITHER_SMOKE_ACTOR;
const storageFile = path.join(directory, `actor-${index}.json`);
const storageData = fs.existsSync(storageFile) ? JSON.parse(fs.readFileSync(storageFile, 'utf8')) : {};
const storage = {
  getItem: async key => storageData[key] ?? null,
  setItem: async (key, value) => { storageData[key] = value; fs.writeFileSync(storageFile, JSON.stringify(storageData)); },
  removeItem: async key => { delete storageData[key]; fs.writeFileSync(storageFile, JSON.stringify(storageData)); },
};
let offline = false;
const appState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
let db;
const sqlite = async () => {
  if (db) return db;
  const native = new DatabaseSync(path.join(directory, `actor-${index}.sqlite`));
  const adapter = {
    execAsync: async sql => native.exec(sql),
    runAsync: async (sql, ...args) => native.prepare(sql).run(...args),
    getAllAsync: async (sql, ...args) => native.prepare(sql).all(...args),
    getFirstAsync: async (sql, ...args) => native.prepare(sql).get(...args) ?? null,
    withTransactionAsync: async fn => { native.exec('BEGIN'); try { await fn(); native.exec('COMMIT'); } catch (e) { native.exec('ROLLBACK'); throw e; } },
  };
  adapter.withExclusiveTransactionAsync = fn => adapter.withTransactionAsync(() => fn(adapter));
  return db = adapter;
};
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { requestWithDeadline } = require(path.join(root, 'utils/requestDeadline.ts'));
const baseSupabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (url, init) => {
    if (offline) return Promise.reject(new Error('fetch failed: injected offline'));
    return requestWithDeadline(signal => fetch(url, { ...init, signal }), 10_000, init?.signal);
  } },
});
let supabase = baseSupabase;
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'react-native') return { AppState: appState, Platform: { OS: 'ios' } };
  if (name === '@react-native-async-storage/async-storage') return storage;
  if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
  if (name === 'expo-location') return { getForegroundPermissionsAsync: async () => ({ status: 'granted' }) };
  if (name === 'expo-sqlite') return { openDatabaseAsync: sqlite };
  if (name === 'expo-task-manager') return { isTaskDefined: () => true };
  if (name === 'expo-notifications') return { registerTaskAsync: async () => {} };
  if (parent?.filename === path.join(root, 'i18n/index.ts') && name === '../state/PreferencesContext') {
    return { usePreferences: () => ({ language: 'zh' }) };
  }
  if (parent?.filename === path.join(root, 'state/backgroundLocationRefresh.ts')) {
    if (name === '../native') return { location: { getCurrentLocation: async () => ({ coordinates: event().coords, accuracy: 5, timestamp: Date.now() }) } };
    if (name === './backgroundJourney') return { reconcileBackgroundNavigation: async () => {} };
    if (name === './diagnostics') return { diagnostics: { write: async () => {}, flush: async () => {} } };
  }
  if (parent && /supabase$/.test(name) && parent.filename.startsWith(root)) return { supabase };
  return originalLoad.apply(this, arguments);
};
const { configureDefaultAuthRecovery } = require(path.join(root, 'api/authRecovery.ts'));
const { withAuthenticatedTransport } = require(path.join(root, 'api/authenticatedTransport.ts'));
const { readLocalAuthActor, defaultSupabaseAuthStorageKey } = require(path.join(root, 'api/localAuthActor.ts'));
const authRecovery = configureDefaultAuthRecovery({ getSession: () => baseSupabase.auth.getSession(), refreshSession: () => baseSupabase.auth.refreshSession() });
supabase = Object.assign(withAuthenticatedTransport(baseSupabase, { authRecovery }), {
  getLocalAuthActorId: () => readLocalAuthActor(storage, defaultSupabaseAuthStorageKey(process.env.EXPO_PUBLIC_SUPABASE_URL)),
});
const groupApi = require(path.join(root, 'api/services/GroupService.ts'));
const locationApi = require(path.join(root, 'api/services/LocationService.ts'));
const destinations = require(path.join(root, 'api/services/DestinationService.ts'));
const navigation = require(path.join(root, 'api/services/NavigationService.ts'));
const coordination = require(path.join(root, 'api/services/CoordinationRequestService.ts'));
const gathering = require(path.join(root, 'api/services/GatheringWorkflowService.ts'));
const subgroups = require(path.join(root, 'api/services/SubgroupService.ts'));
const privacy = require(path.join(root, 'state/locationPrivacy.ts'));
const { enqueueLocationOutbox, flushLocationOutbox, SQLiteLocationOutboxDatabase } = require(path.join(root, 'state/locationOutbox.ts'));
const outbox = { enqueue: enqueueLocationOutbox, flush: flushLocationOutbox };
const { mergeRemoteGroupStatePreservingOwnLocation } = require(path.join(root, 'utils/syncAuthority.ts'));
const { applyMemberLocationPatches, locationPatchFromRealtimePayload } = require(path.join(root, 'utils/groupStatePatches.ts'));
const { refreshTeamLocations } = require(path.join(root, 'utils/refreshTeamLocations.ts'));
const core = require(path.join(root, 'state/coreDataSync.ts'));
const arrivalSync = require(path.join(root, 'state/arrivalSync.ts'));
const { startCoreSyncRuntime } = require(path.join(root, 'state/coreSyncRuntime.ts'));
let userId, groupId, state = null, channel, dropLocations = false, poll, stopCore;
const observed = { locations: 0, itinerary: 0, reads: 0, failures: 0, system: [], statuses: [] };
async function pull() {
  try {
    const remote = await groupApi.getGroupRecoverySnapshot(groupId);
    state = mergeRemoteGroupStatePreservingOwnLocation(state, remote.state, userId);
    await core.hydrateCoreEntityVersions(groupId, state);
    await storage.setItem('snapshot', JSON.stringify(state));
    observed.reads++;
    return true;
  } catch { observed.failures++; return false; }
}
function event(lat = 25 + Number(index) * 0.001, capturedAt = Date.now()) {
  return { id: crypto.randomUUID(), groupId, navigationSessionId: null, capturedAt,
    coords: { latitude: lat, longitude: 121, accuracy: 5 }, trackingMode: 'foreground', source: 'foreground', sequence: capturedAt };
}
async function upload(args = {}) {
  const fix = event(args.lat, args.capturedAt);
  await outbox.enqueue(fix);
  if (args.queueOnly) return { eventId: fix.id };
  const result = await outbox.flush();
  return { ...result, eventId: fix.id, confirmed: result.acceptedIds?.includes(fix.id) === true };
}
const { recoverPendingLocationRefreshes: respond } = require(path.join(root, 'state/backgroundLocationRefresh.ts'));
async function subscribe() {
  if (channel) await supabase.removeChannel(channel);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscription_timeout')), 15_000);
    channel = supabase.channel(`smoke-${index}-${crypto.randomUUID()}`)
      .on('system', {}, payload => { observed.system.push(payload); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_locations', filter: `group_id=eq.${groupId}` }, payload => {
        observed.locations++;
        if (dropLocations) return;
        const patch = locationPatchFromRealtimePayload(payload);
        if (state && patch && patch !== 'full-reload') state = applyMemberLocationPatches(state, [patch], userId) ?? state;
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_items', filter: `group_id=eq.${groupId}` }, () => { observed.itinerary++; void pull(); })
      .subscribe(status => { observed.statuses.push(status); if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } });
  });
}
const actions = {
  async auth(args = {}) {
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const result = args.email ? await supabase.auth.signInWithPassword({ email: args.email, password: args.password }) : await supabase.auth.signInAnonymously({ options: { data: { test_run: path.basename(directory) } } });
      if (result.error) throw result.error;
      session = result.data.session;
    }
    userId = session.user.id;
    return { userId };
  },
  create: args => groupApi.createGroup(args.name),
  join: args => groupApi.joinGroup(args.code),
  async open(args) {
    groupId = args.groupId;
    privacy.setLocationAccessContext(groupId, true, true);
    const cached = await storage.getItem('snapshot');
    state = cached ? JSON.parse(cached) : null;
    if (state?.group.id !== groupId) state = null;
    await pull(); await subscribe();
    stopCore?.(); stopCore = startCoreSyncRuntime();
    await outbox.flush();
    clearInterval(poll);
    poll = setInterval(() => { void pull(); void outbox.flush().catch(() => {}); void respond().catch(() => {}); }, 30_000);
    return state;
  },
  upload,
  flush: () => outbox.flush(),
  async foreignQueue(args) {
    const fix = { ...event(), actorId: args.actorId };
    await new SQLiteLocationOutboxDatabase().insert({ ...fix, attempts: 0, nextAttemptAt: Date.now(), expiresAt: Date.now() + 86_400_000 });
    return { ...await outbox.flush(), eventId: fix.id };
  },
  pull,
  state: () => ({ state, observed }),
  offline: args => { offline = args.enabled; return true; },
  drop: args => { dropLocations = args.enabled; return true; },
  async disconnect() { await supabase.removeChannel(channel); return true; },
  reconnect: subscribe,
  async refresh(args) {
    return refreshTeamLocations({ pull, uploadSelf: async () => {
      if (args.gpsFailure) throw new Error('GPS unavailable');
      const sent = await upload();
      if (!sent.confirmed) throw new Error('upload_not_confirmed');
      return true;
    }, requestPeers: () => locationApi.requestGroupLocationRefresh(groupId), getMembers: () => state?.members ?? [], cooling: args.cooling ?? false, timeoutMs: 20_000 });
  },
  add: args => destinations.addDestination(groupId, { title: 'Dummy smoke stop', coordinates: { latitude: 25, longitude: 121 }, day: 1 }),
  delete: args => destinations.deleteDestination(groupId, args.id, args.sessionId),
  privacy: args => navigation.setLocationSharingEnabled(args.enabled),
  raw: async args => {
    const result = await supabase.rpc(args.name, args.args);
    return { data: result.data, error: result.error?.message ?? null };
  },
  async workflow(args) {
    switch (args.kind) {
      case 'voteCreate': return coordination.createCoordinationRequest({ groupId, subject: 'Dummy vote', subjectKind: 'itinerary', options: [{ id: 'keep', label: 'Keep', kind: 'keep_current' }, { id: 'no', label: 'No change', kind: 'no_change' }], deadline: new Date(Date.now() + 600_000).toISOString(), policy: 'majority', defaultOutcome: 'keep' });
      case 'vote': return coordination.respondToCoordinationRequest(args.id, args.option);
      case 'votes': return coordination.fetchCoordinationResponses(args.id);
      case 'start': {
        if (!await pull()) throw new Error('start snapshot unavailable');
        const operationId = crypto.randomUUID();
        const result = await core.enqueueLeaderGatheringStart(groupId, { groupState: state, actorId: userId, activeDestinationId: args.id, operationId, navigationRequestId: operationId });
        await core.flushCoreOperationOutbox();
        return result;
      }
      case 'session': return navigation.getActiveNavigationSession(groupId);
      case 'arrive': {
        const destination = state?.destinations.find(d => d.id === args.id);
        if (!destination || !args.sessionId) throw new Error('arrival requires the observed destination and navigation session');
        const operation = args.arrived
          ? await arrivalSync.enqueueArrival({ groupId, actorId: userId, userId, destination, arrivedAt: new Date().toISOString(), completeSolo: false, navigationSessionId: args.sessionId })
          : await gathering.setDestinationArrivalAt(args.id, userId, false, null, args.sessionId);
        return { operationId: operation.id, status: await arrivalSync.syncArrival(operation) };
      }
      case 'arrivals': return gathering.fetchDestinationArrivals(groupId);
      case 'request': return gathering.submitGatherPointRequest(groupId, undefined, [{ title: 'Dummy request', coordinates: { latitude: 25, longitude: 121 } }]);
      case 'requests': return gathering.fetchPendingGatherPointRequests(groupId);
      case 'split': return groupApi.selfSplit(groupId, 'Dummy subgroup');
      case 'invite': return subgroups.inviteToSubgroup(args.id, args.userId);
      case 'invites': return subgroups.fetchMyInvites(userId);
      case 'accept': return subgroups.acceptSubgroupInvite(args.id);
      case 'merge': return groupApi.selfMerge(groupId);
      case 'leave': return groupApi.leaveGroups([groupId]);
      default: throw new Error('unknown workflow action');
    }
  },
  async cleanup(args = {}) {
    stopCore?.(); clearInterval(poll); await supabase.removeAllChannels(); offline = false;
    if (!args.managed) {
      const result = await supabase.rpc('delete_anonymous_account');
      if (result.error) throw result.error;
    }
    await supabase.auth.signOut({ scope: 'local' });
    return { deleted: userId };
  },
};
process.on('message', async ({ id, action, args = {} }) => {
  try { process.send({ id, value: await actions[action](args) }); }
  catch (e) { process.send({ id, error: e.message ?? String(e) }); }
});
