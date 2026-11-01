import type { SQLiteDatabase } from 'expo-sqlite';
import type { LocationBatchEvent } from '../api/services/LocationService';
import type { LocationUploadEvent } from '../state/locationOutbox';

let mockSharingKey = '';
let mockReadCount = 0;
let mockFailReadAt = 0;
let mockReadFailures = 0;
const mockReceived: LocationBatchEvent[] = [];
const mockOpen = jest.fn();
const mockStorage = {
  getItem: jest.fn(async (key: string) => {
    if (key !== mockSharingKey) return null;
    mockReadCount += 1;
    if (mockReadCount === mockFailReadAt) {
      mockReadFailures += 1;
      throw new Error('preference storage temporarily unavailable');
    }
    return 'true';
  }),
  removeItem: jest.fn(async () => undefined),
};
const mockRpc = jest.fn((name: string, input: { p_events: LocationBatchEvent[] }) => {
  if (name !== 'ingest_location_batch') throw new Error('Unexpected RPC ' + name);
  return { abortSignal: async () => {
    mockReceived.push(...input.p_events);
    return { data: { acceptedIds: input.p_events.map(event => event.id), rejected: [] }, error: null };
  } };
});
jest.mock('@react-native-async-storage/async-storage', () => mockStorage);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: mockOpen }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: async () => ({ status: 'granted' }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000777' }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
jest.mock('../api/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token', expires_at: 4_000_000_000, user: { id: 'user-1' } } }, error: null }) },
  rpc: mockRpc,
} }));

type ProbeDatabase = Pick<SQLiteDatabase, 'getAllAsync' | 'closeAsync'>;
const { open } = jest.requireActual<{ open(path: string): ProbeDatabase }>('../../test/headless/sqlite.cjs');

it.each(['flush access', 'upload access'])('retains queued GPS through one failed preference read at %s and delivers the original event after recovery', async checkpoint => {
  jest.resetModules();
  jest.clearAllMocks();
  mockReadCount = 0;
  mockFailReadAt = 0;
  mockReadFailures = 0;
  mockReceived.length = 0;
  const database = open(':memory:');
  mockOpen.mockResolvedValue(database);
  let currentTime = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  const { configureDefaultAuthRecovery } = jest.requireActual<typeof import('../api/authRecovery')>('../api/authRecovery');
  const { supabase } = jest.requireMock<typeof import('../api/supabase')>('../api/supabase');
  configureDefaultAuthRecovery({
    getSession: () => supabase.auth.getSession(),
    refreshSession: () => supabase.auth.getSession(),
  });
  const privacy = jest.requireActual<typeof import('../state/locationPrivacy')>('../state/locationPrivacy');
  const outbox = jest.requireActual<typeof import('../state/locationOutbox')>('../state/locationOutbox');
  mockSharingKey = privacy.LOCATION_SHARING_KEY;
  const original: LocationUploadEvent = { actorId: 'user-1', id: '00000000-0000-4000-8000-000000000001',
    groupId: 'group-a', navigationSessionId: null, capturedAt: currentTime,
    coords: { latitude: 35.7148, longitude: 139.7967, accuracy: 5 },
    trackingMode: 'foreground', source: 'foreground', sequence: 1 };
  try {
    privacy.setLocationAccessContext(original.groupId, true, true);
    await outbox.enqueueLocationOutbox(original);
    mockFailReadAt = mockReadCount + (checkpoint === 'flush access' ? 1 : 2);
    const [failedFlush] = await Promise.allSettled([outbox.flushLocationOutbox()]);
    const rowsAfterFailure = await database.getAllAsync<{ id: string; captured_at: number; payload: string }>(
      'SELECT id, captured_at, payload FROM location_outbox');
    const receivedBeforeRecovery = [...mockReceived];
    currentTime += 5_000;
    const recoveredFlush = await outbox.flushLocationOutbox();
    const evidenceRoot = process.env.HITHER_LOCATION_ACCESS_PROBE_OUTPUT;
    if (evidenceRoot) {
      const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
      const path = jest.requireActual<typeof import('node:path')>('node:path');
      fs.writeFileSync(path.join(evidenceRoot, checkpoint.replace(' ', '-') + '.json'), JSON.stringify({ checkpoint,
        original, failedFlush, rowsAfterFailure, receivedBeforeRecovery, recoveredFlush, receivedAfterRecovery: mockReceived,
        readFailures: mockReadFailures }, null, 2) + '\n');
    }
    expect(mockReadFailures).toBe(1);
    expect(receivedBeforeRecovery).toEqual([]);
    expect(rowsAfterFailure).toEqual([expect.objectContaining({ id: original.id, captured_at: original.capturedAt })]);
    expect(JSON.parse(rowsAfterFailure[0].payload)).toEqual({ actorId: original.actorId, coords: original.coords,
      trackingMode: original.trackingMode, source: original.source });
    expect(recoveredFlush).toMatchObject({ sent: 1, acceptedIds: [original.id], discarded: 0, remaining: 0 });
    expect(mockReceived).toEqual([original]);
  } finally {
    await outbox.purgeLocationOutbox();
    await database.closeAsync();
    jest.restoreAllMocks();
  }
});
