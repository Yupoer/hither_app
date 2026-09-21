jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'generated-id') }));
jest.mock('../api/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    rpc: jest.fn(),
    from: jest.fn(),
    getLocalAuthActorId: jest.fn(async () => 'actor-a'),
  },
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
  it('allows a fresh same-resource intent after a retained terminal receipt', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const queue = makeQueue(db, async op => accepted(op));
    const first = await queue.enqueueMutation({ ...mutation('g'), entityType: 'active_gathering',
      operationType: 'start_gathering', payload: { activeDestinationId: 'a', navigationRequestId: 's' } });
    await db.update({ ...first, status: 'conflict', conflictResult: {
      code: 'unauthorized', message: 'role lost', operationId: first.id, entityId: first.entityId,
      entityType: first.entityType, occurredAt: 1,
    } });
    const next = await queue.enqueueMutation({ ...mutation('g'), entityType: 'active_gathering',
      operationType: 'start_gathering', payload: { activeDestinationId: 'a', navigationRequestId: 't' } });
    expect(next.dependencyIds).toEqual([]);
    expect((await queue.flush()).sent).toBe(1);
    expect(await queue.getOperation(next.id)).toBeNull();
  });

  it.each(['failed', 'conflict'] as const)('recovers an interleaved legacy session prerequisite (%s)', async status => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const submit = jest.fn(async (op: CoreOperation) => accepted(op));
    const queue = makeQueue(db, submit);
    const start = await queue.enqueueMutation({ ...mutation('g'), entityType: 'active_gathering',
      operationType: 'start_gathering', payload: { activeDestinationId: 'a', navigationRequestId: 's' } });
    const edit = await queue.enqueueMutation({ ...mutation('g'), operationType: 'edit_destination',
      payload: { destinationId: 'b', patch: { title: 'B' } } });
    const arrival = await queue.enqueueArrival('g', 'a', {
      actorId: 'actor-a', userId: 'actor-a', navigationSessionId: 's',
    });
    await db.update({ ...start, status, nextAttemptAt: 9_999,
      conflictResult: status === 'conflict' ? { code: 'unauthorized', message: 'role changed',
        operationId: start.id, entityId: start.entityId, entityType: start.entityType, occurredAt: 1 } : null });
    await db.update({ ...edit, dependencyIds: [start.id] });
    await db.update({ ...arrival, dependencyIds: [edit.id] });
    expect((await queue.flush()).sent).toBe(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].id).toBe(edit.id);
    expect(await queue.getOperation(arrival.id)).toMatchObject({
      status: status === 'conflict' ? 'conflict' : 'pending', dependencyIds: [edit.id], attempts: 0,
    });
  });

  it('does not inherit a legacy unrelated FIFO failure', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const queue = makeQueue(db, async op => accepted(op));
    const a = await queue.enqueueMutation({ ...mutation('g'), operationType: 'edit_destination', payload: { destinationId: 'a', patch: {} } });
    const b = await queue.enqueueMutation({ ...mutation('g'), operationType: 'add_destination', payload: { destinationId: 'b' } });
    await db.update({ ...a, status: 'conflict', conflictResult: { code: 'validation', message: 'deleted',
      operationId: a.id, entityId: a.entityId, entityType: a.entityType, occurredAt: 1 } });
    await db.update({ ...b, dependencyIds: [a.id] });
    expect((await queue.flush()).sent).toBe(1);
    expect(await queue.getOperation(b.id)).toBeNull();
  });

  it('holds an offline arrival until its session creation is accepted', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const queue = makeQueue(db, async op => { if (op.operationType === 'start_gathering') throw new Error('offline'); return accepted(op); });
    const start = await queue.enqueueMutation({ ...mutation('g'), entityType: 'active_gathering', operationType: 'start_gathering',
      payload: { activeDestinationId: 'a', navigationRequestId: 'local-session' } });
    const arrival = await queue.enqueueArrival('g', 'a', { actorId: 'actor-a', userId: 'actor-a', navigationSessionId: 'local-session' });
    expect(arrival.dependencyIds).toContain(start.id);
    expect((await queue.flush()).sent).toBe(0);
    expect(await queue.getOperation(arrival.id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('lets an unrelated arrival and destination pass a backed-off destination edit', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const calls: string[] = [];
    const queue = makeQueue(db, async operation => {
      calls.push(operation.id);
      if (operation.payload.destinationId === 'a') throw new Error('offline');
      return accepted(operation);
    });
    await queue.enqueueMutation({ ...mutation('g'), operationType: 'edit_destination', payload: { destinationId: 'a', patch: { title: 'A' } } });
    const other = await queue.enqueueMutation({ ...mutation('g'), operationType: 'edit_destination', payload: { destinationId: 'b', patch: { title: 'B' } } });
    const arrival = await queue.enqueueArrival('g', 'a', { actorId: 'actor-a', userId: 'actor-a', navigationSessionId: 'session' });
    expect(other.dependencyIds ?? []).toEqual([]);
    expect(arrival.dependencyIds ?? []).toEqual([]);
    const result = await queue.flush();
    expect(result.sent).toBe(2);
    expect(result.retryScheduled).toBe(1);
    expect(calls).toHaveLength(3);
  });

  it('recovers a persisted stale conflict using the original UUID and payload', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const submit = jest.fn(async (op: CoreOperation) => accepted(op));
    const queue = makeQueue(db, submit);
    const op = await queue.enqueueMutation(mutation('g'));
    await db.update({ ...op, status: 'conflict', nextAttemptAt: Number.MAX_SAFE_INTEGER,
      conflictResult: { code: 'stale_version', message: 'old v2 conflict', operationId: op.id,
        entityType: op.entityType, entityId: op.entityId, occurredAt: 1 } });
    expect((await queue.flush()).sent).toBe(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ id: op.id, payload: op.payload, entityVersion: op.entityVersion }));
  });

  it('settles causal descendants after rejection while independent work continues', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const queue = makeQueue(db, async op => op.payload.destinationId === 'a'
      ? { status: 'conflict', operationId: op.id, conflict: { code: 'unauthorized', message: 'role changed',
        operationId: op.id, entityType: op.entityType, entityId: op.entityId, occurredAt: 1 } }
      : accepted(op));
    const root = await queue.enqueueMutation({ ...mutation('g'), operationType: 'add_destination', payload: { destinationId: 'a' } });
    const child = await queue.enqueueMutation({ ...mutation('g'), operationType: 'edit_destination', payload: { destinationId: 'a', patch: {} } });
    const other = await queue.enqueueMutation({ ...mutation('g'), operationType: 'add_destination', payload: { destinationId: 'b' } });
    await queue.flush();
    expect(await queue.getOperation(root.id)).toMatchObject({ status: 'conflict' });
    expect(await queue.getOperation(child.id)).toMatchObject({ status: 'conflict' });
    expect(await queue.getOperation(other.id)).toBeNull();
  });

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

  it('automatically retries stale drafts with the same identity and preserves their optimistic projection', async () => {
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
    expect(await queue.listConflicts('group-a')).toEqual([]);
    expect(await queue.getOperation(operation.id)).toMatchObject({ status: 'failed', id: operation.id });

    const state = {
      group: { id: 'group-a' },
      destinations: [],
    } as unknown as GroupState;
    expect(projectPendingDestinations(state, await queue.listByGroup('group-a')).destinations).toEqual([expect.objectContaining({ id: 'local-place', title: 'Edited draft' })]);

    expect(await queue.getOperation(dependent.id)).toMatchObject({ status: 'pending', dependencyIds: [operation.id] });
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

  it('scopes pending guards to the current actor', async () => {
    const db = new MemoryCoreOperationOutboxDatabase();
    const actor = { value: 'actor-a' };
    const queue = makeQueue(db, async operation => accepted(operation), actor);

    await queue.enqueueMutation({
      ...mutation('group-a', 'actor-a'),
      entityType: 'active_gathering',
      operationType: 'start_gathering',
      payload: { activeDestinationId: 'destination-a', navigationRequestId: 'session-a' },
    });
    await queue.enqueueMutation({
      ...mutation('group-a', 'actor-a'),
      operationType: 'edit_destination',
      payload: { destinationId: 'destination-a', patch: { title: 'local' } },
    });

    actor.value = 'actor-b';
    expect(await queue.hasPendingGathering('group-a')).toBe(false);
    expect(await queue.hasPendingItinerary('group-a')).toBe(false);
    actor.value = 'actor-a';
    expect(await queue.hasPendingGathering('group-a')).toBe(true);
    expect(await queue.hasPendingItinerary('group-a')).toBe(true);
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
    expect(await store.getActiveGathering('group-a')).toMatchObject({ groupId: 'group-a' });
    actor.value = 'actor-b';
    expect(await store.readSnapshot('group-a')).toBeNull();
    expect(await store.getActiveGathering('group-a')).toBeNull();
  });

  it('does not preserve another actor\'s pending gathering during remote hydrate', async () => {
    const coreDb = new MemoryCoreDataDatabase();
    const actor = { value: 'actor-a' as string | null };
    const local = snapshotForGroup('group-a', 1, 'actor-a') as any;
    local.activeGathering = {
      ...local.activeGathering,
      journeyPhase: 'en_route',
      activeDestinationId: 'destination-a',
      pointStatuses: { 'destination-a': 'en_route' },
      entityVersion: 1,
    };
    await coreDb.putSnapshot(local);
    const hydrated = groupStateFromCoreSnapshot(local);
    const remoteState = {
      ...hydrated,
      group: { ...hydrated.group, journeyStatus: 'paused' as const, activeDestinationId: undefined },
    };
    const store = createCoreDataStore(
      coreDb,
      () => 2_000,
      async () => true,
      async () => false,
      async () => actor.value,
    );

    actor.value = 'actor-b';
    const saved = await store.saveRemoteGroupState(remoteState, {
      entityVersion: 0,
      gatheringVersion: 0,
    });

    expect(saved.ownerActorId).toBe('actor-b');
    expect(saved.source).toBe('remote');
    expect(saved.activeGathering.journeyPhase).toBe('staying');
    expect(saved.activeGathering.activeDestinationId).toBeNull();
    expect(saved.activeGathering.entityVersion).toBe(0);
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

it('persists new local commands and reads receipts while an earlier network request hangs', async () => {
  const db = new MemoryCoreOperationOutboxDatabase();
  let release!: (value: ApplyCoreOperationResult) => void;
  let entered!: () => void;
  const submitting = new Promise<void>(resolve => { entered = resolve; });
  const queue = makeQueue(db, () => { entered(); return new Promise(resolve => { release = resolve; }); });
  const first = await queue.enqueueMutation({ ...mutation('group-a'), operationId: 'first' });
  const flushing = queue.flush();
  await submitting;
  // This awaits only SQLite, never the network promise above.
  const second = await queue.enqueueMutation({ ...mutation('group-a'), operationId: 'second' });
  expect(second.id).toBe('second');
  const end = await queue.enqueueGatheringTransition({ groupId: 'group-a', operationId: 'end', action: 'end',
    baseState: { groupId: 'group-a', journeyPhase: 'en_route', activeDestinationId: 'point',
      pointStatuses: { point: 'en_route' }, phaseChangedAt: 0, entityVersion: 1 } });
  expect(end.local.journeyPhase).toBe('staying');
  expect((await queue.listByGroup('group-a')).map(op => op.id)).toEqual(['first', 'second', 'end']);
  release(accepted(first));
  await flushing;
});

it('rolls back a terminal transport rejection using local history while preserving independent additions', async () => {
  const db = new MemoryCoreOperationOutboxDatabase();
  const coreDb = new MemoryCoreDataDatabase();
  await coreDb.putSnapshot(snapshotForGroup() as any);
  const queue = makeQueue(db, async () => { throw Object.assign(new Error('limit'), { code: 'P0004' }); }, undefined, undefined, coreDb);
  const destination = { id: 'rejected', title: 'rejected', order: 0, day: null, coordinates: { latitude: 25, longitude: 121 } };
  await queue.enqueueMutation({ ...mutation('group-a'), operationType: 'add_destination', payload: { destinationId: destination.id },
    applyLocal: async (exec) => {
      const snapshot = (await coreDb.readSnapshotInTransaction(exec, 'group-a'))!;
      await coreDb.writeSnapshot(exec, { ...snapshot, destinations: [destination] });
    },
  });
  const current = (await coreDb.getSnapshot('group-a'))!;
  await coreDb.putSnapshot({ ...current, destinations: [...current.destinations, { ...destination, id: 'independent' }] });
  await queue.flush();
  expect((await coreDb.getSnapshot('group-a'))!.destinations.map(item => item.id)).toEqual(['independent']);
});
