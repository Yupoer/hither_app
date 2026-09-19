/**
 * SQLite adapter boundary tests.
 *
 * The only mock here is expo-sqlite's native open call. Every SQL statement is
 * executed by Node 22's synchronous SQLite engine, including transactions,
 * constraints, indexes, and the production adapter code under test.
 */

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'crypto-id') }));

import type { Destination, Group, GroupState } from '../types';
import type {
  ActiveGatheringState,
  CoreGroupSnapshot,
  CoreOperation,
  NavigationAnnouncementResponse,
} from '../types/coreData';

type NativeDatabase = {
  exec(source: string): void;
  prepare(source: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | null;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  };
  close(): void;
};

type AsyncSqliteDatabase = {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: unknown[]): Promise<{
    changes: number;
    lastInsertRowId: number;
  }>;
  getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]>;
  withExclusiveTransactionAsync<T>(
    work: (transaction: AsyncSqliteDatabase) => Promise<T>,
  ): Promise<T>;
  withTransactionAsync<T>(
    work: (transaction: AsyncSqliteDatabase) => Promise<T>,
  ): Promise<T>;
  closeAsync(): Promise<void>;
  readonly __raw: NativeDatabase;
};

type ProductionHarness = {
  database: AsyncSqliteDatabase;
  raw: NativeDatabase;
  core: any;
  outbox: any;
  coreDataModule: any;
  createCoreOperationOutbox: any;
  createCoreDataStore: any;
  subscribeCoreOutboxChanges: (listener: () => void) => () => void;
};

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (source: string) => NativeDatabase;
};

let openDatabase: jest.Mock;
let openHarnesses: AsyncSqliteDatabase[] = [];

function bindParameters(params: unknown[]): unknown[] {
  // expo-sqlite accepts both runAsync(sql, ...params) and runAsync(sql, params).
  return params.length === 1 && Array.isArray(params[0])
    ? params[0] as unknown[]
    : params;
}

function makeAsyncSqliteDatabase(raw: NativeDatabase): AsyncSqliteDatabase {
  const runTransaction = async <T>(
    work: (transaction: AsyncSqliteDatabase) => Promise<T>,
  ): Promise<T> => {
    raw.exec('BEGIN IMMEDIATE');
    try {
      const result = await work(database);
      raw.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        raw.exec('ROLLBACK');
      } catch {
        // Preserve the original SQL/business error if rollback itself fails.
      }
      throw error;
    }
  };

  const database: AsyncSqliteDatabase = {
    __raw: raw,

    async execAsync(source) {
      raw.exec(source);
    },

    async runAsync(source, ...params) {
      const result = raw.prepare(source).run(...bindParameters(params));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },

    async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
      return raw.prepare(source).get(...bindParameters(params)) as T | null;
    },

    async getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]> {
      return raw.prepare(source).all(...bindParameters(params)) as T[];
    },

    async withExclusiveTransactionAsync<T>(
      work: (transaction: AsyncSqliteDatabase) => Promise<T>,
    ): Promise<T> {
      return runTransaction(work);
    },

    async withTransactionAsync<T>(
      work: (transaction: AsyncSqliteDatabase) => Promise<T>,
    ): Promise<T> {
      return runTransaction(work);
    },

    async closeAsync() {
      raw.close();
    },
  };

  return database;
}

async function loadProduction(database: AsyncSqliteDatabase): Promise<ProductionHarness> {
  // Reload the production modules so this also models a fresh JS process while
  // retaining the same durable SQLite connection for restart assertions.
  jest.resetModules();
  openDatabase = (require('expo-sqlite') as { openDatabaseAsync: jest.Mock }).openDatabaseAsync;
  openDatabase.mockResolvedValue(database);

  const { initializeHitherDatabase } = require('../state/hitherDatabase') as {
    initializeHitherDatabase: () => Promise<AsyncSqliteDatabase>;
  };
  await initializeHitherDatabase();

  const coreDataModule = require('../state/coreDataStore') as {
    SQLiteCoreDataDatabase: new (
      openDatabase?: () => Promise<AsyncSqliteDatabase>,
    ) => any;
    createCoreDataStore: (...args: unknown[]) => unknown;
  };
  const { SQLiteCoreDataDatabase, createCoreDataStore } = coreDataModule;
  const outboxModule = require('../state/coreOperationOutbox') as {
    SQLiteCoreOperationOutboxDatabase: new (
      openDatabase?: () => Promise<AsyncSqliteDatabase>,
    ) => any;
    createCoreOperationOutbox: (...args: unknown[]) => unknown;
    subscribeCoreOutboxChanges: (listener: () => void) => () => void;
  };
  const {
    SQLiteCoreOperationOutboxDatabase,
    createCoreOperationOutbox,
    subscribeCoreOutboxChanges,
  } = outboxModule;
  return {
    database,
    raw: database.__raw,
    core: new SQLiteCoreDataDatabase(() => Promise.resolve(database)),
    outbox: new SQLiteCoreOperationOutboxDatabase(() => Promise.resolve(database)),
    coreDataModule,
    createCoreOperationOutbox,
    createCoreDataStore,
    subscribeCoreOutboxChanges,
  };
}

async function newHarness(seed?: (raw: NativeDatabase) => void): Promise<ProductionHarness> {
  const raw = new DatabaseSync(':memory:');
  seed?.(raw);
  const database = makeAsyncSqliteDatabase(raw);
  openHarnesses.push(database);
  return loadProduction(database);
}

function makeGroup(id: string): Group {
  return {
    id,
    name: `Trip ${id}`,
    inviteCode: 'ABC123',
    createdBy: 'leader-a',
    journeyStatus: 'paused',
    stragglerAlerts: false,
    stragglerThresholdM: 200,
  };
}

function makeDestination(id: string, order: number): Destination {
  return {
    id,
    title: `Stop ${id}`,
    order,
    day: 1,
    coordinates: { latitude: 25 + order / 100, longitude: 121.5 },
  };
}

function makeGathering(groupId: string, overrides: Partial<ActiveGatheringState> = {}): ActiveGatheringState {
  return {
    groupId,
    journeyPhase: 'staying',
    activeDestinationId: null,
    pointStatuses: { 'local-destination': 'pending', 'second-destination': 'pending' },
    phaseChangedAt: 1_000,
    entityVersion: 0,
    ...overrides,
  };
}

function makeSnapshot(
  groupId: string,
  destinationIds: string[] = ['local-destination', 'second-destination'],
  overrides: Partial<CoreGroupSnapshot> = {},
): CoreGroupSnapshot {
  return {
    groupId,
    group: makeGroup(groupId),
    destinations: destinationIds.map(makeDestination),
    members: [],
    subgroups: [],
    activeGathering: makeGathering(groupId),
    entityVersion: 0,
    itineraryVersion: 0,
    syncedAt: 1_000,
    updatedAt: 1_000,
    source: 'remote',
    ...overrides,
  };
}

function makeGroupState(groupId: string, destinationIds = ['state-destination']): GroupState {
  const destinations = destinationIds.map(makeDestination);
  return {
    group: makeGroup(groupId),
    members: [],
    destinations,
    subgroups: [],
    nextDestination: destinations[0],
  };
}

function makeOperation(
  id: string,
  overrides: Partial<CoreOperation> = {},
): CoreOperation {
  return {
    id,
    actorId: 'actor-a',
    groupId: 'group-a',
    entityType: 'itinerary',
    entityId: 'group-a',
    entityVersion: 0,
    operationType: 'reorder_destinations',
    payload: { updates: [] },
    sequence: 1,
    dependencyIds: [],
    createdAt: 1_000,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 1_000,
    conflictResult: null,
    updatedAt: 1_000,
    ...overrides,
  };
}

function makeMutation(groupId: string, id?: string) {
  return {
    ...(id ? { operationId: id } : {}),
    groupId,
    actorId: 'actor-a',
    entityType: 'itinerary' as const,
    entityId: `${groupId}-entity`,
    operationType: 'reorder_destinations' as const,
    payload: { updates: [], groupId },
    flushImmediately: false,
  };
}

const accepted = (operation: CoreOperation) => ({
  status: 'accepted' as const,
  operationId: operation.id,
  entityVersion: operation.entityVersion + 1,
});

afterEach(async () => {
  for (const database of openHarnesses.splice(0)) {
    try {
      await database.closeAsync();
    } catch {
      // A failed initialization may have already closed the underlying handle.
    }
  }
  jest.clearAllMocks();
});

describe('SQLite core storage adapters', () => {
  it('upgrades a legacy outbox schema without losing durable rows', async () => {
    const harness = await newHarness((raw) => {
      raw.exec(`
        CREATE TABLE core_operation_outbox (
          id TEXT PRIMARY KEY NOT NULL,
          group_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          entity_version INTEGER NOT NULL,
          operation_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          conflict_result TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO core_operation_outbox
          (id, group_id, entity_type, entity_id, entity_version, operation_type,
           payload, status, attempts, next_attempt_at, conflict_result, created_at, updated_at)
        VALUES
          ('legacy-op', 'legacy-group', 'itinerary', 'legacy-entity', 2,
           'reorder_destinations', '{"updates":[]}', 'pending', 0, 2000, NULL, 1000, 1000);
      `);
    });

    const columns = (await harness.database.getAllAsync<{ name: string }>(
      'PRAGMA table_info(core_operation_outbox)',
    )).map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining([
      'actor_id',
      'sequence',
      'dependency_ids',
      'inflight_started_at',
      'last_error',
    ]));

    const legacy = await harness.outbox.get('legacy-op');
    expect(legacy).toMatchObject({
      id: 'legacy-op',
      groupId: 'legacy-group',
      entityVersion: 2,
      payload: { updates: [] },
      sequence: 0,
      dependencyIds: [],
      status: 'pending',
    });
    expect(await harness.database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM core_operation_outbox',
    )).toEqual({ count: 1 });
  });

  it('reads, writes, updates, aliases, and deletes real SQLite core rows', async () => {
    const harness = await newHarness();
    const snapshot = makeSnapshot('group-a');

    await harness.core.initialize();
    await harness.core.putSnapshot(snapshot);
    expect(await harness.core.getSnapshot('group-a')).toEqual(snapshot);
    expect(await harness.core.readSnapshotInTransaction(
      harness.database,
      'group-a',
    )).toEqual(snapshot);
    expect(await harness.core.findSnapshotGroupForDestination('local-destination'))
      .toBe('group-a');
    expect(await harness.core.findSnapshotGroupForDestination('missing')).toBeNull();

    const active = makeGathering('group-a', {
      journeyPhase: 'en_route',
      activeDestinationId: 'local-destination',
      pointStatuses: { 'local-destination': 'en_route', 'second-destination': 'pending' },
      entityVersion: 1,
      phaseChangedAt: 2_000,
    });
    await harness.core.putActiveGathering(active);
    expect(await harness.core.getActiveGathering('group-a')).toEqual(active);
    expect(await harness.core.hasLocalOptimisticGathering('group-a')).toBe(true);
    expect((await harness.core.getSnapshot('group-a'))?.source).toBe('local_optimistic');

    const response: NavigationAnnouncementResponse = {
      sessionId: 'session-a',
      userId: 'user-a',
      groupId: 'group-a',
      response: 'acknowledged',
      entityVersion: 1,
      updatedAt: 2_000,
    };
    await harness.core.putNavigationResponse(response);
    expect(await harness.core.getNavigationResponse('session-a', 'user-a')).toEqual(response);
    expect(await harness.core.listNavigationResponsesForSession('session-a')).toEqual([response]);

    await harness.core.withExclusiveTransaction(async (exec: unknown) => {
      await harness.core.writeDestinationAlias(
        exec,
        'group-a',
        'local-destination',
        'canonical-destination',
        3_000,
      );
      await harness.core.writeNavigationResponse(exec, {
        ...response,
        response: 'needs_help',
        entityVersion: 2,
        updatedAt: 3_000,
      });
    });
    expect(await harness.core.getNavigationResponse('session-a', 'user-a')).toMatchObject({
      response: 'needs_help',
      entityVersion: 2,
    });
    expect(await harness.database.getFirstAsync<{ canonical_destination_id: string }>(
      `SELECT canonical_destination_id
       FROM core_destination_id_aliases
       WHERE group_id = ? AND local_destination_id = ?`,
      'group-a',
      'local-destination',
    )).toEqual({ canonical_destination_id: 'canonical-destination' });

    await harness.core.deleteSnapshot('group-a');
    expect(await harness.core.getSnapshot('group-a')).toBeNull();
    expect(await harness.core.getActiveGathering('group-a')).toBeNull();
  });

  it('runs the public core data store facade against SQLite with pending preservation', async () => {
    const harness = await newHarness();
    const store = harness.createCoreDataStore(
      harness.core,
      () => 10_000,
      async () => false,
    );
    const initialState = makeGroupState('store-group');

    expect(await store.readSnapshot('store-group')).toBeNull();
    const saved = await store.saveRemoteGroupState(initialState, {
      entityVersion: 3,
      itineraryVersion: 4,
      gatheringVersion: 2,
    });
    expect(saved).toMatchObject({
      groupId: 'store-group',
      entityVersion: 3,
      itineraryVersion: 4,
      source: 'remote',
    });
    expect((await store.readGroupState('store-group'))?.destinations.map((item: Destination) => item.id))
      .toEqual(['state-destination']);
    expect(await store.getActiveGathering('store-group')).toEqual(saved.activeGathering);

    const localGathering = makeGathering('store-group', {
      journeyPhase: 'en_route',
      activeDestinationId: 'state-destination',
      pointStatuses: { 'state-destination': 'en_route' },
      entityVersion: 4,
      phaseChangedAt: 11_000,
    });
    await harness.core.putActiveGathering(localGathering);
    const guardedStore = harness.createCoreDataStore(
      harness.core,
      () => 12_000,
      async () => true,
    );
    const remote = await guardedStore.saveRemoteGroupState(
      makeGroupState('store-group', ['remote-destination']),
      { entityVersion: 5, gatheringVersion: 0 },
    );
    expect(remote.source).toBe('local_optimistic');
    expect(remote.activeGathering).toEqual(localGathering);
    expect(remote.destinations.map((item: Destination) => item.id)).toEqual(['remote-destination']);

    // The shared exported facade must resolve through the same mocked native
    // database, not through a separate memory implementation.
    harness.coreDataModule.setPendingGatheringGuard(async () => false);
    const wrapperSaved = await harness.coreDataModule.saveRemoteGroupState(
      makeGroupState('wrapper-group'),
      8,
    );
    expect(await harness.coreDataModule.readCoreSnapshot('wrapper-group'))
      .toEqual(wrapperSaved);
    expect(await harness.coreDataModule.readCoreGroupState('wrapper-group'))
      .toMatchObject({ group: { id: 'wrapper-group' } });
    expect(await harness.coreDataModule.getCoreActiveGathering('wrapper-group'))
      .toEqual(wrapperSaved.activeGathering);
    expect(await harness.coreDataModule.getCoreNavigationResponse('missing', 'user'))
      .toBeNull();
    expect(harness.coreDataModule.getDefaultCoreDataStore()).toBeDefined();
  });

  it('rolls back a snapshot and queue together when a real SQL insert fails', async () => {
    const harness = await newHarness();
    const before = makeSnapshot('group-a', ['before-destination']);
    await harness.core.putSnapshot(before);

    await expect(harness.core.withExclusiveTransaction(async (exec: any) => {
      await harness.core.writeSnapshot(exec, makeSnapshot('group-a', ['after-destination']));
      await harness.outbox.writeInsert(exec, makeOperation('rollback-op'));
      // This is intentionally invalid SQL data, not a mocked failure. The
      // NOT NULL constraint must abort the same SQLite transaction.
      await exec.runAsync(
        'INSERT INTO core_operation_outbox (id, group_id) VALUES (?, ?)',
        'broken-row',
        null,
      );
    })).rejects.toThrow();

    expect((await harness.core.getSnapshot('group-a'))?.destinations.map((item: Destination) => item.id))
      .toEqual(['before-destination']);
    expect(await harness.outbox.get('rollback-op')).toBeNull();
    expect(await harness.database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM core_operation_outbox WHERE id = 'broken-row'`,
    )).toEqual({ count: 0 });
  });

  it('uses FIFO heads per actor/group and preserves direct outbox CRUD', async () => {
    const harness = await newHarness();
    const firstDirectSequence = await harness.outbox.allocateSequence('actor-z', 'group-z');
    const secondDirectSequence = await harness.outbox.allocateSequence('actor-z', 'group-z');
    expect([firstDirectSequence, secondDirectSequence]).toEqual([1, 2]);

    const direct = makeOperation('direct-op', {
      groupId: 'direct-group',
      entityId: 'direct-entity',
      sequence: 1,
    });
    await harness.outbox.insert(direct);
    expect(await harness.outbox.get('direct-op')).toEqual(direct);
    expect(await harness.outbox.countPending()).toBe(1);
    expect(await harness.outbox.countPendingForEntity(
      'direct-group',
      'itinerary',
      'direct-entity',
    )).toBe(1);
    expect((await harness.outbox.listByGroup('direct-group')).map((item: CoreOperation) => item.id))
      .toEqual(['direct-op']);
    expect((await harness.outbox.listAll()).map((item: CoreOperation) => item.id))
      .toContain('direct-op');
    expect((await harness.outbox.listOpenByGroup('direct-group')).map((item: CoreOperation) => item.id))
      .toEqual(['direct-op']);

    const updatedDirect = {
      ...direct,
      status: 'failed' as const,
      attempts: 1,
      nextAttemptAt: 2_000,
      lastError: 'offline',
      updatedAt: 2_000,
    };
    await harness.outbox.update(updatedDirect);
    expect(await harness.outbox.getDue(2_000, 10)).toMatchObject([updatedDirect]);
    await harness.outbox.delete('direct-op');
    expect(await harness.outbox.get('direct-op')).toBeNull();

    const calls: string[] = [];
    let failFirst = true;
    const listener = jest.fn();
    const unsubscribe = harness.subscribeCoreOutboxChanges(listener);
    const queue = harness.createCoreOperationOutbox(
      harness.core,
      harness.outbox,
      async (operation: CoreOperation) => {
        calls.push(operation.id);
        if (operation.id === 'fifo-a-1' && failFirst) {
          failFirst = false;
          throw new Error('offline');
        }
        return accepted(operation);
      },
      () => 1_000,
      (() => {
        const ids = ['unused', 'unused-2'];
        return () => ids.shift() ?? 'unused-3';
      })(),
      async () => 'actor-a',
    );
    const first = await queue.enqueueMutation(makeMutation('group-a', 'fifo-a-1'));
    const second = await queue.enqueueMutation(makeMutation('group-a', 'fifo-a-2'));
    const otherGroup = await queue.enqueueMutation(makeMutation('group-b', 'fifo-b-1'));
    expect([first.sequence, second.sequence, otherGroup.sequence]).toEqual([1, 2, 1]);
    expect(listener).toHaveBeenCalled();
    const notificationsBeforeUnsubscribe = listener.mock.calls.length;
    unsubscribe();
    expect(second.dependencyIds).toEqual(['fifo-a-1']);
    expect((await queue.listByGroup('group-a')).map((item: CoreOperation) => item.id))
      .toEqual(['fifo-a-1', 'fifo-a-2']);
    expect((await queue.listOpenByGroup('group-a')).map((item: CoreOperation) => item.id))
      .toEqual(['fifo-a-1', 'fifo-a-2']);
    expect(await queue.pendingCount()).toBe(3);
    expect((await queue.peekPending()).map((item: CoreOperation) => item.id))
      .toEqual(['fifo-a-1', 'fifo-b-1']);

    const firstFlush = await queue.flush(10);
    expect(firstFlush.retryScheduled).toBe(1);
    expect(calls).toEqual(['fifo-a-1', 'fifo-b-1']);
    expect((await queue.getOperation('fifo-a-2'))?.status).toBe('pending');

    const failed = await queue.getOperation('fifo-a-1');
    await harness.outbox.update({ ...failed!, nextAttemptAt: 1_000 });
    expect((await queue.flush(10)).sent).toBe(1);
    expect(calls).toEqual(['fifo-a-1', 'fifo-b-1', 'fifo-a-1']);
    expect((await queue.flush(10)).sent).toBe(1);
    expect(calls).toEqual(['fifo-a-1', 'fifo-b-1', 'fifo-a-1', 'fifo-a-2']);
    expect(listener.mock.calls.length).toBe(notificationsBeforeUnsubscribe);
  });

  it('persists arrival/navigation queue methods and restores a gathering conflict', async () => {
    const harness = await newHarness();
    const queue = harness.createCoreOperationOutbox(
      harness.core,
      harness.outbox,
      async (operation: CoreOperation) => accepted(operation),
      () => 2_500,
      (() => {
        const ids = ['arrival-op', 'navigation-op', 'gathering-op'];
        return () => ids.shift() ?? 'extra-queue-op';
      })(),
      async () => 'actor-a',
    );
    queue.setActorGuard(async () => 'actor-a');

    const arrival = await queue.enqueueArrival(
      'arrival-group',
      'destination-a',
      {
        actorId: 'actor-a',
        userId: 'actor-a',
        arrived: true,
        arrivedAt: '2026-09-19T00:00:00.000Z',
      },
    );
    expect(await queue.getOperation(arrival.id)).toMatchObject({
      operationType: 'record_arrival',
      entityId: 'destination-a',
    });
    await queue.removeArrival(arrival.id);
    expect(await queue.getOperation(arrival.id)).toBeNull();

    const navigation = await queue.enqueueNavigationResponse({
      groupId: 'arrival-group',
      sessionId: 'session-a',
      userId: 'actor-a',
      response: 'needs_help',
      baseVersion: 0,
      actorId: 'actor-a',
    });
    expect(await harness.core.getNavigationResponse('session-a', 'actor-a'))
      .toEqual(navigation.local);

    const base = makeGathering('gathering-group');
    await harness.core.putSnapshot(makeSnapshot('gathering-group', ['local-destination'], {
      activeGathering: base,
    }));
    const transition = await queue.enqueueGatheringTransition({
      groupId: 'gathering-group',
      action: 'start',
      activeDestinationId: 'local-destination',
      baseState: base,
      actorId: 'actor-a',
    });
    expect(await queue.hasPendingGathering('gathering-group')).toBe(true);
    await queue.markGatheringConflictAndRestore({
      operationId: transition.operation.id,
      restore: base,
      message: 'leader rejected transition',
    });
    expect(await queue.getOperation(transition.operation.id)).toMatchObject({
      status: 'conflict',
      conflictResult: { code: 'invalid_transition' },
    });
    expect(await queue.hasPendingGathering('gathering-group')).toBe(false);
    expect(await harness.core.getActiveGathering('gathering-group')).toEqual(base);
    expect((await queue.listOpenByGroup('gathering-group')).map((item: CoreOperation) => item.id))
      .toEqual([transition.operation.id]);
    expect(await queue.pendingCount()).toBe(1);
    void navigation;
  });

  it('retains durable conflicts as open drafts but excludes them from pending work', async () => {
    const harness = await newHarness();
    const queue = harness.createCoreOperationOutbox(
      harness.core,
      harness.outbox,
      async (operation: CoreOperation) => ({
        status: 'conflict' as const,
        operationId: operation.id,
        conflict: {
          code: 'stale_version' as const,
          message: 'server advanced',
          serverEntityVersion: 4,
          serverState: { destinations: [] },
          operationId: operation.id,
          entityType: operation.entityType,
          entityId: operation.entityId,
          occurredAt: 2_000,
        },
      }),
      () => 2_000,
      () => 'conflict-op',
      async () => 'actor-a',
    );
    const operation = await queue.enqueueMutation(makeMutation('conflict-group'));
    expect((await queue.flush()).conflicts).toBe(1);

    const conflict = await harness.outbox.get(operation.id);
    expect(conflict).toMatchObject({
      status: 'conflict',
      attempts: 1,
      nextAttemptAt: Number.MAX_SAFE_INTEGER,
      conflictResult: { code: 'stale_version', serverEntityVersion: 4 },
    });
    expect(await harness.outbox.countPending()).toBe(0);
    expect(await harness.outbox.countPendingForEntity(
      'conflict-group',
      'itinerary',
      'conflict-group-entity',
    )).toBe(0);
    expect((await harness.outbox.listOpenByGroup('conflict-group')).map((item: CoreOperation) => item.id))
      .toEqual([operation.id]);
    expect(await harness.outbox.getDue(2_000, 10)).toEqual([]);
    expect((await queue.listConflicts('conflict-group')).map((item: CoreOperation) => item.id))
      .toEqual([operation.id]);

    const recreated = await queue.recreateConflict(operation.id, {
      latestServerVersion: 4,
      operationId: 'recreated-op',
    });
    expect(recreated).toMatchObject({
      id: 'recreated-op',
      actorId: 'actor-a',
      entityVersion: 4,
      status: 'pending',
      dependencyIds: [],
      payload: { recreatedFrom: operation.id },
    });
    expect(await harness.outbox.countPending()).toBe(1);
  });

  it('stores canonical destination aliases and rewrites pending payloads', async () => {
    const harness = await newHarness();
    await harness.core.putSnapshot(makeSnapshot('group-a', ['local-destination', 'second-destination']));

    let submitCount = 0;
    const queue = harness.createCoreOperationOutbox(
      harness.core,
      harness.outbox,
      async (operation: CoreOperation) => {
        submitCount += 1;
        return submitCount === 1
          ? {
              ...accepted(operation),
              effects: { destinationIdAliases: { 'local-destination': 'canonical-destination' } },
            }
          : accepted(operation);
      },
      () => 3_000,
      (() => {
        const ids = ['alias-op', 'dependent-op'];
        return () => ids.shift() ?? 'extra-op';
      })(),
      async () => 'actor-a',
    );

    const aliasOperation = await queue.enqueueMutation({
      ...makeMutation('group-a'),
      entityId: 'group-a',
      operationType: 'add_destination',
      payload: { destinationId: 'local-destination', title: 'Local' },
    });
    const dependent = await queue.enqueueMutation({
      ...makeMutation('group-a'),
      entityId: 'group-a',
      operationType: 'edit_destination',
      payload: {
        destinationId: 'local-destination',
        nested: ['local-destination'],
      },
    });
    expect(await queue.flush()).toMatchObject({ sent: 1 });

    expect((await harness.core.getSnapshot('group-a'))?.destinations.map((item: Destination) => item.id))
      .toEqual(['canonical-destination', 'second-destination']);
    expect(await harness.core.findSnapshotGroupForDestination('canonical-destination'))
      .toBe('group-a');
    expect(await harness.core.findSnapshotGroupForDestination('local-destination')).toBeNull();
    expect(await harness.database.getFirstAsync<{ canonical_destination_id: string }>(
      `SELECT canonical_destination_id
       FROM core_destination_id_aliases
       WHERE group_id = ? AND local_destination_id = ?`,
      'group-a',
      'local-destination',
    )).toEqual({ canonical_destination_id: 'canonical-destination' });
    expect(await harness.outbox.get(dependent.id)).toMatchObject({
      payload: {
        destinationId: 'canonical-destination',
        nested: ['canonical-destination'],
      },
    });
    expect(await harness.outbox.get(aliasOperation.id)).toBeNull();
  });

  it('recovers an inflight operation after reloading production adapters', async () => {
    const firstHarness = await newHarness();
    const firstQueue = firstHarness.createCoreOperationOutbox(
      firstHarness.core,
      firstHarness.outbox,
      async (operation: CoreOperation) => accepted(operation),
      () => 4_000,
      () => 'restart-op',
      async () => 'actor-a',
    );
    const operation = await firstQueue.enqueueMutation(makeMutation('restart-group'));
    await firstHarness.outbox.update({
      ...operation,
      status: 'inflight',
      inflightStartedAt: 3_900,
      nextAttemptAt: Number.MAX_SAFE_INTEGER,
      updatedAt: 4_000,
    });

    const restartedHarness = await loadProduction(firstHarness.database);
    const replayed: string[] = [];
    const restartedQueue = restartedHarness.createCoreOperationOutbox(
      restartedHarness.core,
      restartedHarness.outbox,
      async (row: CoreOperation) => {
        replayed.push(row.id);
        return accepted(row);
      },
      () => 5_000,
      () => 'unused-after-restart',
      async () => 'actor-a',
    );
    expect(await restartedQueue.flush()).toMatchObject({ sent: 1, remaining: 0 });
    expect(replayed).toEqual(['restart-op']);
    expect(await restartedHarness.outbox.get('restart-op')).toBeNull();
  });

  it('applies optimistic local state and resolves a durable conflict to remote state', async () => {
    const harness = await newHarness();
    const base = makeSnapshot('gathering-group', ['local-destination'], {
      activeGathering: makeGathering('gathering-group'),
    });
    await harness.core.putSnapshot(base);

    const remoteState = makeGathering('gathering-group', {
      journeyPhase: 'staying',
      activeDestinationId: null,
      entityVersion: 7,
      phaseChangedAt: 7_000,
    });
    const queue = harness.createCoreOperationOutbox(
      harness.core,
      harness.outbox,
      async (operation: CoreOperation) => ({
        status: 'conflict' as const,
        operationId: operation.id,
        conflict: {
          code: 'stale_version' as const,
          message: 'stale gathering version',
          serverEntityVersion: 7,
          serverState: remoteState,
          operationId: operation.id,
          entityType: operation.entityType,
          entityId: operation.entityId,
          occurredAt: 7_000,
        },
      }),
      () => 6_000,
      () => 'gathering-op',
      async () => 'actor-a',
    );

    const transition = await queue.enqueueGatheringTransition({
      groupId: 'gathering-group',
      action: 'start',
      activeDestinationId: 'local-destination',
      baseState: base.activeGathering,
      actorId: 'actor-a',
    });
    expect((await harness.core.getSnapshot('gathering-group'))?.source).toBe('local_optimistic');
    expect((await harness.core.getActiveGathering('gathering-group'))?.journeyPhase)
      .toBe('en_route');
    expect((await queue.flush()).conflicts).toBe(1);
    expect(await harness.core.getActiveGathering('gathering-group')).toEqual(remoteState);
    expect((await harness.core.getSnapshot('gathering-group'))?.source).toBe('remote');
    expect((await queue.listConflicts('gathering-group')).map((item: CoreOperation) => item.id))
      .toEqual([transition.operation.id]);
  });

  it('filters foreign actors before a one-row SQLite batch and sleeps when only foreign drafts remain', async () => {
    const harness = await newHarness();
    let actor = 'actor-a';
    let next = 0;
    const submit = jest.fn(async (operation: CoreOperation) => ({
      status: 'accepted' as const, operationId: operation.id, entityVersion: 1,
    }));
    const queue = harness.createCoreOperationOutbox(harness.core, harness.outbox, submit,
      () => 1000, () => `sqlite-actor-${++next}`, async () => actor);
    const original = await queue.enqueueArrival('g', 'd', { actorId: actor, userId: actor, arrived: true });
    actor = 'actor-b';
    const current = await queue.enqueueArrival('g', 'd', { actorId: actor, userId: actor, arrived: true });
    expect((await queue.flush(1)).remaining).toBe(0);
    expect(submit.mock.calls.map(([op]) => op.id)).toEqual([current.id]);
    expect((await queue.getOperation(original.id)).status).toBe('pending');
  });
});
