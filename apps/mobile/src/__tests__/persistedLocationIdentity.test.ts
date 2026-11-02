jest.mock('../api/services/_helpers', () => ({
  requireUserId: async () => 'current-user', requireLocalActorId: async () => 'current-user',
  orThrow: (error: unknown) => { if (error) throw error; },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: async () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'unused' }));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('../state/locationPrivacy', () => ({ captureLocationAccess: async () => ({ groupId: 'g' }), isLocationAccessCurrent: () => true }));
jest.mock('../api/services/LocationService', () => ({ ingestLocationBatch: jest.fn() }));
jest.mock('../state/coreDataStore', () => {
  const actual = jest.requireActual('../state/coreDataStore');
  const sharedCoreDb = new actual.MemoryCoreDataDatabase();
  return { ...actual, sharedCoreDb, sharedCoreDataStore: actual.createCoreDataStore(sharedCoreDb) };
});
jest.mock('../state/coreOperationOutbox', () => {
  const actual = jest.requireActual('../state/coreOperationOutbox');
  return { ...actual, SQLiteCoreOperationOutboxDatabase: actual.MemoryCoreOperationOutboxDatabase };
});
const mockRpc = jest.fn(async (_name: string, input: { p_group_id: string; p_location_events: { id: string }[] }) => ({
  data: { coreResults: [], locationResult: { acceptedIds: input.p_location_events.map(event => event.id), rejected: [] },
    locationReceipts: [], pendingRefreshes: [], refreshAcknowledgements: [], refreshRequest: null, acknowledgedIds: [],
    snapshot: { group: { id: input.p_group_id, name: 'Team' }, daily_accommodations: [] } }, error: null,
}));
jest.mock('../api/supabase', () => ({ supabase: { rpc: (...args: Parameters<typeof mockRpc>) => mockRpc(...args) } }));

import { ingestLocationBatch } from '../api/services/LocationService';
import { flushLocationOutbox, SQLiteLocationOutboxDatabase, type LocationOutboxEntry } from '../state/locationOutbox';

test('public mixed flush retains unknown owners while uploading and settling current account rows', async () => {
  const base = { groupId: 'g', navigationSessionId: null, capturedAt: Date.now(), coords: { latitude: 25, longitude: 121 }, trackingMode: 'foreground', source: 'foreground', sequence: 1, attempts: 0, nextAttemptAt: 0, expiresAt: Date.now() + 60_000 } as const;
  const legacy = { ...base, id: 'legacy' };
  const owned: LocationOutboxEntry = { ...base, id: 'owned', actorId: 'current-user' };
  const { attempts: _attempts, nextAttemptAt: _nextAttemptAt, expiresAt: _expiresAt, ...ownedEvent } = owned;
  let rows: LocationOutboxEntry[] = [legacy, owned];
  const proto = SQLiteLocationOutboxDatabase.prototype;
  jest.spyOn(proto, 'initialize').mockResolvedValue();
  jest.spyOn(proto, 'removeExpired').mockResolvedValue();
  jest.spyOn(proto, 'getDue').mockImplementation(async () => rows);
  jest.spyOn(proto, 'resolveBatch').mockImplementation(async ids => { rows = rows.filter(row => !ids.includes(row.id)); });
  jest.spyOn(proto, 'count').mockImplementation(async (groupId, actorId) => rows.filter(row => !groupId
    || (row.groupId === groupId && row.actorId === actorId)).length);
  jest.spyOn(proto, 'nextDue').mockResolvedValue(null);
  try {
    expect(await flushLocationOutbox()).toMatchObject({ acceptedIds: ['owned'], sent: 1, discarded: 0, remaining: 0 });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('sync_group', {
      p_group_id: 'g', p_actor_id: 'current-user', p_core_operations: [], p_refresh: {},
      p_location_events: [ownedEvent],
    });
    expect(ingestLocationBatch).not.toHaveBeenCalled();
    expect(rows).toEqual([legacy]);
  } finally { jest.restoreAllMocks(); }
});
