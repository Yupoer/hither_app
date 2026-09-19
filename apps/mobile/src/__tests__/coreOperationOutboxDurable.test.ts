jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'generated-id') }));
jest.mock('../api/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn(), from: jest.fn() },
}));

import type { GroupState } from '../types';
import type { ApplyCoreOperationResult, CoreOperation } from '../types/coreData';
import {
  createCoreOperationOutbox,
  MemoryCoreOperationOutboxDatabase,
} from '../state/coreOperationOutbox';
import {
  createCoreDataStore,
  groupStateFromCoreSnapshot,
  MemoryCoreDataDatabase,
  type CoreSqlExecutor,
} from '../state/coreDataStore';
import { projectPendingDestinations } from '../state/coreDataSync';
import { applyCoreOperation } from '../api/services/CoreDataService';
import { supabase } from '../api/supabase';

const mockedSupabase = supabase as unknown as {
  auth: { getSession: jest.Mock };
};

const accepted = (operation: CoreOperation): ApplyCoreOperationResult => ({
  status: 'accepted',
  operationId: operation.id,
  entityVersion: operation.entityVersion + 1,
});

function makeQueue(
  db: MemoryCoreOperationOutboxDatabase,
  submit: (operation: CoreOperation) => Promise<ApplyCoreOperationResult>,
  actor: { value: string | null } = { value: 'actor-a' },
  now: () => number = () => 1_000,
  coreDb = new MemoryCoreDataDatabase(),
) {
  let nextId = 0;
  return createCoreOperationOutbox(
    coreDb,
    db,
    submit,
    now,
    () => `op-${++nextId}`,
    async () => actor.value,
  );
}

function mutation(groupId: string, actorId = 'actor-a') {
  return {
    groupId,
    actorId,
    entityType: 'itinerary' as const,
    entityId: groupId,
    operationType: 'reorder_destinations' as const,
    payload: { updates: [] },
    flushImmediately: false,
  };
}

function snapshotForGroup(
  groupId = 'group-a',
  itineraryVersion = 0,
  ownerActorId?: string,
) {
  return {
    groupId,
    ...(ownerActorId ? { ownerActorId } : {}),
    group: { id: groupId },
    destinations: [],
    members: [],
    subgroups: [],
    activeGathering: {
      groupId,
      journeyPhase: 'staying' as const,
      activeDestinationId: null,
      pointStatuses: {},
      phaseChangedAt: 1_000,
      entityVersion: 0,
    },
    itineraryVersion,
    entityVersion: 0,
    syncedAt: 1_000,
    updatedAt: 1_000,
    source: 'remote' as const,
  };
}

describe('durable core operation outbox', () => {
  it('enforces FIFO per actor/group while allowing another group to proceed', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const calls: string[] = [];
    let firstAttempt = true;
    const queue = makeQueue(db, async (operation) => {
      calls.push(operation.id);
      if (operation.id === 'op-1' && firstAttempt) {
        firstAttempt = false;
        throw new Error('offline');
      }
      return accepted(operation);
    });

    const first = await queue.enqueueMutation(mutation('group-a'));
    const second = await queue.enqueueMutation(mutation('group-a'));
    const other = await queue.enqueueMutation(mutation('group-b'));
    expect([first.sequence, second.sequence]).toEqual([1, 2]);

    const firstFlush = await queue.flush(10);
    expect(firstFlush.retryScheduled).toBe(1);
    expect(calls).toEqual(['op-1', 'op-3']);
    expect(await queue.getOperation(second.id)).toMatchObject({ status: 'pending' });

    await db.update({ ...(await queue.getOperation(first.id))!, nextAttemptAt: 1_000 });
    const secondFlush = await queue.flush(10);
    expect(secondFlush.sent).toBe(1);
    expect(calls).toEqual(['op-1', 'op-3', 'op-1']);

    // The second same-group row was not included in the first head snapshot;
    // it becomes eligible only after the first operation is acknowledged.
    expect((await queue.flush(10)).sent).toBe(1);
    expect(calls).toEqual(['op-1', 'op-3', 'op-1', 'op-2']);
    void other;
  });

  it('replays an inflight row after restart with the same operation id', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const original = makeQueue(db, async (operation) => accepted(operation));
    const operation = await original.enqueueMutation(mutation('group-a'));
    await db.update({
      ...operation,
      status: 'inflight',
      nextAttemptAt: 9_999_999,
      inflightStartedAt: 900,
    });

    const calls: string[] = [];
    const restarted = makeQueue(db, async (row) => {
      calls.push(row.id);
      return accepted(row);
    });
    await restarted.flush();
    expect(calls).toEqual([operation.id]);
    expect(await restarted.getOperation(operation.id)).toBeNull();
  });

  it('never replays an operation after the authenticated account changes', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const actor = { value: 'actor-a' as string | null };
    const submit = jest.fn(async (operation: CoreOperation) => accepted(operation));
    const queue = makeQueue(db, submit, actor);
    const operation = await queue.enqueueMutation(mutation('group-a'));
    actor.value = 'actor-b';

    const result = await queue.flush();
    expect(result.paused).toBe(true);
    expect(result.conflicts).toBe(0);
    expect(submit).not.toHaveBeenCalled();
    expect(await queue.getOperation(operation.id)).toMatchObject({
      status: 'pending',
      conflictResult: null,
    });
  });

  it('does not apply an accepted receipt after the account changes mid-transport', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const coreDb = new MemoryCoreDataDatabase();
    await coreDb.putSnapshot(snapshotForGroup() as never);
    const actor = { value: 'actor-a' as string | null };
    const submit = jest.fn(async (operation: CoreOperation) => {
      actor.value = 'actor-b';
      return {
        status: 'accepted' as const,
        operationId: operation.id,
        entityVersion: 1,
        entity: { destinations: [], entityVersion: 1 },
      };
    });
    const queue = makeQueue(db, submit, actor, () => 1_000, coreDb);
    const operation = await queue.enqueueMutation(mutation('group-a'));
    const result = await queue.flush();
    expect(result.paused).toBe(true);
    expect(await queue.getOperation(operation.id)).toMatchObject({
      status: 'pending', lastError: 'account_changed',
    });
    expect((await coreDb.getSnapshot('group-a'))?.source).toBe('remote');
  });

  it('pauses on a typed session refresh failure and preserves the durable draft', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const submit = jest.fn(async () => {
      throw Object.assign(new Error('Authenticated session is missing or expired'), {
        code: 'session_missing_or_expired',
        status: 401,
      });
    });
    const queue = makeQueue(db, submit);
    const operation = await queue.enqueueMutation(mutation('group-a'));

    const result = await queue.flush();
    expect(result.paused).toBe(true);
    expect(result.conflicts).toBe(0);
    expect(result.retryScheduled).toBe(0);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await queue.getOperation(operation.id)).toMatchObject({
      status: 'pending',
      attempts: 0,
      conflictResult: null,
    });
  });

  it('does not convert CoreDataService session refresh failure into a terminal conflict', async () => {
    const sessionError = Object.assign(
      new Error('refresh unavailable while offline'),
      { code: 'session_missing_or_expired', status: 401 },
    );
    mockedSupabase.auth.getSession.mockRejectedValue(sessionError);
    const operation = {
      id: 'service-session-op',
      actorId: 'actor-a',
      groupId: 'group-a',
      entityType: 'itinerary' as const,
      entityId: 'group-a',
      entityVersion: 0,
      operationType: 'reorder_destinations' as const,
      payload: { updates: [] },
      status: 'pending' as const,
      attempts: 0,
      nextAttemptAt: 1_000,
      conflictResult: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    };

    await expect(applyCoreOperation(operation)).rejects.toMatchObject({
      code: 'session_missing_or_expired',
    });
  });

  it('counts a server duplicate as terminal success without double applying', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    let applyCount = 0;
    const submit = jest.fn(async (operation: CoreOperation) => {
      applyCount += 1;
      return applyCount === 1
        ? accepted(operation)
        : { status: 'duplicate' as const, operationId: operation.id, entityVersion: 1 };
    });
    const queue = makeQueue(db, submit);
    const operation = await queue.enqueueMutation(mutation('group-a'));
    await queue.flush();
    await db.insert({ ...operation, status: 'pending', nextAttemptAt: 1_000 });
    expect((await queue.flush()).duplicates).toBe(1);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('keeps conflict drafts for explicit reapply and excludes them from local projection', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const queue = makeQueue(db, async (operation) => ({
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
        occurredAt: 1_000,
      },
    }));
    const operation = await queue.enqueueMutation({
      ...mutation('group-a'),
      operationType: 'add_destination',
      entityId: 'group-a',
      payload: {
        destinationId: 'local-place',
        title: 'Local draft',
        latitude: 25,
        longitude: 121,
        day: 1,
      },
    });
    const dependent = await queue.enqueueMutation({
      ...mutation('group-a'),
      operationType: 'edit_destination',
      entityId: 'group-a',
      payload: { destinationId: 'local-place', patch: { title: 'Edited draft' } },
    });
    await queue.flush();
    expect((await queue.listConflicts('group-a')).map((row) => row.id)).toEqual([operation.id]);

    const state = {
      group: { id: 'group-a' },
      destinations: [],
    } as unknown as GroupState;
    expect(projectPendingDestinations(state, await queue.listByGroup('group-a')).destinations).toEqual([]);

    const recreated = await queue.recreateConflict(operation.id);
    expect(recreated.id).not.toBe(operation.id);
    expect(recreated.entityVersion).toBe(4);
    expect(recreated.status).toBe('pending');
    expect(recreated.sequence).toBeGreaterThan(operation.sequence ?? 0);
    expect(recreated.dependencyIds).not.toContain(operation.id);
    expect(await queue.getOperation(operation.id)).toBeNull();
    expect(await queue.getOperation(dependent.id)).toBeNull();
  });

  it('discards a conflict dependency chain atomically and checks the current actor', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const actor = { value: 'actor-a' as string | null };
    const queue = makeQueue(db, async (operation) => ({
      status: 'conflict' as const,
      operationId: operation.id,
      conflict: {
        code: 'validation' as const,
        message: 'invalid draft',
        operationId: operation.id,
        entityType: operation.entityType,
        entityId: operation.entityId,
        occurredAt: 1_000,
      },
    }), actor);
    const root = await queue.enqueueMutation(mutation('group-a'));
    const dependent = await queue.enqueueMutation(mutation('group-a'));
    await queue.flush();

    actor.value = 'actor-b';
    await expect(queue.discardConflictChain(root.id)).rejects.toThrow('account_changed');
    actor.value = 'actor-a';
    const discarded = await queue.discardConflictChain(root.id);
    expect(discarded).toEqual(expect.arrayContaining([root.id, dependent.id]));
    expect(await queue.getOperation(root.id)).toBeNull();
    expect(await queue.getOperation(dependent.id)).toBeNull();
  });

  it('rolls back the local transaction when durable storage insert fails', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const coreDb = new MemoryCoreDataDatabase();
    await coreDb.putSnapshot({
      groupId: 'group-a',
      group: { id: 'group-a' } as never,
      destinations: [],
      members: [],
      subgroups: [],
      activeGathering: {
        groupId: 'group-a',
        journeyPhase: 'staying',
        activeDestinationId: null,
        pointStatuses: {},
        phaseChangedAt: 1_000,
        entityVersion: 0,
      },
      itineraryVersion: 0,
      entityVersion: 0,
      syncedAt: 1_000,
      updatedAt: 1_000,
      source: 'remote',
    });
    db.failNextInsert = true;
    const queue = makeQueue(db, async (operation) => accepted(operation), { value: 'actor-a' }, () => 1_000, coreDb);
    await expect(queue.enqueueMutation(mutation('group-a'))).rejects.toThrow(
      'forced outbox insert failure',
    );
    expect(await db.listAll()).toEqual([]);
    expect(db.sequences).toEqual(new Map());
    expect((await coreDb.getSnapshot('group-a'))?.itineraryVersion).toBe(0);
  });

  it('reserves the next predicted itinerary version across ACK and later enqueue', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const coreDb = new MemoryCoreDataDatabase();
    await coreDb.putSnapshot(snapshotForGroup() as never);
    const submit = jest.fn(async (operation: CoreOperation): Promise<ApplyCoreOperationResult> => ({
      status: 'accepted',
      operationId: operation.id,
      entityVersion: operation.entityVersion + 1,
      entity: { destinations: [], entityVersion: operation.entityVersion + 1 },
    }));
    const queue = makeQueue(db, submit, { value: 'actor-a' }, () => 1_000, coreDb);
    const applyLocal = async (exec: CoreSqlExecutor) => {
      const current = await coreDb.readSnapshotInTransaction(exec, 'group-a');
      if (!current) throw new Error('missing test snapshot');
      await coreDb.writeSnapshot(exec, {
        ...current,
        itineraryVersion: (current.itineraryVersion ?? 0) + 1,
        source: 'local_optimistic',
        updatedAt: 1_000,
      });
    };
    const base = {
      groupId: 'group-a',
      actorId: 'actor-a',
      entityType: 'itinerary' as const,
      entityId: 'group-a',
      operationType: 'add_destination' as const,
      payload: { destinationId: 'local-a', title: 'A' },
      applyLocal,
      flushImmediately: false,
    };
    const first = await queue.enqueueMutation({ ...base, entityVersion: 0 });
    const second = await queue.enqueueMutation({
      ...base,
      payload: { destinationId: 'local-b', title: 'B' },
      entityVersion: 1,
    });
    expect(first.entityVersion).toBe(0);
    expect(second.entityVersion).toBe(1);
    expect((await coreDb.getSnapshot('group-a'))?.itineraryVersion).toBe(2);

    expect((await queue.flush(1)).sent).toBe(1);
    expect((await coreDb.getSnapshot('group-a'))?.itineraryVersion).toBe(2);

    const third = await queue.enqueueMutation({
      ...base,
      payload: { destinationId: 'local-c', title: 'C' },
      entityVersion: 1,
    });
    expect(third.entityVersion).toBe(2);
    expect((await coreDb.getSnapshot('group-a'))?.itineraryVersion).toBe(3);
  });

  it('does not downgrade a pending itinerary prediction during remote hydrate', async () => {
    const coreDb = new MemoryCoreDataDatabase();
    await coreDb.putSnapshot(snapshotForGroup('group-a', 2) as never);
    const remoteState = groupStateFromCoreSnapshot(await coreDb.getSnapshot('group-a') as never);
    const store = createCoreDataStore(
      coreDb,
      () => 2_000,
      async () => false,
      async () => true,
    );
    const saved = await store.saveRemoteGroupState(remoteState, {
      entityVersion: 1,
      itineraryVersion: 1,
    });
    expect(saved.itineraryVersion).toBe(2);
    expect((await coreDb.getSnapshot('group-a'))?.itineraryVersion).toBe(2);
    expect((await coreDb.getSnapshot('group-a'))?.source).toBe('remote');
  });

  it('filters an optimistic snapshot owned by another actor before UI projection', async () => {
    const coreDb = new MemoryCoreDataDatabase();
    const actor = { value: 'actor-a' as string | null };
    await coreDb.putSnapshot(snapshotForGroup('group-a', 1, 'actor-a') as never);
    const store = createCoreDataStore(
      coreDb,
      Date.now,
      undefined,
      undefined,
      async () => actor.value,
    );
    expect(await store.readSnapshot('group-a')).toMatchObject({ ownerActorId: 'actor-a' });
    actor.value = 'actor-b';
    expect(await store.readSnapshot('group-a')).toBeNull();
  });

  it('rejects a reused operation id before applying a different local payload', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const coreDb = new MemoryCoreDataDatabase();
    let localApplications = 0;
    const queue = makeQueue(db, async (operation) => accepted(operation), { value: 'actor-a' }, () => 1_000, coreDb);
    const common = {
      operationId: 'fixed-operation-id',
      groupId: 'group-a',
      actorId: 'actor-a',
      entityType: 'itinerary' as const,
      entityId: 'group-a',
      entityVersion: 0,
      operationType: 'edit_destination' as const,
      applyLocal: async () => { localApplications += 1; },
      flushImmediately: false,
    };
    await queue.enqueueMutation({ ...common, payload: { destinationId: 'd', patch: { title: 'one' } } });
    await expect(queue.enqueueMutation({
      ...common,
      payload: { destinationId: 'd', patch: { title: 'two' } },
    })).rejects.toMatchObject({ code: 'operation_id_mismatch' });
    expect(localApplications).toBe(1);
    expect((await queue.getOperation('fixed-operation-id'))?.payload).toEqual({
      destinationId: 'd', patch: { title: 'one' },
    });
  });

  it('rewrites dependent entity ids and active gathering keys when a merge is acknowledged', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const coreDb = new MemoryCoreDataDatabase();
    await coreDb.putSnapshot({
      ...snapshotForGroup(),
      destinations: [{
        id: 'local-place', title: 'Local', order: 0, day: null,
        coordinates: { latitude: 25, longitude: 121 },
      }],
      activeGathering: {
        ...snapshotForGroup().activeGathering,
        activeDestinationId: 'local-place',
        pointStatuses: { 'local-place': 'en_route' },
      },
    } as never);
    const queue = makeQueue(db, async (operation) => operation.id === 'merge-root'
      ? {
          status: 'accepted' as const,
          operationId: operation.id,
          entityVersion: 1,
          entity: {
            entityVersion: 1,
            destinations: [{
              id: 'canonical-place', title: 'Remote', order: 0, day: null,
              coordinates: { latitude: 25, longitude: 121 },
            }],
          },
          effects: { destinationIdAliases: { 'local-place': 'canonical-place' } },
        }
      : accepted(operation), { value: 'actor-a' }, () => 1_000, coreDb);
    const root = await queue.enqueueMutation({
      operationId: 'merge-root', groupId: 'group-a', actorId: 'actor-a',
      entityType: 'itinerary', entityId: 'group-a', entityVersion: 0,
      operationType: 'add_destination', payload: { destinationId: 'local-place' },
      flushImmediately: false,
    });
    const dependent = await queue.enqueueMutation({
      groupId: 'group-a', actorId: 'actor-a', entityType: 'itinerary', entityId: 'group-a',
      entityVersion: 1, operationType: 'edit_destination',
      payload: { destinationId: 'local-place', patch: { title: 'Edited' } },
      flushImmediately: false,
    });
    expect(root.id).toBe('merge-root');
    await queue.flush(1);
    const rewritten = await queue.getOperation(dependent.id);
    expect(rewritten?.entityId).toBe('group-a');
    expect(rewritten?.payload.destinationId).toBe('canonical-place');
    const projected = await coreDb.getSnapshot('group-a');
    expect(projected?.destinations[0]?.id).toBe('canonical-place');
    expect(projected?.activeGathering.activeDestinationId).toBe('canonical-place');
    expect(projected?.activeGathering.pointStatuses).toEqual({ 'canonical-place': 'en_route' });
  });

  it('backs off server-busy errors instead of terminalizing the FIFO head', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const queue = makeQueue(db, async () => {
      throw Object.assign(new Error('serialization failure'), { code: '40001' });
    });
    const operation = await queue.enqueueMutation(mutation('group-a'));
    const result = await queue.flush();
    expect(result.conflicts).toBe(0);
    expect(result.retryScheduled).toBe(1);
    expect(await queue.getOperation(operation.id)).toMatchObject({ status: 'failed', conflictResult: null });
  });
});
