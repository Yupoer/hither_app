/**
 * OTA-04 Local-first core data — unit / contract tests.
 * Covers ticket 01 + 02, including review fixes (atomicity, version-0, wiring).
 */

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000099'),
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import type { Destination, Group, GroupState } from '../types';
import type {
  ActiveGatheringState,
  NavigationAnnouncementResponse,
} from '../types/coreData';
import {
  canEndGathering,
  canStartGathering,
  convergeActiveGathering,
  deriveActiveGatheringFromGroupState,
  endGathering,
  startGathering,
  switchGathering,
} from '../utils/activeGatheringState';
import {
  classifySnapshotRead,
  coreSnapshotFreshness,
  CORE_SNAPSHOT_STALE_MS,
} from '../utils/coreSnapshotFreshness';
import {
  CORE_ENTITY_VERSION_SEED,
  coreSnapshotFromGroupState,
  createCoreDataStore,
  groupStateFromCoreSnapshot,
  MemoryCoreDataDatabase,
  SQLiteCoreDataDatabase,
} from '../state/coreDataStore';
import {
  createCoreOperationOutbox,
  createLocalCoreOperationApplicator,
  MemoryCoreOperationOutboxDatabase,
} from '../state/coreOperationOutbox';

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'group-1',
    name: 'Test Trip',
    inviteCode: 'ABC123',
    createdBy: 'leader-1',
    journeyStatus: 'paused',
    stragglerAlerts: false,
    stragglerThresholdM: 200,
    ...overrides,
  };
}

function makeDest(id: string, order: number, closedAt?: string): Destination {
  return {
    id,
    title: `Stop ${order}`,
    order,
    day: 1,
    coordinates: { latitude: 25 + order * 0.01, longitude: 121.5 },
    closedAt,
  };
}

function makeState(overrides: Partial<GroupState> = {}): GroupState {
  const destinations = overrides.destinations ?? [
    makeDest('d1', 0),
    makeDest('d2', 1),
    makeDest('d3', 2),
  ];
  return {
    group: makeGroup({
      activeDestinationId: destinations[0]?.id,
      ...overrides.group,
    }),
    members: overrides.members ?? [
      {
        userId: 'leader-1',
        name: 'Leader',
        role: 'leader',
        status: 'active',
      },
    ],
    destinations,
    subgroups: overrides.subgroups ?? [],
    nextDestination: destinations[0],
    ...overrides,
  };
}

describe('OTA-04 active gathering semantics (OTA-01)', () => {
  it('starts only from staying + pending, ends only from en_route', () => {
    const base = deriveActiveGatheringFromGroupState(makeState(), 0);
    expect(base.journeyPhase).toBe('staying');
    expect(canStartGathering(base)).toBe(true);
    expect(canEndGathering(base)).toBe(false);

    const started = startGathering(base, 1_000);
    expect(started.journeyPhase).toBe('en_route');
    expect(started.pointStatuses.d1).toBe('en_route');
    expect(started.entityVersion).toBe(1);
    expect(canStartGathering(started)).toBe(false);
    expect(canEndGathering(started)).toBe(true);

    const ended = endGathering(started, 2_000);
    expect(ended.journeyPhase).toBe('staying');
    // End navigation pauses only — point stays open (pending), not completed.
    expect(ended.pointStatuses.d1).toBe('pending');
    expect(ended.activeDestinationId).toBe('d1');
    expect(ended.pointStatuses.d2).toBe('pending');
    expect(canStartGathering(ended)).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const base = deriveActiveGatheringFromGroupState(makeState(), 0);
    expect(() => endGathering(base, 1)).toThrow(/invalid_transition/);
    const started = startGathering(base, 1);
    expect(() => startGathering(started, 2)).toThrow(/invalid_transition/);
  });

  it('switches the active point without completing the previous point', () => {
    const base = deriveActiveGatheringFromGroupState(makeState(), 0);
    const started = startGathering(base, 1_000);
    const switched = switchGathering(started, 'd2', 2_000);

    expect(switched.journeyPhase).toBe('en_route');
    expect(switched.activeDestinationId).toBe('d2');
    expect(switched.pointStatuses.d1).toBe('pending');
    expect(switched.pointStatuses.d2).toBe('en_route');
    expect(switched.pointStatuses.d3).toBe('pending');
    expect(switched.entityVersion).toBe(started.entityVersion + 1);

    const same = switchGathering(switched, 'd2', 3_000);
    expect(same).toBe(switched);
    expect(() => switchGathering(switched, 'missing', 4_000)).toThrow(/unknown_gathering/);
  });

  it('converges two clients by entity version', () => {
    const a = deriveActiveGatheringFromGroupState(makeState(), 0, 100);
    const aStarted = startGathering(a, 200);
    const b = { ...a };
    expect(convergeActiveGathering(b, aStarted).entityVersion).toBe(
      aStarted.entityVersion,
    );
    const aEnded = endGathering(aStarted, 300);
    expect(convergeActiveGathering(aStarted, aEnded).journeyPhase).toBe('staying');
  });
});

describe('OTA-04 core snapshot store (ticket 01)', () => {
  it('seeds entity version at 0 (server empty entity contract)', async () => {
    const store = createCoreDataStore(new MemoryCoreDataDatabase(), () => 10_000);
    const saved = await store.saveRemoteGroupState(makeState());
    expect(saved.entityVersion).toBe(CORE_ENTITY_VERSION_SEED);
    expect(saved.activeGathering.entityVersion).toBe(CORE_ENTITY_VERSION_SEED);
    expect(CORE_ENTITY_VERSION_SEED).toBe(0);
  });

  /**
   * Regression: SQLite remote-save path used to call writeActiveGathering after
   * INSERT snapshot, which rewrote source to local_optimistic and poisoned the
   * pending guard. Must keep source === 'remote' when no pending outbox.
   */
  it('SQLite-style remote save keeps snapshot source remote (not optimistic)', async () => {
    type SnapRow = {
      group_id: string;
      payload: string;
      entity_version: number;
      synced_at: number;
      updated_at: number;
      source: string;
    };
    type GatherRow = {
      group_id: string;
      journey_phase: string;
      active_destination_id: string | null;
      point_statuses: string;
      phase_changed_at: number;
      entity_version: number;
      updated_at: number;
    };

    const snapshots = new Map<string, SnapRow>();
    const gatherings = new Map<string, GatherRow>();

    const exec = {
      runAsync: async (sql: string, ...params: unknown[]) => {
        if (sql.includes('INSERT INTO core_snapshots')) {
          const row: SnapRow = {
            group_id: params[0] as string,
            payload: params[1] as string,
            entity_version: params[2] as number,
            synced_at: params[3] as number,
            updated_at: params[4] as number,
            source: params[5] as string,
          };
          snapshots.set(row.group_id, row);
          return;
        }
        if (sql.includes('INSERT INTO core_active_gathering')) {
          const row: GatherRow = {
            group_id: params[0] as string,
            journey_phase: params[1] as string,
            active_destination_id: params[2] as string | null,
            point_statuses: params[3] as string,
            phase_changed_at: params[4] as number,
            entity_version: params[5] as number,
            updated_at: params[6] as number,
          };
          gatherings.set(row.group_id, row);
          return;
        }
        if (sql.includes('UPDATE core_snapshots')) {
          // payload, entity_version, updated_at, source, group_id
          const groupId = params[4] as string;
          const existing = snapshots.get(groupId);
          if (existing) {
            existing.payload = params[0] as string;
            existing.entity_version = params[1] as number;
            existing.updated_at = params[2] as number;
            existing.source = params[3] as string;
          }
        }
      },
      getFirstAsync: async <T,>(sql: string, ...params: unknown[]): Promise<T | null> => {
        if (sql.includes('core_snapshots')) {
          return (snapshots.get(params[0] as string) as T) ?? null;
        }
        if (sql.includes('core_active_gathering')) {
          return (gatherings.get(params[0] as string) as T) ?? null;
        }
        return null;
      },
    };

    const fakeDb = {
      ...exec,
      getAllAsync: async () => [],
      withExclusiveTransactionAsync: async (
        task: (txn: typeof exec) => Promise<void>,
      ) => {
        await task(exec);
      },
      withTransactionAsync: async (task: () => Promise<void>) => {
        await task();
      },
    };

    const sqliteDb = new SQLiteCoreDataDatabase(async () => fakeDb as never);
    const store = createCoreDataStore(sqliteDb, () => 42_000, async () => false);

    const saved = await store.saveRemoteGroupState(makeState(), { entityVersion: 0 });
    expect(saved.source).toBe('remote');

    const fromDb = await sqliteDb.getSnapshot('group-1');
    expect(fromDb?.source).toBe('remote');
    expect(snapshots.get('group-1')?.source).toBe('remote');

    // Second remote save must still stay remote (guard not poisoned).
    await store.saveRemoteGroupState(
      makeState({
        group: makeGroup({ journeyStatus: 'going', activeDestinationId: 'd1' }),
      }),
      { entityVersion: 0 },
    );
    expect((await sqliteDb.getSnapshot('group-1'))?.source).toBe('remote');

    // Outbox-style optimistic write still marks local_optimistic.
    const local = startGathering(
      deriveActiveGatheringFromGroupState(makeState(), 0),
      43_000,
    );
    await sqliteDb.putActiveGathering(local, { patchSnapshot: 'optimistic' });
    expect((await sqliteDb.getSnapshot('group-1'))?.source).toBe('local_optimistic');
  });

  it('saves first-batch core data with freshness metadata', async () => {
    let now = 10_000;
    const db = new MemoryCoreDataDatabase();
    const store = createCoreDataStore(db, () => now);
    const saved = await store.saveRemoteGroupState(makeState(), { entityVersion: 0 });
    expect(saved.syncedAt).toBe(10_000);
    expect(saved.source).toBe('remote');
    expect(saved.destinations).toHaveLength(3);

    const read = await store.readSnapshot('group-1');
    expect(coreSnapshotFreshness(read, now).unit).toBe('fresh');
    now += CORE_SNAPSHOT_STALE_MS + 1;
    expect(coreSnapshotFreshness(read, now).unit).toBe('stale');
    expect(classifySnapshotRead(null, now).kind).toBe('empty');
  });

  it('restores group + itinerary on offline cold start', async () => {
    const db = new MemoryCoreDataDatabase();
    const store = createCoreDataStore(db, () => 50_000);
    await store.saveRemoteGroupState(makeState());
    const cold = createCoreDataStore(db, () => 60_000);
    const restored = await cold.readGroupState('group-1');
    expect(restored?.group.id).toBe('group-1');
    expect(restored?.destinations.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('does not clobber local_optimistic gathering while pending guard is true', async () => {
    const db = new MemoryCoreDataDatabase();
    let pending = true;
    const store = createCoreDataStore(db, () => 1_000, async () => pending);
    await store.saveRemoteGroupState(makeState(), { entityVersion: 0 });
    const optimistic = startGathering(
      deriveActiveGatheringFromGroupState(makeState(), 0),
      2_000,
    );
    await db.putActiveGathering(optimistic);
    // Mark snapshot optimistic via putActiveGathering path
    expect((await db.getSnapshot('group-1'))?.source).toBe('local_optimistic');

    const remoteGoing = makeState({
      group: makeGroup({ journeyStatus: 'paused', activeDestinationId: 'd1' }),
    });
    await store.saveRemoteGroupState(remoteGoing, { entityVersion: 0 });
    const after = await store.getActiveGathering('group-1');
    expect(after?.journeyPhase).toBe('en_route');
    expect(after?.entityVersion).toBe(1);

    pending = false;
  });

  it('personal navigation response stays user-scoped', async () => {
    const db = new MemoryCoreDataDatabase();
    const store = createCoreDataStore(db, () => 1_000);
    await store.saveRemoteGroupState(makeState());
    const before = await store.getActiveGathering('group-1');
    await db.putNavigationResponse({
      sessionId: 'sess-1',
      userId: 'member-2',
      groupId: 'group-1',
      response: 'late',
      entityVersion: 1,
      updatedAt: 1_000,
    });
    expect(await store.getActiveGathering('group-1')).toEqual(before);
    expect((await store.getNavigationResponse('sess-1', 'member-2'))?.response).toBe(
      'late',
    );
  });
});

describe('OTA-04 operation outbox (ticket 02)', () => {
  function setup(nowRef: { now: number }) {
    const coreDb = new MemoryCoreDataDatabase();
    const outboxDb = new MemoryCoreOperationOutboxDatabase();
    const serverGathering = new Map<string, ActiveGatheringState>();
    const serverNav = new Map<string, NavigationAnnouncementResponse>();
    const applied = new Set<string>();
    const submit = createLocalCoreOperationApplicator(
      { gathering: serverGathering, navResponses: serverNav },
      applied,
    );
    const outbox = createCoreOperationOutbox(
      coreDb,
      outboxDb,
      submit,
      () => nowRef.now,
      () => `op-${outboxDb.operations.size + 1}`,
    );
    return { coreDb, outboxDb, serverGathering, serverNav, applied, outbox };
  }

  it('writes local state and outbox in one exclusive transaction path', async () => {
    const nowRef = { now: 1_000 };
    const { coreDb, outboxDb, outbox } = setup(nowRef);
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    await coreDb.putActiveGathering(base);

    const { operation, local } = await outbox.enqueueGatheringTransition({
      operationId: 'op-stable-1',
      groupId: 'group-1',
      action: 'start',
      baseState: base,
    });

    expect(local.journeyPhase).toBe('en_route');
    expect(operation.entityVersion).toBe(0);
    await expect(coreDb.getActiveGathering('group-1')).resolves.toMatchObject({
      journeyPhase: 'en_route',
    });
    await expect(outboxDb.get('op-stable-1')).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('rolls back local write when outbox insert fails (atomicity)', async () => {
    const nowRef = { now: 1_000 };
    const coreDb = new MemoryCoreDataDatabase();
    const outboxDb = new MemoryCoreOperationOutboxDatabase();
    outboxDb.failNextInsert = true;
    const outbox = createCoreOperationOutbox(
      coreDb,
      outboxDb,
      createLocalCoreOperationApplicator({
        gathering: new Map(),
        navResponses: new Map(),
      }),
      () => nowRef.now,
    );
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    await coreDb.putActiveGathering(base);

    await expect(
      outbox.enqueueGatheringTransition({
        operationId: 'op-fail',
        groupId: 'group-1',
        action: 'start',
        baseState: base,
      }),
    ).rejects.toThrow(/forced outbox insert failure/);

    // Gathering must remain at pre-enqueue staying (rolled back).
    await expect(coreDb.getActiveGathering('group-1')).resolves.toMatchObject({
      journeyPhase: 'staying',
      entityVersion: 0,
    });
    await expect(outboxDb.get('op-fail')).resolves.toBeNull();
  });

  it('end_gathering pauses active point without completing it', async () => {
    const nowRef = { now: 1_000 };
    const { outbox, serverGathering, coreDb } = setup(nowRef);
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    const enRoute = startGathering(base, 1_000);
    serverGathering.set('group-1', enRoute);
    await coreDb.putActiveGathering(enRoute);

    const { local } = await outbox.enqueueGatheringTransition({
      operationId: 'op-end-next',
      groupId: 'group-1',
      action: 'end',
      baseState: enRoute,
    });
    expect(local.activeDestinationId).toBe('d1');
    expect(local.pointStatuses.d1).toBe('pending');

    const result = await outbox.flush();
    expect(result.sent).toBe(1);
    expect(serverGathering.get('group-1')?.activeDestinationId).toBe('d1');
    expect(serverGathering.get('group-1')?.pointStatuses.d1).toBe('pending');
    // Accepted writeback must not clobber soft cursor with empty/null.
    await expect(coreDb.getActiveGathering('group-1')).resolves.toMatchObject({
      activeDestinationId: 'd1',
      journeyPhase: 'staying',
    });
  });

  it('marks gathering outbox conflict and restores base without flush retry', async () => {
    const nowRef = { now: 1_000 };
    const { outbox, coreDb, outboxDb } = setup(nowRef);
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    await coreDb.putActiveGathering(base);

    const { local, operation, base: appliedBase } =
      await outbox.enqueueGatheringTransition({
        operationId: 'op-abort-start',
        groupId: 'group-1',
        action: 'start',
        baseState: base,
      });
    expect(local.journeyPhase).toBe('en_route');
    expect(appliedBase.journeyPhase).toBe('staying');

    await outbox.markGatheringConflictAndRestore({
      operationId: operation.id,
      restore: appliedBase,
      message: 'active navigation session exists',
    });

    const op = await outboxDb.get(operation.id);
    expect(op?.status).toBe('conflict');
    expect(op?.conflictResult?.code).toBe('invalid_transition');
    expect(op?.conflictResult?.message).toContain('navigation session');
    await expect(coreDb.getActiveGathering('group-1')).resolves.toMatchObject({
      journeyPhase: 'staying',
      entityVersion: 0,
    });
    // Conflicted ops are not due — flush must not resubmit.
    const due = await outboxDb.getDue(nowRef.now + 60_000, 20);
    expect(due.find((row) => row.id === operation.id)).toBeUndefined();
  });

  it('does not write empty {} server_state into local gathering on conflict', async () => {
    const nowRef = { now: 1_000 };
    const coreDb = new MemoryCoreDataDatabase();
    const outboxDb = new MemoryCoreOperationOutboxDatabase();
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    await coreDb.putActiveGathering(base);
    const outbox = createCoreOperationOutbox(
      coreDb,
      outboxDb,
      async (op) => ({
        status: 'conflict' as const,
        operationId: op.id,
        conflict: {
          code: 'stale_version' as const,
          message: 'mismatch',
          serverEntityVersion: 0,
          serverState: {},
          operationId: op.id,
          entityType: op.entityType,
          entityId: op.entityId,
          occurredAt: nowRef.now,
        },
      }),
      () => nowRef.now,
    );
    await outbox.enqueueGatheringTransition({
      operationId: 'op-empty-state',
      groupId: 'group-1',
      action: 'start',
      baseState: base,
    });
    await outbox.flush();
    // Optimistic en_route must remain (empty server_state ignored).
    await expect(coreDb.getActiveGathering('group-1')).resolves.toMatchObject({
      journeyPhase: 'en_route',
    });
  });

  it('first apply succeeds when server entity is missing (version 0)', async () => {
    const nowRef = { now: 1_000 };
    const { outbox, serverGathering } = setup(nowRef);
    // Server map empty → version 0. Client base after saveRemote also 0.
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    await outbox.enqueueGatheringTransition({
      operationId: 'op-first',
      groupId: 'group-1',
      action: 'start',
      baseState: base,
    });
    const result = await outbox.flush();
    expect(result.sent).toBe(1);
    expect(result.conflicts).toBe(0);
    expect(serverGathering.get('group-1')?.journeyPhase).toBe('en_route');
    expect(serverGathering.get('group-1')?.entityVersion).toBe(1);
  });

  it('resubmitting same operation does not double-apply', async () => {
    const nowRef = { now: 1_000 };
    const { outbox, serverGathering, applied, outboxDb } = setup(nowRef);
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    const { operation, local } = await outbox.enqueueGatheringTransition({
      operationId: 'op-dup',
      groupId: 'group-1',
      action: 'start',
      baseState: base,
    });
    await outbox.flush();
    expect(serverGathering.get('group-1')?.entityVersion).toBe(local.entityVersion);

    // Re-queue same id against already-applied server (process death replay).
    const coreDb2 = new MemoryCoreDataDatabase();
    const outboxDb2 = new MemoryCoreOperationOutboxDatabase();
    const outbox2 = createCoreOperationOutbox(
      coreDb2,
      outboxDb2,
      createLocalCoreOperationApplicator(
        { gathering: serverGathering, navResponses: new Map() },
        applied,
      ),
      () => nowRef.now,
    );
    await outboxDb2.insert({
      ...operation,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: nowRef.now,
    });
    const versionBefore = serverGathering.get('group-1')!.entityVersion;
    const second = await outbox2.flush();
    expect(second.duplicates).toBe(1);
    expect(serverGathering.get('group-1')!.entityVersion).toBe(versionBefore);
    void outboxDb;
  });

  it('stale version returns displayable conflict', async () => {
    const nowRef = { now: 1_000 };
    const { outbox, serverGathering, coreDb } = setup(nowRef);
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    const serverAhead = startGathering(base, 500);
    serverGathering.set('group-1', serverAhead);

    await outbox.enqueueGatheringTransition({
      operationId: 'op-stale',
      groupId: 'group-1',
      action: 'start',
      baseState: base,
    });
    const result = await outbox.flush();
    expect(result.conflicts).toBe(1);
    const op = await outbox.getOperation('op-stale');
    expect(op?.status).toBe('failed');
    expect(op?.conflictResult?.code).toBe('stale_version');
    // Leader local state remains authoritative; remote stale state cannot
    // clobber the optimistic gathering or erase its point map.
    await expect(coreDb.getActiveGathering('group-1')).resolves.toMatchObject({
      journeyPhase: 'en_route',
      pointStatuses: expect.objectContaining({ d1: 'en_route' }),
    });
  });

  it('process termination keeps op for reconnect replay', async () => {
    const nowRef = { now: 1_000 };
    const { outbox } = setup(nowRef);
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    await outbox.enqueueGatheringTransition({
      operationId: 'op-crash',
      groupId: 'group-1',
      action: 'start',
      baseState: base,
    });
    expect((await outbox.peekPending()).map((p) => p.id)).toEqual(['op-crash']);
    await outbox.flush();
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('deletes acked outbox rows on successful flush', async () => {
    const nowRef = { now: 1_000 };
    const { outbox, outboxDb } = setup(nowRef);
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    await outbox.enqueueGatheringTransition({
      operationId: 'op-ack',
      groupId: 'group-1',
      action: 'start',
      baseState: base,
    });
    await outbox.flush();
    await expect(outboxDb.get('op-ack')).resolves.toBeNull();
  });

  it('retry schedules backoff then succeeds', async () => {
    const nowRef = { now: 1_000 };
    const coreDb = new MemoryCoreDataDatabase();
    const outboxDb = new MemoryCoreOperationOutboxDatabase();
    const serverGathering = new Map<string, ActiveGatheringState>();
    const applied = new Set<string>();
    let failOnce = true;
    const baseSubmit = createLocalCoreOperationApplicator(
      { gathering: serverGathering, navResponses: new Map() },
      applied,
    );
    const outbox = createCoreOperationOutbox(
      coreDb,
      outboxDb,
      async (op) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('network request failed');
        }
        return baseSubmit(op);
      },
      () => nowRef.now,
    );
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    await outbox.enqueueGatheringTransition({
      operationId: 'op-retry',
      groupId: 'group-1',
      action: 'start',
      baseState: base,
    });
    expect((await outbox.flush()).retryScheduled).toBe(1);
    const failed = await outbox.getOperation('op-retry');
    nowRef.now = failed!.nextAttemptAt;
    expect((await outbox.flush()).sent).toBe(1);
  });

  it('navigation response outbox never mutates team gathering', async () => {
    const nowRef = { now: 1_000 };
    const { outbox, coreDb, serverGathering, serverNav } = setup(nowRef);
    const team = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);
    await coreDb.putActiveGathering(team);
    serverGathering.set('group-1', team);
    await outbox.enqueueNavigationResponse({
      operationId: 'op-nav',
      groupId: 'group-1',
      sessionId: 'sess-1',
      userId: 'member-2',
      response: 'needs_help',
      baseVersion: 0,
    });
    await outbox.flush();
    expect(serverNav.get('sess-1:member-2')?.response).toBe('needs_help');
    expect(serverGathering.get('group-1')).toEqual(team);
  });

  it('two-client ordered and out-of-order updates converge', async () => {
    const nowRef = { now: 1_000 };
    const serverGathering = new Map<string, ActiveGatheringState>();
    const applied = new Set<string>();
    const submit = createLocalCoreOperationApplicator(
      { gathering: serverGathering, navResponses: new Map() },
      applied,
    );
    const base = deriveActiveGatheringFromGroupState(makeState(), 0, 1_000);

    const clientA = createCoreOperationOutbox(
      new MemoryCoreDataDatabase(),
      new MemoryCoreOperationOutboxDatabase(),
      submit,
      () => nowRef.now,
      () => 'op-a-start',
    );
    const clientB = createCoreOperationOutbox(
      new MemoryCoreDataDatabase(),
      new MemoryCoreOperationOutboxDatabase(),
      submit,
      () => nowRef.now,
      () => 'op-b-stale',
    );

    await clientA.enqueueGatheringTransition({
      operationId: 'op-a-start',
      groupId: 'group-1',
      action: 'start',
      baseState: base,
    });
    await clientA.flush();
    expect(serverGathering.get('group-1')?.journeyPhase).toBe('en_route');

    await clientB.enqueueGatheringTransition({
      operationId: 'op-b-stale',
      groupId: 'group-1',
      action: 'start',
      baseState: base,
    });
    expect((await clientB.flush()).conflicts).toBe(1);
  });
});

describe('OTA-04 snapshot helpers', () => {
  it('round-trips GroupState through snapshot helpers', () => {
    const state = makeState({
      group: makeGroup({ journeyStatus: 'going', activeDestinationId: 'd1' }),
    });
    const snap = coreSnapshotFromGroupState(state, {
      entityVersion: 0,
      syncedAt: 99,
      source: 'remote',
    });
    expect(snap.activeGathering.journeyPhase).toBe('en_route');
    const back = groupStateFromCoreSnapshot(snap);
    expect(back.group.journeyStatus).toBe('going');
  });
});

describe('OTA-04 contract surfaces', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const root = path.join(__dirname, '../../../..');

  it('declares core SQLite tables and hardened apply_core_operation', () => {
    const db = fs.readFileSync(
      path.join(__dirname, '../state/hitherDatabase.ts'),
      'utf8',
    );
    expect(db).toContain('core_snapshots');
    expect(db).toContain('core_operation_outbox');

    const migration = fs.readFileSync(
      path.join(root, 'supabase/migrations/20260725000200_core_operation_sync.sql'),
      'utf8',
    );
    expect(migration).toContain('apply_core_operation');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('stale_version');
    expect(migration).toContain('invalid_transition');
    expect(migration).toContain('cannot end while not en_route');
    expect(migration).toContain("v_phase is distinct from 'en_route'");
    expect(migration).toContain('_conflict');
    expect(migration).toContain('grant select on public.core_entity_versions');
    expect(migration).toContain("entity_version integer not null default 0");

    // Follow-up migration hardens itinerary ownership / next-open validation.
    const hardened = fs.readFileSync(
      path.join(
        root,
        'supabase/migrations/20260726000100_apply_core_operation_gathering_validation.sql',
      ),
      'utf8',
    );
    expect(hardened).toContain('create or replace function public.apply_core_operation');
    expect(hardened).toContain('start only allowed on next pending gathering point');
    expect(hardened).toContain('activeDestinationId does not belong to group');
    expect(hardened).toContain('destination is already closed');
    expect(hardened).toContain('nextDestinationId is not a legal next gathering point');
    expect(hardened).toContain('from public.itinerary_items');
    expect(hardened).toContain('for update');
    expect(hardened).not.toContain('jsonb_object_keys(v_point_statuses)');

    const switchMigration = fs.readFileSync(
      path.join(root, 'supabase/migrations/20260726000400_leader_gathering_switch.sql'),
      'utf8',
    );
    expect(switchMigration).toContain('create or replace function public.apply_leader_gathering_switch');
    expect(switchMigration).toContain('create or replace function public.start_navigation_session_switch');
    expect(switchMigration).toContain("v_statuses := v_statuses || jsonb_build_object(v_old, 'pending')");
    expect(switchMigration).toContain('never writes itinerary_items.closed_at');

    const pgtap = fs.readFileSync(
      path.join(root, 'supabase/tests/core_operation_gathering_validation.test.sql'),
      'utf8',
    );
    expect(pgtap).toContain('start rejects unknown itinerary id');
    expect(pgtap).toContain('start rejects non-next open gathering point');
    expect(pgtap).toContain('end rejects unknown nextDestinationId');
    expect(pgtap).toContain('end does not close itinerary (complete_gathering_stop does)');
    expect(pgtap).toContain('start accepts paused open gathering point again');
  });

  it('useGroupState hydrates versions and surfaces open operations', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../state/useGroupState.ts'),
      'utf8',
    );
    expect(source).toContain('readCoreSnapshot');
    expect(source).toContain('hydrateCoreEntityVersions');
    expect(source).toContain('listOpenCoreOperations');
    expect(source).toContain('openOperations');
    expect(source).toContain('flushCoreOperationOutbox');
  });

  it('product code wires gathering mutations through outbox', () => {
    const journey = fs.readFileSync(
      path.join(__dirname, '../screens/MapScreen/hooks/useJourneyNavigation.ts'),
      'utf8',
    );
    const map = fs.readFileSync(
      path.join(__dirname, '../screens/MapScreen.tsx'),
      'utf8',
    );
    const navSession = fs.readFileSync(
      path.join(__dirname, '../state/useNavigationSession.ts'),
      'utf8',
    );
    const groupState = fs.readFileSync(
      path.join(__dirname, '../state/useGroupState.ts'),
      'utf8',
    );
    const coreSync = fs.readFileSync(
      path.join(__dirname, '../state/coreDataSync.ts'),
      'utf8',
    );
    const app = fs.readFileSync(path.join(__dirname, '../../App.tsx'), 'utf8');

    expect(journey).toContain('enqueueLeaderGatheringStart');
    expect(journey).toContain('onOptimisticGathering');
    // OTA-01/04 P1: only retain outbox on transient network errors; never flush offline.
    expect(journey).toContain('resolveGatheringOutboxAfterSessionStart');
    expect(journey).toContain('abortLeaderGatheringStart');
    expect(journey).toContain('flushImmediately: false');
    expect(journey).toContain('flushCoreOperationOutbox');
    expect(journey.match(/void flushCoreOperationOutbox\(\)/g)?.length).toBe(1);
    expect(coreSync).toContain('abortLeaderGatheringStart');
    expect(coreSync).toContain('markGatheringConflictAndRestore');
    expect(coreSync).toContain('flushImmediately');
    expect(journey).toContain('enqueueLeaderGatheringEnd');
    expect(journey).toContain('cancelSession');
    // End navigation must not invoke the complete-stop RPC (MapScreen owns that).
    expect(journey).not.toMatch(/await completeGatheringStop\(/);
    expect(map).toContain('completeGatheringStop(groupId, destination.id)');
    expect(map).toContain('applyOptimisticGathering');
    expect(map).toContain('respondToAnnouncement');
    expect(map).not.toContain('hasCoreConflict');
    expect(map).not.toContain('coreData.pendingSync');
    expect(journey).toContain('enqueueLeaderGatheringSwitch');
    expect(journey).toContain('startSession(dest.id, requestRef.current.requestId, true)');
    const navigationService = fs.readFileSync(
      path.join(__dirname, '../api/services/NavigationService.ts'),
      'utf8',
    );
    expect(navigationService).toContain('start_navigation_session_switch');
    expect(coreSync).toContain("action: 'switch'");
    expect(coreSync).toContain('Leader switch');
    expect(map).not.toContain("t('coreData.syncConflict')");
    expect(navSession).toContain('enqueuePersonalNavigationResponse');
    expect(navSession).toContain('respondToAnnouncement');
    expect(groupState).toContain('subscribeCoreOutboxChanges');
    expect(app).toContain('initializeCoreDataLayer');
  });

  it('exclusive transaction helpers exist (no nested putActiveGathering BEGIN)', () => {
    const outbox = fs.readFileSync(
      path.join(__dirname, '../state/coreOperationOutbox.ts'),
      'utf8',
    );
    const store = fs.readFileSync(
      path.join(__dirname, '../state/coreDataStore.ts'),
      'utf8',
    );
    expect(outbox).toContain('writeActiveGathering');
    expect(outbox).toContain("patchSnapshot: 'optimistic'");
    expect(outbox).toContain('withExclusiveTransaction');
    expect(outbox).toContain('outboxDb.delete');
    expect(store).toContain('withExclusiveTransactionAsync');
    expect(store).toContain('CORE_ENTITY_VERSION_SEED');
    expect(store).toContain('sharedCoreDb');
    expect(store).toContain("patchSnapshot: 'none'");
    expect(store).toContain('WriteActiveGatheringOptions');
  });
});
