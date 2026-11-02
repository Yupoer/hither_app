const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const owners = ['apps/mobile/src/state/groupSync.ts', 'apps/mobile/src/state/locationOutbox.ts', 'apps/mobile/src/state/coreOperationOutbox.ts'];
const hash = text => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

exports.run = async function run(repo) {
  const ts = require(require.resolve('typescript', { paths: [path.join(repo, 'apps/mobile')] }));
  const sources = Object.fromEntries(owners.map(file => [file, fs.readFileSync(path.join(repo, file), 'utf8')]));
  const scratchNeedle = 'const resolvedIds = [...accepted, ...discarded];';
  assert.equal(sources[owners[1]].split(scratchNeedle).length, 2, 'GPS settlement seam changed. Reconcile model and replay before updating source coverage.');
  const publicationNeedle = 'for (const listener of listeners) listener(actorId, reply.recovery, reply.pendingRefreshes);';
  assert.equal(sources[owners[0]].split(publicationNeedle).length, 2, 'Snapshot publication seam changed. Reconcile replay before updating source coverage.');
  const compiled = new Map();
  let scenarios = 0;

  async function scenario({ coreAcks, gpsMask, loss, switchAt, mutant = null }) {
    let actor = 'A';
    let clock = 100000;
    let networkCalls = 0;
    let queue;
    const gpsRows = new Map();
    const projections = [];
    const group = 'group';
    const pendingRefreshes = [{ groupId: group, requestedBy: 'leader', requestedAt: '2026-11-03T00:00:00.123456Z' }];
    const gpsIds = ['gps-1', 'gps-2'];
    const access = { groupId: group, userId: 'A' };
    const sqlite = {
      async runAsync(sql, ...args) {
        if (sql.startsWith('DELETE FROM location_outbox WHERE expires_at')) return;
        if (sql.startsWith('DELETE FROM location_outbox WHERE id')) { gpsRows.delete(args[0]); return; }
        if (sql.startsWith('UPDATE location_outbox')) {
          const row = gpsRows.get(args[2]);
          if (row) { row.attempts = args[0]; row.next_attempt_at = args[1]; }
          return;
        }
        throw new Error('Unexpected scratch SQLite write: ' + sql);
      },
      async getAllAsync() { return [...gpsRows.values()].filter(row => row.next_attempt_at <= clock).sort((a, b) => b.captured_at - a.captured_at); },
      async getFirstAsync(sql, groupId, actorId) {
        const rows = [...gpsRows.values()].filter(row => groupId === undefined
          || row.group_id === groupId && JSON.parse(row.payload).actorId === actorId);
        return sql.includes('COUNT') ? { count: rows.length }
          : { due: rows.length ? Math.min(...rows.map(row => row.next_attempt_at)) : null };
      },
      async withTransactionAsync(fn) { await fn(); if (networkCalls === 1 && switchAt === 'after-gps') actor = 'B'; },
    };
    for (const [index, id] of [...gpsIds, 'gps-other-actor'].entries()) {
      gpsRows.set(id, { id, group_id: group, navigation_session_id: null, captured_at: 90000 + index,
        payload: JSON.stringify({ actorId: index < 2 ? 'A' : 'B', coords: { latitude: 25, longitude: 121 }, trackingMode: 'foreground', source: 'foreground' }),
        sequence: index + 1, attempts: 0, next_attempt_at: 0, expires_at: 99999999 });
    }
    const cache = new Map();
    const absolute = relative => path.join(repo, 'apps/mobile/src', relative);
    const mocks = new Map([
      [absolute('state/hitherDatabase.ts'), { getHitherDatabase: async () => sqlite }],
      [absolute('state/coreDataSync.ts'), { getCoreOperationOutbox: () => queue }],
      [absolute('api/services/_helpers.ts'), { requireUserId: async () => actor }],
      [absolute('i18n/index.ts'), { t: key => key }],
      [absolute('api/services/LocationService.ts'), { ingestLocationBatch: async () => { throw new Error('Old RPC unexpectedly used'); } }],
      [absolute('state/locationPrivacy.ts'), { captureLocationAccess: async () => access, isLocationAccessCurrent: captured => actor === captured.userId, isLocationAccessPending: () => false }],
      [absolute('api/services/GroupSyncService.ts'), { exchangeGroup: async input => {
        networkCalls += 1;
        assert.equal(input.actorId, 'A');
        assert.ok(input.events.every(event => event.actorId === 'A'), 'foreign GPS submitted');
        assert.ok(input.operations.every(operation => operation.actorId === 'A'), 'foreign core submitted');
        if (networkCalls === 1 && switchAt === 'before-reply') actor = 'B';
        if (networkCalls === 1 && loss) throw new Error('lost_reply');
        const returnedCore = networkCalls === 1 ? input.operations.slice(0, coreAcks) : input.operations;
        const returnedGpsMask = networkCalls === 1 ? gpsMask : 3;
        return { coreResults: new Map(returnedCore.map(operation => [operation.id,
          { status: 'accepted', operationId: operation.id, entityVersion: 1 }])),
          locationResult: { acceptedIds: input.events.filter(event => gpsIds.includes(event.id) && returnedGpsMask & (1 << gpsIds.indexOf(event.id))).map(event => event.id), rejected: [] },
          recovery: { group: { id: group } }, locationReceipts: [], pendingRefreshes, refreshAcknowledgements: [], refreshRequest: null, acknowledgedIds: [] };
      } }],
    ]);
    const externals = {
      'react-native': { Platform: { OS: 'ios' }, AppState: { currentState: 'background' } },
      'expo-crypto': { randomUUID: () => 'scratch-id' },
      '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => null, removeItem: async () => {} } },
    };
    function load(file) {
      if (mocks.has(file)) return mocks.get(file);
      if (cache.has(file)) return cache.get(file).exports;
      const module = { exports: {} };
      cache.set(file, module);
      const relative = path.relative(repo, file).replaceAll('\\', '/');
      let source = sources[relative] ?? fs.readFileSync(file, 'utf8');
      if (mutant === 'gps-ack-all' && relative === owners[1]) source = source.replace(scratchNeedle, 'const resolvedIds = due.map(entry => entry.id);');
      if (mutant === 'no-dispatch' && relative === owners[0]) source = source.replace(publicationNeedle, '');
      const key = hash(source);
      if (!compiled.has(key)) compiled.set(key, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
      const localRequire = name => {
        if (Object.hasOwn(externals, name)) return externals[name];
        if (!name.startsWith('.')) throw new Error('Unmocked external dependency ' + name + ' in ' + relative);
        let target = path.resolve(path.dirname(file), name);
        target = fs.existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts');
        return load(target);
      };
      const ReplayDate = class extends Date { static now() { return clock; } };
      vm.runInNewContext(compiled.get(key), { module, exports: module.exports, require: localRequire, console, setTimeout, clearTimeout, Date: ReplayDate, Error, AbortController }, { filename: relative });
      return module.exports;
    }
    const core = load(absolute('state/coreOperationOutbox.ts'));
    const store = load(absolute('state/coreDataStore.ts'));
    const coreDb = new store.MemoryCoreDataDatabase();
    const db = new core.MemoryCoreOperationOutboxDatabase();
    const update = db.update.bind(db);
    db.update = async operation => {
      await update(operation);
      if (networkCalls === 1 && switchAt === 'before-core-settlement' && operation.status === 'inflight') actor = 'B';
    };
    queue = core.createCoreOperationOutbox(coreDb, db, async () => { throw new Error('Old core RPC unexpectedly used'); }, () => clock, () => 'unused', async () => actor);
    for (const [index, id] of ['core-1', 'core-2', 'core-other-actor'].entries()) {
      await db.insert({ id, actorId: index < 2 ? 'A' : 'B', groupId: group, entityType: 'itinerary', entityId: group,
        entityVersion: 0, operationType: 'reorder_destinations', payload: { updates: [] }, sequence: index + 1,
        dependencyIds: index === 1 ? ['core-1'] : [], status: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: index + 1, updatedAt: 1 });
    }
    const sync = load(absolute('state/groupSync.ts'));
    sync.subscribeGroupSyncSnapshots((owner, snapshot, pending) => {
      assert.equal(pending, pendingRefreshes, 'current actor must receive the same reply pending refresh commands');
      projections.push({ owner, currentActor: actor, groupId: snapshot.group.id });
    });
    let error = null;
    try { await sync.syncGroup({ groupId: group }); } catch (caught) { error = caught.message; }
    assert.equal(networkCalls, 1, 'one mixed exchange expected');
    const switched = switchAt === 'before-reply' || switchAt === 'after-gps'
      || switchAt === 'before-core-settlement' && (loss || coreAcks > 0);
    assert.equal(actor, switched ? 'B' : 'A', 'account switch stimulus must reach its selected boundary');
    const expectedError = loss ? 'group_sync_response_missing' : switched ? 'account_changed' : null;
    assert.equal(error, expectedError, 'first exchange must resolve or reject with its expected domain outcome');
    const firstPublications = loss || switched ? 0 : 1;
    assert.equal(projections.length, firstPublications, 'first exchange publication count must match its outcome');
    const expectedCore = loss || switched ? ['core-1', 'core-2'] : ['core-1', 'core-2'].slice(coreAcks);
    const actualCore = Array.from(await db.listAll()).filter(row => row.actorId === 'A').map(row => row.id).sort();
    assert.deepEqual(actualCore, expectedCore, 'unacknowledged core rows must stay durable');
    const gpsSettled = !loss && switchAt !== 'before-reply';
    const expectedGps = gpsIds.filter((id, index) => !gpsSettled || !(gpsMask & (1 << index)));
    assert.deepEqual([...gpsRows.keys()].filter(id => gpsIds.includes(id)).sort(), expectedGps, 'unacknowledged GPS rows must stay durable');
    assert.ok(gpsRows.has('gps-other-actor'), 'foreign GPS row deleted');
    assert.ok(await db.get('core-other-actor'), 'foreign core row deleted');
    assert.ok(projections.every(item => item.owner === item.currentActor), 'snapshot projected into another actor');
    actor = 'A'; clock += 1000000;
    await sync.syncGroup({ groupId: group });
    assert.equal(projections.length, firstPublications + 1, 'successful retry must publish exactly one further snapshot and pending refresh command list');
    assert.equal(networkCalls, 2, 'retry must use one further mixed exchange');
    assert.equal((await db.listAll()).filter(row => row.actorId === 'A').length, 0, 'retry did not settle original core IDs');
    assert.ok(gpsIds.every(id => !gpsRows.has(id)), 'retry did not settle original GPS IDs');
    assert.ok(gpsRows.has('gps-other-actor') && await db.get('core-other-actor'), 'retry touched another actor');
    assert.ok(projections.every(item => item.owner === item.currentActor), 'retry projected into another actor');
    return { error, gpsRemainingBeforeRetry: expectedGps.length };
  }

  for (const coreAcks of [0, 1, 2]) for (const gpsMask of [0, 1, 2, 3]) {
    for (const loss of [false, true]) for (const switchAt of ['none', 'before-reply', 'after-gps', 'before-core-settlement']) {
      await scenario({ coreAcks, gpsMask, loss, switchAt });
      scenarios += 1;
    }
  }
  let mutationCaught = false;
  try { await scenario({ coreAcks: 1, gpsMask: 1, loss: false, switchAt: 'none', mutant: 'gps-ack-all' }); }
  catch (error) {
    if (!error.message.includes('unacknowledged GPS rows must stay durable')) throw error;
    mutationCaught = true;
  }
  assert.ok(mutationCaught, 'scratch GPS ACK-all mutation escaped');
  await scenario({ coreAcks: 1, gpsMask: 1, loss: false, switchAt: 'none' });
  let publicationMutationCaught = false;
  try { await scenario({ coreAcks: 1, gpsMask: 1, loss: false, switchAt: 'none', mutant: 'no-dispatch' }); }
  catch (error) {
    if (!error.message.includes('first exchange publication count must match its outcome')) throw error;
    publicationMutationCaught = true;
  }
  assert.ok(publicationMutationCaught, 'scratch missing listener dispatch mutation escaped');
  await scenario({ coreAcks: 1, gpsMask: 1, loss: false, switchAt: 'none' });
  for (const file of owners) assert.equal(fs.readFileSync(path.join(repo, file), 'utf8'), sources[file], 'product source changed during replay');
  return { scenarios, mutationCaught, publicationMutationCaught, restoredBaselinePassed: true, sourceSha256: Object.fromEntries(owners.map(file => [file, hash(sources[file])])), scope: 'Real syncGroup, core flush/settlement, GPS exchange/settlement, exact successful snapshot/pending-refresh publication counts and first-call domain outcomes. External network, auth/privacy, SQLite driver and native packages mocked. No SQL/server/device execution. Assumes captured-actor execution; does not cover lazy authentication switching or p_actor_id/auth.uid rejection before effects.' };
};
