jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'op-id' }));
jest.mock('../state/coreDataSync', () => ({}));
import { MemoryCoreDataDatabase } from '../state/coreDataStore';
import { createCoreOperationOutbox, MemoryCoreOperationOutboxDatabase } from '../state/coreOperationOutbox';
import { pendingSoloDestinationIds, projectArrivals } from '../state/arrivalSync';
import type { ApplyCoreOperationResult, CoreOperation } from '../types/coreData';

const payload = { actorId: 'self', userId: 'self', arrivedAt: '2026-09-12T01:00:00Z', completeSolo: true };
const accepted = (op: CoreOperation): ApplyCoreOperationResult => ({ status: 'accepted', operationId: op.id, entityVersion: 0 });

it('persists an offline solo arrival across a new queue instance, replays once, and keeps pending history distinct', async () => {
  const db = new MemoryCoreOperationOutboxDatabase();
  const core = new MemoryCoreDataDatabase();
  const offline = createCoreOperationOutbox(core, db, async () => { throw new Error('Network request failed'); }, () => 100);
  const first = await offline.enqueueArrival('group', 'stop', payload);
  expect((await offline.enqueueArrival('group', 'stop', payload)).id).toBe(first.id);
  await offline.flush();
  const rows = await offline.listByGroup('group');
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('failed');
  expect(pendingSoloDestinationIds(rows, 'self').has('stop')).toBe(true);
  expect(projectArrivals([], rows, 'self')).toHaveLength(1);
  expect(projectArrivals([], rows, 'another-account')).toHaveLength(0);
  const submit = jest.fn(async (op: CoreOperation) => accepted(op));
  const restarted = createCoreOperationOutbox(core, db, submit, () => 1_000_000);
  await restarted.flush();
  await restarted.flush();
  expect(submit).toHaveBeenCalledTimes(1);
  expect((await restarted.getOperation(first.id))?.status).toBe('acked');
  const projected = projectArrivals([], await restarted.listByGroup('group'), 'self');
  expect(projectArrivals(projected, await restarted.listByGroup('group'), 'self')).toHaveLength(1);
});

it('permanent rejection removes optimistic completion and never retries until explicit resubmission', async () => {
  const db = new MemoryCoreOperationOutboxDatabase();
  const submit = jest.fn(async (op: CoreOperation): Promise<ApplyCoreOperationResult> => ({
    status: 'conflict', operationId: op.id, conflict: {
      code: 'unauthorized', message: 'denied', operationId: op.id,
      entityType: op.entityType, entityId: op.entityId, occurredAt: 100,
    },
  }));
  const queue = createCoreOperationOutbox(new MemoryCoreDataDatabase(), db, submit);
  await queue.enqueueArrival('group', 'stop', payload);
  await queue.flush();
  await queue.flush();
  expect(submit).toHaveBeenCalledTimes(1);
  const rows = await queue.listByGroup('group');
  expect(projectArrivals([], rows, 'self')).toEqual([]);
  expect(pendingSoloDestinationIds(rows, 'self').size).toBe(0);
  await queue.enqueueArrival('group', 'stop', payload);
  await queue.flush();
  expect(submit).toHaveBeenCalledTimes(2);
});

it('personal arrival does not locally close a multi-person stop', async () => {
  const queue = createCoreOperationOutbox(new MemoryCoreDataDatabase(), new MemoryCoreOperationOutboxDatabase(), async op => accepted(op));
  await queue.enqueueArrival('group', 'stop', { ...payload, completeSolo: false });
  const rows = await queue.listByGroup('group');
  expect(projectArrivals([], rows, 'self')).toHaveLength(1);
  expect(pendingSoloDestinationIds(rows, 'self').size).toBe(0);
});
