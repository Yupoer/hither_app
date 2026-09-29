jest.mock('../api/services/_helpers', () => ({ requireUserId: async () => 'current-user' }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: async () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'unused' }));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('../state/locationPrivacy', () => ({ captureLocationAccess: async () => ({ groupId: 'g' }), isLocationAccessCurrent: () => true }));
jest.mock('../api/services/LocationService', () => ({ ingestLocationBatch: jest.fn() }));

import { ingestLocationBatch } from '../api/services/LocationService';
import { flushLocationOutbox, SQLiteLocationOutboxDatabase, type LocationOutboxEntry } from '../state/locationOutbox';

test('public durable flush rejects unknown owners while uploading current account rows', async () => {
  const base = { groupId: 'g', navigationSessionId: null, capturedAt: Date.now(), coords: { latitude: 25, longitude: 121 }, trackingMode: 'foreground', source: 'foreground', sequence: 1, attempts: 0, nextAttemptAt: 0, expiresAt: Date.now() + 60_000 } as const;
  let rows: LocationOutboxEntry[] = [{ ...base, id: 'legacy' }, { ...base, id: 'owned', actorId: 'current-user' }];
  const proto = SQLiteLocationOutboxDatabase.prototype;
  jest.spyOn(proto, 'initialize').mockResolvedValue();
  jest.spyOn(proto, 'removeExpired').mockResolvedValue();
  jest.spyOn(proto, 'getDue').mockImplementation(async () => rows);
  jest.spyOn(proto, 'resolveBatch').mockImplementation(async ids => { rows = rows.filter(row => !ids.includes(row.id)); });
  jest.spyOn(proto, 'count').mockImplementation(async () => rows.length);
  jest.spyOn(proto, 'nextDue').mockResolvedValue(null);
  jest.mocked(ingestLocationBatch).mockResolvedValue({ acceptedIds: ['owned'], rejected: [] });
  expect(await flushLocationOutbox()).toMatchObject({ acceptedIds: ['owned'], sent: 1, discarded: 1, remaining: 0 });
  expect(ingestLocationBatch).toHaveBeenCalledWith([expect.objectContaining({ id: 'owned', actorId: 'current-user' })]);
  expect(rows).toEqual([]);
  jest.restoreAllMocks();
});
