const mockRpc = jest.fn();
const mockActor = jest.fn(async () => 'actor');
const mockMapRecovery = jest.fn((value: unknown) => value);
jest.mock('../api/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock('../api/services/_helpers', () => ({ requireUserId: () => mockActor(), orThrow: (error: unknown) => { if (error) throw error; } }));
jest.mock('../api/services/GroupService', () => ({ mapGroupRecoverySnapshot: (value: unknown) => mockMapRecovery(value) }));
import { exchangeGroup } from '../api/services/GroupSyncService';
import type { CoreOperation } from '../types/coreData';
import type { LocationBatchEvent } from '../api/services/LocationService';
const operation = (id: string, sequence: number): CoreOperation => ({ id, actorId: 'actor', groupId: 'group',
  entityType: 'itinerary', entityId: 'group', entityVersion: 0, operationType: 'edit_destination',
  payload: { destinationId: 'target', patch: {} }, sequence, dependencyIds: sequence > 1 ? ['a'] : [],
  createdAt: 1_000, updatedAt: 1_000, status: 'pending', attempts: 0, nextAttemptAt: 1_000, conflictResult: null });
const event: LocationBatchEvent = { id: 'gps', actorId: 'actor', groupId: 'group', capturedAt: 1_000,
  navigationSessionId: null, coords: { latitude: 25, longitude: 121, accuracy: 5 },
  source: 'foreground', trackingMode: 'foreground', sequence: 1 };
function reply(overrides: Record<string, unknown> = {}) {
  return { data: { coreResults: [], locationResult: { acceptedIds: [], rejected: [] },
    locationReceipts: [], pendingRefreshes: [], refreshAcknowledgements: [], refreshRequest: null,
    acknowledgedIds: [], snapshot: {}, ...overrides }, error: null };
}
beforeEach(() => { mockRpc.mockReset(); mockMapRecovery.mockClear(); mockActor.mockResolvedValue('actor'); });
it('retains a collected draft owner when authentication returns to a different batch actor', async () => {
  const foreign = { ...operation('a', 1), actorId: 'actor-b' };
  await expect(exchangeGroup({ groupId: 'group', actorId: 'actor', operations: [foreign], events: [], refresh: {} }))
    .rejects.toMatchObject({ code: '28000', message: 'account_changed' });
  expect(mockRpc).not.toHaveBeenCalled();
});
it('sends heterogeneous core operations and GPS in one request and retains omitted operation results', async () => {
  mockRpc.mockResolvedValue(reply({ coreResults: [{ operation_id: 'a', status: 'accepted', entity_version: 1 }],
    locationResult: { acceptedIds: ['gps'], rejected: [] },
    locationReceipts: [{ id: 'gps', groupId: 'group', capturedAt: 1_000, receivedAt: '2026-11-02T00:00:00.123456Z' }] }));
  const operations = [operation('a', 1), { ...operation('b', 2), operationType: 'set_trip_details' as const,
    payload: { tripDays: 2, departureDate: '2026-11-02' } }];
  const result = await exchangeGroup({ groupId: 'group', actorId: 'actor', operations, events: [event], refresh: {} });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc.mock.calls[0][0]).toBe('sync_group');
  expect(mockRpc.mock.calls[0][1].p_core_operations.map((row: {operation_type:string}) => row.operation_type)).toEqual(['edit_destination','set_trip_details']);
  expect(mockRpc.mock.calls[0][1].p_location_events).toEqual([event]);
  expect(result.coreResults.has('b')).toBe(false);
  expect(result.locationResult.acceptedIds).toEqual(['gps']);
  expect(result.locationReceipts[0].receivedAt).toBe('2026-11-02T00:00:00.123456Z');
});
it('uses the same location receipt without interpreting the legacy server snapshot or sending another RPC', async () => {
  const receipt = { id: 'gps', groupId: 'group', capturedAt: 1_000, receivedAt: '2026-11-02T00:00:00.123456Z' };
  mockRpc.mockResolvedValue(reply({ locationResult: { acceptedIds: ['gps'], rejected: [] },
    locationReceipts: [receipt] }));
  const result = await exchangeGroup({ groupId: 'group', actorId: 'actor', operations: [], events: [event],
    refresh: {}, includeSnapshot: false });
  expect(result).toMatchObject({ kind: 'receipts', locationReceipts: [receipt] });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('sync_group', expect.objectContaining({ p_refresh: { includeSnapshot: false } }));
  expect(mockMapRecovery).not.toHaveBeenCalled();
});
it('shrinks an oversized suffix without pretending its GPS was submitted or ACKed', async () => {
  mockRpc.mockResolvedValue(reply());
  const oversized = { ...event, source: 'x'.repeat(270_000) };
  const result = await exchangeGroup({ groupId: 'group', actorId: 'actor', operations: [operation('a',1)], events: [oversized], refresh: {} });
  expect(mockRpc.mock.calls[0][1].p_location_events).toEqual([]);
  expect(result.locationResult.notSubmittedIds).toEqual(['gps']);
  expect(result.locationResult.acceptedIds).toEqual([]);
  expect(result.coreResults.has('a')).toBe(false);
});

it('pins the original actor through a lazy transport account switch and exposes the server pause error', async () => {
  mockRpc.mockImplementation(async (_name: string, args: { p_actor_id: string }) => {
    mockActor.mockResolvedValue('actor-b');
    expect(args.p_actor_id).toBe('actor');
    return { data: null, error: { code: '28000', message: 'account_changed' } };
  });
  await expect(exchangeGroup({ groupId: 'group', actorId: 'actor', operations: [operation('a',1)], events: [], refresh: {requestPeers:true} }))
    .rejects.toMatchObject({ code: '28000', message: 'account_changed' });
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
