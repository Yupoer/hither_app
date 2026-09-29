jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../api/supabase', () => ({ supabase: {} }));
import { createCoreOperationOutbox, MemoryCoreOperationOutboxDatabase } from '../state/coreOperationOutbox';
import { MemoryCoreDataDatabase } from '../state/coreDataStore';
import { projectArrivals, pendingSoloDestinationIds } from '../state/arrivalSync';
import type { CoreOperation } from '../types/coreData';

function setup() {
  let next = 0;
  const database = new MemoryCoreOperationOutboxDatabase();
  const queue = createCoreOperationOutbox(new MemoryCoreDataDatabase(), database,
    async op => ({ status: 'accepted', operationId: op.id, entityVersion: 1 }),
    () => 1000, () => `arrival-${++next}`, async () => 'me');
  const add = (arrived = true, session = 'session-1') => queue.enqueueArrival('g', 'd', {
    actorId: 'me', userId: 'me', arrived, navigationSessionId: session,
    arrivedAt: '2026-09-19T09:00:00Z', completeSolo: arrived,
  });
  return { database, queue, add };
}

it('preserves arrival undo arrival as three ordered intents, only deduplicating adjacent identical intent', async () => {
  const { add, queue } = setup();
  const first = await add();
  const undo = await add(false);
  const last = await add();
  expect(new Set([first.id, undo.id, last.id]).size).toBe(3);
  expect((await add()).id).toBe(last.id);
  expect((await queue.listByGroup('g')).map(op => op.id)).toEqual([first.id, undo.id, last.id]);
});

it('does not deduplicate arrivals from a new navigation session or reuse a terminal conflict UUID', async () => {
  const { add, database } = setup();
  const first = await add();
  const revisit = await add(true, 'session-2');
  expect(revisit.id).not.toBe(first.id);
  await database.update({ ...revisit, status: 'conflict', conflictResult: {
    code: 'invalid_transition', message: 'old session ended', operationId: revisit.id,
    entityId: 'd', entityType: 'itinerary', occurredAt: 1000,
  } });
  expect((await add(true, 'session-2')).id).not.toBe(revisit.id);
});

it('projects the latest ordered undo, including pending solo completion, without changing another actor', () => {
  const op = (sequence: number, arrived: boolean): CoreOperation => ({
    id: `op-${sequence}`, groupId: 'g', actorId: 'me', entityType: 'itinerary', entityId: 'd',
    entityVersion: 0, operationType: 'record_arrival', status: 'pending', attempts: 0,
    nextAttemptAt: 0, conflictResult: null, createdAt: 0, updatedAt: 0, sequence,
    payload: { actorId: 'me', userId: 'me', arrived, completeSolo: arrived, arrivedAt: 'time' },
  });
  const arrival = op(1, true), undo = op(2, false), revisit = op(3, true);
  expect(projectArrivals([], [undo, arrival], 'me')).toEqual([]);
  expect(pendingSoloDestinationIds([undo, arrival], 'me').size).toBe(0);
  expect(projectArrivals([], [revisit, undo, arrival], 'me')).toHaveLength(1);
  expect(pendingSoloDestinationIds([revisit, undo, arrival], 'me').has('d')).toBe(true);
  expect(projectArrivals([], [arrival], 'other')).toEqual([]);
});

it('keeps another account draft untouched without starving the signed-in account queue', async () => {
  let actor = 'a';
  let sequence = 0;
  const submit = jest.fn(async (op: CoreOperation) => ({
    status: 'accepted' as const, operationId: op.id, entityVersion: 1,
  }));
  const queue = createCoreOperationOutbox(new MemoryCoreDataDatabase(), new MemoryCoreOperationOutboxDatabase(),
    submit, () => 1000, () => `actor-op-${++sequence}`, async () => actor);
  const a = await queue.enqueueArrival('g', 'd', { actorId: 'a', userId: 'a', arrived: true });
  actor = 'b';
  const b = await queue.enqueueArrival('g', 'd', { actorId: 'b', userId: 'b', arrived: true });
  const result = await queue.flush(1);
  expect(submit.mock.calls.map(([op]) => op.id)).toEqual([b.id]);
  expect(result.remaining).toBe(0);
  expect((await queue.getOperation(a.id))?.status).toBe('pending');
});

it('bounds ID collision recovery without hanging or replacing a different durable intent', async () => {
  const factory = jest.fn(() => 'same-id');
  const queue = createCoreOperationOutbox(new MemoryCoreDataDatabase(), new MemoryCoreOperationOutboxDatabase(),
    async op => ({ status: 'accepted', operationId: op.id, entityVersion: 1 }), () => 1000, factory, async () => 'me');
  await queue.enqueueArrival('g', 'd', { actorId: 'me', userId: 'me', arrived: true });
  await expect(queue.enqueueArrival('g', 'd', { actorId: 'me', userId: 'me', arrived: false }))
    .rejects.toMatchObject({ code: 'operation_id_collision' });
  expect(factory).toHaveBeenCalledTimes(5);
  expect(await queue.listByGroup('g')).toHaveLength(1);
});
