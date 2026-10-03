import { ingestLocationBatch } from '../api/services/LocationService';
import { createLocationOutbox, SQLiteLocationOutboxDatabase, type LocationUploadEvent } from '../state/locationOutbox';
import { setLocationAccessContext } from '../state/locationPrivacy';
import type { SQLiteDatabase } from 'expo-sqlite';

jest.mock('react-native', () => ({ AppState: { currentState: 'background' } }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: async () => ({ status: 'granted' }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: async () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000777' }));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
const mockRpc = jest.fn();
const mockRequireUserId = jest.fn(async () => 'user-1');
jest.mock('../api/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock('../api/demo', () => ({ isDemoGroup: () => false, demoUpdateMyLocation: jest.fn() }));
jest.mock('../api/services/_helpers', () => ({
  requireUserId: () => mockRequireUserId(),
  orThrow: (error: { message: string } | null) => { if (error) throw new Error(error.message); },
}));

const capturedAt = 1791020129260.424;
const event = (overrides: Partial<LocationUploadEvent> = {}): LocationUploadEvent => ({
  id: '00000000-0000-4000-8000-000000000001', actorId: 'user-1', groupId: 'group-1',
  navigationSessionId: 'session-1', capturedAt,
  coords: { latitude: 35.685, longitude: 139.774, accuracy: 5, speed: 1, course: 90 },
  trackingMode: 'teamNavigation', source: 'background_task', sequence: capturedAt,
  ...overrides,
});

// Model the driver only. Queue normalization, SQLite row decoding, retry
// decisions, privacy/account checks, and RPC serialization are production code.
function sqliteFixture(seed: LocationUploadEvent[] = []) {
  type Row = {
    id: string; group_id: string; navigation_session_id: string | null;
    captured_at: number; payload: string; sequence: number;
    attempts: number; next_attempt_at: number; expires_at: number;
  };
  const rowOf = (item: LocationUploadEvent): Row => ({
    id: item.id, group_id: item.groupId, navigation_session_id: item.navigationSessionId,
    captured_at: item.capturedAt, sequence: item.sequence,
    payload: JSON.stringify({ actorId: item.actorId, coords: item.coords, trackingMode: item.trackingMode, source: item.source }),
    attempts: 0, next_attempt_at: capturedAt, expires_at: capturedAt + 86_400_000,
  });
  const rows = new Map(seed.map(item => [item.id, rowOf(item)]));
  const driver = {
    async runAsync(sql: string, ...args: any[]) {
      if (sql.startsWith('INSERT')) {
        const [id, group_id, navigation_session_id, captured_at, payload, sequence, attempts, next_attempt_at, expires_at] = args;
        if (!rows.has(id)) rows.set(id, { id, group_id, navigation_session_id, captured_at, payload, sequence, attempts, next_attempt_at, expires_at });
      } else if (sql.startsWith('UPDATE')) {
        const [attempts, next_attempt_at, id] = args;
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, attempts, next_attempt_at });
      } else if (sql.includes('expires_at')) {
        for (const row of rows.values()) if (row.expires_at <= args[0]) rows.delete(row.id);
      } else if (sql.includes('WHERE id')) {
        rows.delete(args[0]);
      } else {
        rows.clear();
      }
    },
    async getAllAsync(now: string, current: number, limit: number) {
      return [...rows.values()].filter(row => row.next_attempt_at <= current)
        .sort((a, b) => b.captured_at - a.captured_at || b.sequence - a.sequence).slice(0, limit);
    },
    async getFirstAsync(sql: string) {
      return sql.includes('COUNT') ? { count: rows.size } : { due: rows.size ? Math.min(...[...rows.values()].map(row => row.next_attempt_at)) : null };
    },
    async withTransactionAsync(operation: () => Promise<void>) { await operation(); },
  };
  const database = new SQLiteLocationOutboxDatabase(async () => driver as unknown as SQLiteDatabase);
  return { rows, database };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireUserId.mockResolvedValue('user-1');
  setLocationAccessContext('group-1', true, true);
  mockRpc.mockImplementation((_name: string, args: { p_events: LocationUploadEvent[] }) => ({
    abortSignal: jest.fn(async () => ({ data: { acceptedIds: args.p_events.map(item => item.id), rejected: [] }, error: null })),
  }));
});

it.each(['foreground', 'background_task'] as const)('sends %s sensor events through the real queue, row decoder and RPC serializer', async source => {
  const fixture = sqliteFixture();
  const outbox = createLocationOutbox(fixture.database, ingestLocationBatch, () => capturedAt + 1_000);
  if (source === 'foreground') {
    await outbox.enqueue({ actorId: 'user-1', groupId: 'group-1', id: event().id,
      capturedAt, coordinates: event().coords });
  } else {
    await outbox.enqueue(event());
  }
  expect(fixture.rows.get(event().id)?.sequence).toBe(1791020129260);
  await expect(outbox.flush()).resolves.toMatchObject({ sent: 1, discarded: 0, remaining: 0 });
  const wire = JSON.parse(JSON.stringify(mockRpc.mock.calls[0][1])).p_events[0];
  expect(wire).toMatchObject({ id: event().id, actorId: 'user-1', capturedAt, source, sequence: 1791020129260, coords: event().coords });
  expect(BigInt(String(wire.sequence))).toBe(1791020129260n);
  if (source === 'background_task') expect(wire.navigationSessionId).toBe('session-1');
  expect(fixture.rows.size).toBe(0);
});

it('repairs a previously persisted fractional row after an offline retry without changing the stable event ID or capture time', async () => {
  const fixture = sqliteFixture([event()]);
  let now = capturedAt + 1_000;
  const outbox = createLocationOutbox(fixture.database, ingestLocationBatch, () => now);
  mockRpc.mockImplementationOnce(() => ({ abortSignal: jest.fn(async () => { throw new Error('offline'); }) }));
  await expect(outbox.flush()).resolves.toMatchObject({ sent: 0, retryScheduled: 1, remaining: 1 });
  expect(fixture.rows.get(event().id)).toMatchObject({ attempts: 1, captured_at: capturedAt, sequence: capturedAt });
  await expect(outbox.flush()).resolves.toMatchObject({ sent: 0, retryScheduled: 0, remaining: 1 });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  now += 2_001;
  await expect(outbox.flush()).resolves.toMatchObject({ sent: 1, remaining: 0 });
  const attempts = mockRpc.mock.calls.map(call => JSON.parse(JSON.stringify(call[1])).p_events[0]);
  expect(attempts.map(item => item.id)).toEqual([event().id, event().id]);
  expect(attempts.map(item => item.sequence)).toEqual([1791020129260, 1791020129260]);
  expect(attempts.map(item => item.capturedAt)).toEqual([capturedAt, capturedAt]);
});

it.each(['previous-account', 'sharing-off', 'group-changed'] as const)('preserves the %s fence for pre-fix durable fractional rows', async fence => {
  const fixture = sqliteFixture([event(fence === 'previous-account' ? { actorId: 'old-user' } : {})]);
  const outbox = createLocationOutbox(fixture.database, ingestLocationBatch, () => capturedAt + 1_000);
  if (fence === 'sharing-off') setLocationAccessContext('group-1', false, true);
  if (fence === 'group-changed') setLocationAccessContext('group-2', true, true);
  await expect(outbox.flush()).resolves.toMatchObject({ sent: 0, discarded: 1, retryScheduled: 0, remaining: 0 });
  expect(mockRpc).not.toHaveBeenCalled();
});
