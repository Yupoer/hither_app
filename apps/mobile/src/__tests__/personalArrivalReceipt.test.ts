jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'receipt' }));
jest.mock('../state/coreDataSync', () => ({}));
import { MemoryCoreDataDatabase } from '../state/coreDataStore';
import { createCoreOperationOutbox, MemoryCoreOperationOutboxDatabase } from '../state/coreOperationOutbox';
import { personalArrivalEvent, personalArrivalEventTimeMs, projectArrivals, projectPersonalArrivals } from '../state/arrivalSync';
import type { ApplyCoreOperationResult, CoreOperation } from '../types/coreData';

const payload = { actorId: 'me', userId: 'me', navigationSessionId: 'original-session',
  arrivedAt: '2026-10-06T01:00:00Z', occurredAt: '2026-10-06T01:00:00Z', completeSolo: false };
const reject = jest.fn(async (op: CoreOperation): Promise<ApplyCoreOperationResult> => ({
  status: 'conflict', operationId: op.id,
  conflict: { code: 'unauthorized', message: 'membership revoked', operationId: op.id,
    entityType: op.entityType, entityId: op.entityId, occurredAt: 100 },
}));

it('retains a rejected receipt across worker restart without retrying or counting team arrival', async () => {
  reject.mockClear();
  const db = new MemoryCoreOperationOutboxDatabase(), core = new MemoryCoreDataDatabase();
  const queue = createCoreOperationOutbox(core, db, reject, () => 100, () => 'saved-event', async () => 'me');
  const receipt = await queue.enqueueArrival('group', 'stop', payload);
  await queue.flush();
  const restarted = createCoreOperationOutbox(core, db, reject, () => 1_000_000, () => 'another', async () => 'me');
  await restarted.flush();
  const rows = await restarted.listByGroup('group');
  expect(reject).toHaveBeenCalledTimes(1);
  expect(rows).toEqual([expect.objectContaining({ id: receipt.id, status: 'conflict', payload })]);
  expect(projectPersonalArrivals([], rows, 'me', 'original-session')).toEqual([
    expect.objectContaining({ id: receipt.id, userId: 'me', arrivedAt: payload.arrivedAt, navigationSessionId: 'original-session' }),
  ]);
  expect(projectArrivals([], rows, 'me', 'original-session')).toEqual([]);
  expect(projectPersonalArrivals([], rows, 'other', 'original-session')).toEqual([]);
  expect(projectPersonalArrivals([], rows, 'me', 'new-session')).toEqual([]);
  expect(projectPersonalArrivals([], [{ ...rows[0], actorId: 'other' }], 'me', 'original-session')).toEqual([]);
});

it('keeps arrival/undo/re-entry ordered by durable sequence when the device clock moves backwards', async () => {
  const db = new MemoryCoreOperationOutboxDatabase(); let id = 0;
  const queue = createCoreOperationOutbox(new MemoryCoreDataDatabase(), db, reject, () => 100, () => `receipt-${++id}`, async () => 'me');
  await queue.enqueueArrival('group', 'stop', payload);
  await queue.enqueueArrival('group', 'stop', { ...payload, arrived: false, occurredAt: '2026-10-06T00:00:00Z' });
  let rows = await queue.listByGroup('group');
  const terminal = rows.map(op => ({ ...op, status: 'conflict' as const }));
  expect(projectPersonalArrivals([], terminal.reverse(), 'me', 'original-session')).toEqual([]);
  await queue.enqueueArrival('group', 'stop', { ...payload, occurredAt: '2026-10-05T23:00:00Z' });
  rows = await queue.listByGroup('group');
  expect(rows).toHaveLength(3);
  expect(projectPersonalArrivals([], rows.reverse(), 'me', 'original-session')).toHaveLength(1);
});

it('does not preserve a terminal leader correction against another member', () => {
  const correction = { id: 'correction', groupId: 'group', actorId: 'me', entityId: 'stop',
    operationType: 'leader_correct_arrival', status: 'conflict', sequence: 1,
    entityType: 'itinerary', entityVersion: 1, createdAt: 100, updatedAt: 100,
    attempts: 1, nextAttemptAt: 100, conflictResult: null,
    payload: { ...payload, targetUserId: 'another-member', source: 'leader_correction' } } as CoreOperation;
  expect(projectPersonalArrivals([], [correction], 'me', 'original-session')).toEqual([]);
});

it('rejects failed local persistence before exposing a personal receipt', async () => {
  const db = new MemoryCoreOperationOutboxDatabase();
  jest.spyOn(db, 'writeInsert').mockRejectedValueOnce(new Error('disk_full'));
  const submit = jest.fn();
  const queue = createCoreOperationOutbox(new MemoryCoreDataDatabase(), db, submit, () => 100, () => 'unsaved', async () => 'me');
  await expect(queue.enqueueArrival('group', 'stop', payload)).rejects.toThrow('disk_full');
  const rows = await queue.listByGroup('group');
  expect(rows).toEqual([]);
  expect(projectPersonalArrivals([], rows, 'me', 'original-session')).toEqual([]);
  expect(submit).not.toHaveBeenCalled();
});

it('native personal authority uses durable arrival and undo times without inventing an ordinary false event', async () => {
  const queue = createCoreOperationOutbox(new MemoryCoreDataDatabase(), new MemoryCoreOperationOutboxDatabase(), reject,
    () => 100, (() => { let id = 0; return () => `native-${++id}`; })(), async () => 'me');
  expect(personalArrivalEventTimeMs([], [], 'me', 'stop', 'original-session')).toBeUndefined();
  await queue.enqueueArrival('group', 'stop', payload);
  let rows = (await queue.listByGroup('group')).map(row => ({ ...row, status: 'conflict' as const }));
  expect(personalArrivalEventTimeMs([], rows, 'me', 'stop', 'original-session')).toBe(Date.parse(payload.occurredAt));
  await queue.enqueueArrival('group', 'stop', { ...payload, arrived: false, occurredAt: '2026-10-06T00:00:00Z' });
  rows = (await queue.listByGroup('group')).map(row => ({ ...row, status: 'conflict' as const }));
  expect(projectPersonalArrivals([], rows, 'me', 'original-session')).toEqual([]);
  expect(personalArrivalEventTimeMs([], rows, 'me', 'stop', 'original-session')).toBe(Date.parse('2026-10-06T00:00:00Z'));
  expect(personalArrivalEvent([], rows, 'me', 'stop', 'original-session')).toEqual({
    atMs: Date.parse('2026-10-06T00:00:00Z'), sequence: 2,
  });
  expect(personalArrivalEventTimeMs([], rows, 'me', 'stop', 'new-session')).toBeUndefined();
  expect(personalArrivalEventTimeMs([], rows, 'other', 'stop', 'original-session')).toBeUndefined();
  const remote = [{ id: 'remote', groupId: 'group', destinationId: 'stop', userId: 'me', arrivedAt: payload.arrivedAt,
    source: 'manual' as const, markedBy: 'me', navigationSessionId: 'original-session' }];
  expect(personalArrivalEventTimeMs(remote, [], 'me', 'stop', 'original-session')).toBe(Date.parse(payload.arrivedAt));
  expect(personalArrivalEvent(remote, [], 'me', 'stop', 'original-session')).toEqual({ atMs: Date.parse(payload.arrivedAt) });
});
