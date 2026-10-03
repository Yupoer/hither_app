jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => `uuid-${Math.random()}`) }));
const mockTransport: jest.Mock = jest.fn(async (_op: unknown) => { throw new Error('offline'); });
const mockActor = jest.fn(async () => 'actor-a');
const mockHarness: { coreDb: any; outboxDb: any } = { coreDb: null, outboxDb: null };
jest.mock('../api/services/CoreDataService', () => ({
  applyCoreOperation: (op: unknown) => mockTransport(op), fetchCoreEntityVersions: async () => [],
}));
jest.mock('../api/services/_helpers', () => ({ requireLocalActorId: () => mockActor(), orThrow: (error: unknown) => { if (error) throw error; } }));
jest.mock('../state/coreDataStore', () => {
  const actual = jest.requireActual('../state/coreDataStore');
  const coreDb = new actual.MemoryCoreDataDatabase();
  const store = actual.createCoreDataStore(coreDb);
  mockHarness.coreDb = coreDb;
  return { ...actual, sharedCoreDb: coreDb, sharedCoreDataStore: store,
    getCoreActiveGathering: (groupId: string) => store.getActiveGathering(groupId) };
});
jest.mock('../state/coreOperationOutbox', () => {
  const actual = jest.requireActual('../state/coreOperationOutbox');
  class MemoryOutbox extends actual.MemoryCoreOperationOutboxDatabase {
    constructor() { super(); mockHarness.outboxDb = this; }
  }
  return { ...actual, SQLiteCoreOperationOutboxDatabase: MemoryOutbox };
});
jest.mock('../api/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../api/demo', () => ({ isDemoGroup: (id: string) => id === 'demo' }));

import { setSolo } from '../api/services/GroupService';
import { supabase } from '../api/supabase';
import { enqueueSolo, getCoreDataStore, getCoreOperationOutbox } from '../state/coreDataSync';
import { projectOperationGroupState } from '../state/coreOperationProjection';
import { operationWirePayload } from '../state/itineraryRollback';
import type { GroupState } from '../types';
const state: GroupState = {
  group: { id: 'g', name: 'Trip', inviteCode: 'TRIP', createdBy: 'actor-a', journeyStatus: 'going',
    activeDestinationId: undefined, stragglerAlerts: false, stragglerThresholdM: 200 },
  members: [{ userId: 'actor-a', name: 'Member', role: 'follower', status: 'active', solo: false }],
  subgroups: [], destinations: [],
};
beforeEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  mockHarness.coreDb.snapshots.clear(); mockHarness.coreDb.gatherings.clear();
  mockHarness.outboxDb.operations.clear(); mockHarness.outboxDb.sequences.clear();
  mockActor.mockResolvedValue('actor-a'); mockTransport.mockRejectedValue(new Error('offline'));
  await getCoreDataStore().saveRemoteGroupState(state); jest.clearAllMocks();
});
it('durably switches Solo offline and restores the status after a cold snapshot read', async () => {
  await setSolo('g', true);
  expect(supabase.rpc).not.toHaveBeenCalled();
  expect((await getCoreDataStore().readSnapshot('g'))?.members?.[0].solo).toBe(true);
  const pending = await getCoreOperationOutbox().listOpenByGroup('g');
  expect(pending).toEqual([expect.objectContaining({ actorId: 'actor-a', operationType: 'set_solo', payload: { userId: 'actor-a', solo: true, _localBeforeSolo: false } })]);
  expect(projectOperationGroupState(state, pending).members[0].solo).toBe(true);
  expect(operationWirePayload(pending[0].payload)).toEqual({ userId: 'actor-a', solo: true });
});
it('keeps rapid Solo changes ordered and projects the latest saved intent', async () => {
  await Promise.all([enqueueSolo({ groupId: 'g', solo: true }), enqueueSolo({ groupId: 'g', solo: false })]);
  const pending = await getCoreOperationOutbox().listOpenByGroup('g');
  expect(pending.map(op => op.payload._localBeforeSolo)).toEqual([false, true]);
  expect(pending[1].dependencyIds).toContain(pending[0].id);
  expect(projectOperationGroupState(state, pending).members[0].solo).toBe(false);
});
it('does not save an intent or status when local storage rejects the transaction', async () => {
  const original = mockHarness.coreDb.writeSnapshot;
  mockHarness.coreDb.writeSnapshot = jest.fn(async () => { throw new Error('SQLITE_FULL'); });
  try {
    await expect(setSolo('g', true)).rejects.toThrow('SQLITE_FULL');
    expect((await getCoreDataStore().readSnapshot('g'))?.members?.[0].solo).toBe(false);
    expect(await getCoreOperationOutbox().listOpenByGroup('g')).toEqual([]);
  } finally { mockHarness.coreDb.writeSnapshot = original; }
});
it('refuses to project another account status through the current queue', async () => {
  await expect(enqueueSolo({ groupId: 'g', solo: true, actorId: 'actor-b' })).rejects.toThrow('group_membership_required');
  expect(await getCoreOperationOutbox().listOpenByGroup('g')).toEqual([]);
});

async function makePendingDue() {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const op of mockHarness.outboxDb.operations.values()) op.nextAttemptAt = 0;
}
it('replays the same Solo UUID after reconnect and removes it only after its receipt', async () => {
  await setSolo('g', true); await makePendingDue();
  const pending = (await getCoreOperationOutbox().listOpenByGroup('g'))[0];
  mockTransport.mockImplementation(async (op: any) => ({ status: 'accepted', operationId: op.id, entityVersion: 1,
    entity: { userId: op.actorId, solo: op.payload.solo } }));
  expect(await getCoreOperationOutbox().flush()).toMatchObject({ sent: 1, remaining: 0 });
  expect(mockTransport).toHaveBeenLastCalledWith(expect.objectContaining({ id: pending.id, operationType: 'set_solo' }));
  expect((await getCoreDataStore().readSnapshot('g'))?.members?.[0].solo).toBe(true);
});
it('rolls back a definitive Solo rejection while retaining a diagnostic receipt', async () => {
  await setSolo('g', true); await makePendingDue();
  mockTransport.mockImplementation(async (op: any) => ({ status: 'conflict', operationId: op.id,
    conflict: { operationId: op.id, code: 'unauthorized', message: 'membership removed' } }));
  await getCoreOperationOutbox().flush();
  expect((await getCoreDataStore().readSnapshot('g'))?.members?.[0].solo).toBe(false);
  expect(await getCoreOperationOutbox().listConflicts('g')).toEqual([expect.objectContaining({ operationType: 'set_solo' })]);
});
it('keeps a newer Solo choice visible while an earlier receipt is accepted', async () => {
  await setSolo('g', true); await setSolo('g', false); await makePendingDue();
  mockTransport.mockImplementationOnce(async (op: any) => ({ status: 'accepted', operationId: op.id, entityVersion: 1,
    entity: { userId: op.actorId, solo: true } }));
  expect(await getCoreOperationOutbox().flush()).toMatchObject({ sent: 1, remaining: 1 });
  expect((await getCoreDataStore().readSnapshot('g'))?.members?.[0].solo).toBe(false);
  expect(await getCoreOperationOutbox().listOpenByGroup('g')).toEqual([expect.objectContaining({ payload: expect.objectContaining({ solo: false }) })]);
});
