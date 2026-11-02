import { syncGroup, subscribeGroupSyncSnapshots } from '../state/groupSync';
import { enqueueLocationOutbox, SQLiteLocationOutboxDatabase } from '../state/locationOutbox';
import { createCoreOperationOutbox, MemoryCoreOperationOutboxDatabase } from '../state/coreOperationOutbox';
import { MemoryCoreDataDatabase } from '../state/coreDataStore';
import { getHitherDatabase } from '../state/hitherDatabase';
import type { CoreOperation } from '../types/coreData';

jest.mock('expo-sqlite', () => {
  const { open } = jest.requireActual('../../test/headless/sqlite.cjs');
  return { openDatabaseAsync: jest.fn(async () => open(':memory:')) };
});
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: async () => null }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'background' } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
let mockActor = 'actor-a';
let mockQueue: import('../state/coreOperationOutbox').CoreOperationOutbox;
const mockExchange = jest.fn();
jest.mock('../api/services/_helpers', () => ({ requireUserId: async () => mockActor }));
jest.mock('../api/services/GroupSyncService', () => ({ exchangeGroup: (input: unknown) => mockExchange(input) }));
jest.mock('../api/services/LocationService', () => ({ ingestLocationBatch: jest.fn() }));
jest.mock('../state/coreDataSync', () => ({ getCoreOperationOutbox: () => mockQueue }));
jest.mock('../state/locationPrivacy', () => ({
  captureLocationAccess: async (groupId = 'group') => ({ groupId, userId: mockActor }),
  isLocationAccessCurrent: (access: { userId: string }) => access.userId === mockActor,
  isLocationAccessPending: () => false,
}));

let coreDb: MemoryCoreOperationOutboxDatabase;
const operation = (id: string, sequence: number): CoreOperation => ({
  id, actorId: 'actor-a', groupId: 'group', entityType: 'itinerary', entityId: 'group',
  entityVersion: 0, operationType: 'reorder_destinations', payload: { updates: [] }, sequence,
  dependencyIds: sequence === 2 ? ['core-1'] : [], status: 'pending', attempts: 0,
  nextAttemptAt: 0, createdAt: sequence, updatedAt: sequence, conflictResult: null,
});

beforeEach(async () => {
  mockActor = 'actor-a';
  mockExchange.mockReset();
  coreDb = new MemoryCoreOperationOutboxDatabase();
  mockQueue = createCoreOperationOutbox(new MemoryCoreDataDatabase(), coreDb,
    async () => { throw new Error('Unexpected individual core RPC'); }, Date.now, () => 'unused', async () => mockActor);
  await coreDb.insert(operation('core-1', 1));
  await coreDb.insert(operation('core-2', 2));
  await (await getHitherDatabase()).runAsync('DELETE FROM location_outbox');
  for (const [index, id] of ['gps-1', 'gps-2'].entries()) {
    await enqueueLocationOutbox({ id, actorId: 'actor-a', groupId: 'group', capturedAt: Date.now() + index,
      navigationSessionId: null, coords: { latitude: 25, longitude: 121 }, trackingMode: 'foreground',
      source: 'foreground', sequence: index + 1 });
  }
});

it.each([
  { name: 'account switch', failure: Object.assign(new Error('account_changed'), { code: '28000' }), switchActor: true },
  { name: 'lost mixed reply', failure: new Error('lost_reply'), switchActor: false },
])('preserves the original $name failure and every unacknowledged row', async ({ failure, switchActor }) => {
  const published = jest.fn();
  const unsubscribe = subscribeGroupSyncSnapshots(published);
  mockExchange.mockImplementation(async () => {
    if (switchActor) mockActor = 'actor-b';
    throw failure;
  });
  try {
    await expect(syncGroup({ groupId: 'group' })).rejects.toBe(failure);
    expect(mockExchange).toHaveBeenCalledTimes(1);
    expect(mockExchange.mock.calls[0][0]).toMatchObject({ actorId: 'actor-a',
      operations: [expect.objectContaining({ id: 'core-1' }), expect.objectContaining({ id: 'core-2' })],
      events: [expect.objectContaining({ id: 'gps-2' }), expect.objectContaining({ id: 'gps-1' })] });
    expect((await coreDb.listAll()).map(row => ({ id: row.id, actorId: row.actorId, payload: row.payload })))
      .toEqual(['core-1', 'core-2'].map(id => ({ id, actorId: 'actor-a', payload: { updates: [] } })));
    expect(await coreDb.get('core-1')).toMatchObject(switchActor
      ? { status: 'pending', attempts: 0 }
      : { status: 'failed', attempts: 1, lastError: 'lost_reply' });
    expect(await coreDb.get('core-2')).toMatchObject({ status: 'pending', attempts: 0 });
    expect((await new SQLiteLocationOutboxDatabase().getDue(Number.MAX_SAFE_INTEGER, 50))
      .map(row => ({ id: row.id, actorId: row.actorId })))
      .toEqual([{ id: 'gps-2', actorId: 'actor-a' }, { id: 'gps-1', actorId: 'actor-a' }]);
    expect(published).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});
