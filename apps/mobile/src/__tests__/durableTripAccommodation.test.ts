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

import { supabase } from '../api/supabase';
import { setDailyAccommodation, clearDailyAccommodation, listDailyAccommodations,
  getDailyAccommodationForDate, setAccommodationAutoAdd, mapDailyAccommodation } from '../api/services/DailyAccommodationService';
import { updateGroupTripDetails } from '../api/services/GroupService';
import { createCoreDataStore, groupStateFromCoreSnapshot, snapshotPayloadOf } from '../state/coreDataStore';
import { enqueueTripDetails, enqueueDailyAccommodation, enqueueDestinationAdd, enqueueDestinationDelete, enqueueDestinationComplete,
  enqueueLeaderGatheringStart, flushCoreOperationOutbox, getCoreDataStore, getCoreOperationOutbox, projectPendingDestinations } from '../state/coreDataSync';
import { projectOperationGroupState } from '../state/coreOperationProjection';
import { rollbackTripAndStays } from '../state/itineraryRollback';
import type { GroupState } from '../types';

const state: GroupState = {
  group: { id: 'g', name: 'Trip', inviteCode: 'TRIP', createdBy: 'actor-a', journeyStatus: 'going',
    activeDestinationId: 'd', stragglerAlerts: false, stragglerThresholdM: 200, tripDays: 1, departureDate: '2026-10-01' },
  members: [{ userId: 'actor-a', name: 'Leader', role: 'leader', status: 'active' }], subgroups: [],
  destinations: [{ id: 'd', title: 'Hotel', day: 1, order: 0, kind: 'accommodation', stayAnchor: true,
    coordinates: { latitude: 25, longitude: 121 } }], dailyAccommodations: [],
};
const daily = { id: 'stay', groupId: 'g', stayDate: '2026-10-01', title: 'Hotel', coordinates: { latitude: 25, longitude: 121 } };

it('replaces open rows copied from the previous daily stay while preserving unrelated and completed stays', async () => {
  const oldStay = { ...daily, sourceDestinationId: 'd' };
  await getCoreDataStore().saveRemoteGroupState({ ...state, group: { ...state.group, activeDestinationId: 'other-stop' }, dailyAccommodations: [oldStay], destinations: [
    ...state.destinations,
    { ...state.destinations[0], id: 'independent', title: 'Other hotel', order: 1 },
    { ...state.destinations[0], id: 'closed', closedAt: '2026-10-01T10:00:00Z', order: 2 },
    { ...state.destinations[0], id: 'tomorrow', day: 2, order: 3 },
  ] });
  await setDailyAccommodation('g', daily.stayDate, { title: 'New hotel',
    address: 'New address', coordinates: { latitude: 25.1, longitude: 121.1 }, day: 1 });
  const saved = (await getCoreDataStore().readSnapshot('g'))!;
  expect(saved.destinations[0]).toMatchObject({ id: 'd', title: 'New hotel', address: 'New address',
    coordinates: { latitude: 25.1, longitude: 121.1 }, stayAnchor: false });
  expect(saved.destinations.slice(1).map(d => d.title)).toEqual(['Other hotel', 'Hotel', 'Hotel']);
});

it('preserves the immutable active hotel target when replacing the daily stay', async () => {
  await getCoreDataStore().saveRemoteGroupState({ ...state, dailyAccommodations: [daily] });
  await setDailyAccommodation('g', daily.stayDate, { title: 'New hotel',
    coordinates: { latitude: 25.1, longitude: 121.1 }, day: 1 });
  const saved = (await getCoreDataStore().readSnapshot('g'))!;
  expect(saved.destinations[0]).toMatchObject({ id: 'd', title: 'Hotel', coordinates: { latitude: 25, longitude: 121 } });
  expect(saved.group.activeDestinationId).toBe('d');
  expect(saved.dailyAccommodations![0].title).toBe('New hotel');
});

it('protects an authoritative active gathering target when its legacy group pointer differs', async () => {
  await getCoreDataStore().saveRemoteGroupState({ ...state, dailyAccommodations: [daily] });
  const before = (await getCoreDataStore().readSnapshot('g'))!;
  await mockHarness.coreDb.putSnapshot({ ...before, group: { ...before.group, activeDestinationId: 'other-stop' } });
  await setDailyAccommodation('g', daily.stayDate, { title: 'New hotel',
    coordinates: { latitude: 25.1, longitude: 121.1 }, day: 1 });
  const saved = (await getCoreDataStore().readSnapshot('g'))!;
  expect(saved.activeGathering.activeDestinationId).toBe('d');
  expect(saved.destinations[0]).toMatchObject({ id: 'd', title: 'Hotel', coordinates: { latitude: 25, longitude: 121 } });
  expect(saved.dailyAccommodations![0].title).toBe('New hotel');
});

beforeEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  mockHarness.coreDb.snapshots.clear(); mockHarness.coreDb.gatherings.clear();
  mockHarness.outboxDb.operations.clear(); mockHarness.outboxDb.sequences.clear();
  mockActor.mockResolvedValue('actor-a');
  mockTransport.mockRejectedValue(new Error('offline'));
  await getCoreDataStore().saveRemoteGroupState(state);
  jest.clearAllMocks();
});

it('durably saves trip and stay edits offline without an RPC prerequisite and restores snapshot fields', async () => {
  await updateGroupTripDetails('g', 3, '2026-11-01');
  const result = await setDailyAccommodation('g', daily.stayDate, { ...daily, day: 1 });
  expect(result).toMatchObject({ daily: { title: 'Hotel' }, autoAdded: false });
  expect(supabase.from).not.toHaveBeenCalled(); expect(supabase.rpc).not.toHaveBeenCalled();
  let saved = (await getCoreDataStore().readSnapshot('g'))!;
  expect(saved.group.tripDays).toBe(3);
  expect(saved.dailyAccommodations).toHaveLength(1);
  expect(groupStateFromCoreSnapshot(saved).dailyAccommodations).toHaveLength(1);
  expect(JSON.parse(snapshotPayloadOf(saved)).dailyAccommodations).toHaveLength(1);
  await clearDailyAccommodation('g', daily.stayDate, 1);
  saved = (await getCoreDataStore().readSnapshot('g'))!;
  expect(saved.dailyAccommodations).toEqual([]);
  expect(saved.destinations[0].stayAnchor).toBe(false);
  expect((await getCoreOperationOutbox().listOpenByGroup('g')).map(op => op.operationType))
    .toEqual(['set_trip_details', 'set_daily_accommodation', 'clear_daily_accommodation']);
});

it('reuses an existing stay identity and keeps demo writes local', async () => {
  await enqueueDailyAccommodation({ groupId: 'g', stayDate: daily.stayDate, daily });
  expect((await setDailyAccommodation('g', daily.stayDate, daily)).daily.id).toBe('stay');
  expect((await setDailyAccommodation('demo', daily.stayDate, daily)).daily.id).toBe(`demo-daily-${daily.stayDate}`);
  await clearDailyAccommodation('demo', daily.stayDate);
  await updateGroupTripDetails('demo', 3, '2026-11-01');
});

it('maps authoritative stays and handles batch/date reads including demo, empty and error', async () => {
  const row = { id: 'stay', group_id: 'g', stay_date: '2026-10-01T00:00:00Z', title: 'Hotel', address: null,
    latitude: 25, longitude: 121, source_destination_id: null };
  const query = (data: unknown, error: unknown = null) => {
    const builder: any = {};
    for (const method of ['select', 'eq', 'order', 'maybeSingle']) builder[method] = jest.fn(() => builder);
    builder.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve);
    return builder;
  };
  (supabase.from as jest.Mock).mockReturnValueOnce(query([row])).mockReturnValueOnce(query(row))
    .mockReturnValueOnce(query(null)).mockReturnValueOnce(query(null))
    .mockReturnValueOnce(query(null, new Error('read failed')));
  expect(await listDailyAccommodations('g')).toEqual([expect.objectContaining(daily)]);
  expect(await getDailyAccommodationForDate('g', daily.stayDate)).toMatchObject(daily);
  expect(await listDailyAccommodations('g')).toEqual([]);
  expect(await getDailyAccommodationForDate('g', daily.stayDate)).toBeNull();
  await expect(listDailyAccommodations('g')).rejects.toThrow('read failed');
  expect(await listDailyAccommodations('demo')).toEqual([]);
  expect(await getDailyAccommodationForDate('demo', daily.stayDate)).toBeNull();
  expect(mapDailyAccommodation({ ...row, stay_date: { toString: () => daily.stayDate } as unknown as string }).stayDate).toBe(daily.stayDate);
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
  await setAccommodationAutoAdd('g', false); await setAccommodationAutoAdd('demo', false);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
});

it('reports local storage failure without returning a saved result or making remote writes', async () => {
  const original = mockHarness.coreDb.writeSnapshot;
  const before = await getCoreDataStore().readSnapshot('g');
  mockHarness.coreDb.writeSnapshot = jest.fn(async () => { throw new Error('SQLITE_FULL'); });
  try {
    await expect(setDailyAccommodation('g', daily.stayDate, daily)).rejects.toThrow('SQLITE_FULL');
    await expect(updateGroupTripDetails('g', 3, '2026-11-01')).rejects.toThrow('SQLITE_FULL');
    expect(await getCoreDataStore().readSnapshot('g')).toEqual(before);
    expect(await getCoreOperationOutbox().listOpenByGroup('g')).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled(); expect(supabase.from).not.toHaveBeenCalled();
  } finally { mockHarness.coreDb.writeSnapshot = original; }
});

it('rejects invalid input and missing local snapshots before queueing', async () => {
  await expect(enqueueTripDetails({ groupId: 'g', tripDays: 0, departureDate: '2026-10-01' })).rejects.toThrow('invalid_trip_details');
  await expect(enqueueTripDetails({ groupId: 'g', tripDays: 1, departureDate: '2026-02-30' })).rejects.toThrow('invalid_trip_details');
  await expect(enqueueTripDetails({ groupId: 'missing', tripDays: 1, departureDate: '2026-10-01' })).rejects.toThrow('core_snapshot_missing');
  for (const patch of [{ title: '' }, { coordinates: { latitude: 91, longitude: 121 } }, { coordinates: { latitude: 25, longitude: Infinity } }]) {
    await expect(enqueueDailyAccommodation({ groupId: 'g', stayDate: daily.stayDate, daily: { ...daily, ...patch } })).rejects.toThrow('invalid_daily_accommodation');
  }
  await expect(enqueueDailyAccommodation({ groupId: 'g', stayDate: 'bad' })).rejects.toThrow('invalid_daily_accommodation');
  await expect(enqueueDailyAccommodation({ groupId: 'g', stayDate: daily.stayDate, day: 0 })).rejects.toThrow('invalid_daily_accommodation');
  await expect(enqueueDailyAccommodation({ groupId: 'missing', stayDate: daily.stayDate })).rejects.toThrow('core_snapshot_missing');
});

it('keeps pending trip and stays across remote refresh and reprojects them in sequence', async () => {
  await enqueueTripDetails({ groupId: 'g', tripDays: 4, departureDate: '2026-11-03' });
  await enqueueDailyAccommodation({ groupId: 'g', stayDate: daily.stayDate, daily });
  const store = createCoreDataStore(mockHarness.coreDb, Date.now, async () => false,
    () => getCoreOperationOutbox().getPendingItineraryOperations('g'));
  await store.saveRemoteGroupState(state);
  expect((await store.readSnapshot('g'))?.group.tripDays).toBe(4);
  expect((await store.readSnapshot('g'))?.dailyAccommodations).toEqual([daily]);
  const open = await getCoreOperationOutbox().listOpenByGroup('g');
  const projected = projectPendingDestinations(state, [...open].reverse());
  expect(projected.group.departureDate).toBe('2026-11-03'); expect(projected.dailyAccommodations).toEqual([daily]);
  expect(projectOperationGroupState(projected, [{ ...open[1], operationType: 'clear_daily_accommodation', sequence: 3 }]).dailyAccommodations).toEqual([]);
  expect(projectOperationGroupState(state, [{ ...open[0], status: 'acked' }]).group.tripDays).toBe(1);
  const clear = { ...open[1], operationType: 'clear_daily_accommodation' as const, sequence: 3 };
  const laterAnchor = { ...open[1], operationType: 'edit_destination' as const, sequence: 4,
    payload: { destinationId: 'd', patch: { stayAnchor: true } } };
  expect(projectOperationGroupState(projected, [laterAnchor, clear]).destinations[0].stayAnchor).toBe(true);
});

it('accepts remote trip/stay changes while unrelated itinerary work waits and ignores another actor drafts', async () => {
  await getCoreDataStore().saveRemoteGroupState({ ...state, dailyAccommodations: [daily] });
  await enqueueDestinationAdd({ groupId: 'g', title: 'New stop', latitude: 25, longitude: 121, day: 1 });
  const pending = await getCoreOperationOutbox().getPendingItineraryOperations('g');
  const foreign = { ...pending[0], actorId: 'actor-b', operationType: 'set_trip_details' as const,
    payload: { tripDays: 30, departureDate: '2026-12-01' } };
  const store = createCoreDataStore(mockHarness.coreDb, Date.now, async () => false,
    async () => [...pending, foreign], async () => 'actor-a');
  const remote = { ...state, group: { ...state.group, tripDays: 9, departureDate: '2026-11-01' }, dailyAccommodations: [] };
  await store.saveRemoteGroupState(remote);
  expect((await store.readSnapshot('g'))?.group.tripDays).toBe(9);
  expect((await store.readSnapshot('g'))?.group.departureDate).toBe('2026-11-01');
  expect((await store.readSnapshot('g'))?.dailyAccommodations).toEqual([]);
});

it('atomically clears the active gathering when deleting its destination', async () => {
  await enqueueDestinationDelete({ groupId: 'g', destinationId: 'd' });
  const saved = (await getCoreDataStore().readSnapshot('g'))!;
  expect(saved.activeGathering.activeDestinationId).toBeNull();
  expect(saved.group.activeDestinationId).toBeUndefined();
  expect(saved.group.journeyStatus).toBe('paused'); expect(saved.destinations).toEqual([]);
  expect((await mockHarness.coreDb.getActiveGathering('g')).activeDestinationId).toBeNull();
});

it.each([false, true])('rejected active delete restores only its own gathering changes (later start=%s)', async (laterStart) => {
  await getCoreDataStore().saveRemoteGroupState({ ...state, destinations: [...state.destinations,
    { ...state.destinations[0], id: 'd2', order: 1, kind: 'stop' }] });
  let rejectDelete: (() => void) | undefined;
  mockTransport.mockImplementation((op: any) => op.operationType === 'delete_destination'
    ? new Promise(resolve => { rejectDelete = () => resolve({ status: 'conflict', operationId: op.id,
      conflict: { code: 'unauthorized', message: 'leader changed', operationId: op.id,
        entityType: op.entityType, entityId: op.entityId, occurredAt: Date.now() } }); })
    : Promise.reject(new Error('offline')));
  await enqueueDestinationDelete({ groupId: 'g', destinationId: 'd', sessionId: 'old-session' });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(rejectDelete).toBeDefined();
  if (laterStart) await enqueueLeaderGatheringStart('g', { activeDestinationId: 'd2',
    navigationRequestId: 'new-session', flushImmediately: false });
  const groupBeforeReject = (await getCoreDataStore().readSnapshot('g'))!.group;
  rejectDelete!();
  await flushCoreOperationOutbox();
  const restored = (await getCoreDataStore().readSnapshot('g'))!;
  expect(restored.destinations.some(destination => destination.id === 'd')).toBe(true);
  expect(restored.activeGathering.activeDestinationId).toBe(laterStart ? 'd2' : 'd');
  if (laterStart) expect(restored.group).toEqual(groupBeforeReject);
  const displayed = groupStateFromCoreSnapshot(restored);
  expect(displayed.group.activeDestinationId).toBe(laterStart ? 'd2' : 'd');
  expect(displayed.group.journeyStatus).toBe('going');
});

it('does not complete stale or already completed local destinations', async () => {
  expect(await enqueueDestinationComplete({ groupId: 'g', destinationId: 'd', isCurrent: () => false })).toBeNull();
  const first = await enqueueDestinationComplete({ groupId: 'g', destinationId: 'd', sessionId: 'session', subgroupId: null, isCurrent: () => true });
  expect(first?.payload.subgroupId).toBeNull();
  expect(await enqueueDestinationComplete({ groupId: 'g', destinationId: 'd', sessionId: 'session' })).toBeNull();
});

it('rolls back rejected trip and stay edits without losing later changes', () => {
  const afterGroup = { ...state.group, tripDays: 4, departureDate: '2026-11-03' };
  const rollback = { before: [], after: [], beforeGroup: state.group, afterGroup,
    beforeDailyAccommodations: [], afterDailyAccommodations: [daily] };
  expect(rollbackTripAndStays({ group: afterGroup, dailyAccommodations: [daily] }, rollback))
    .toEqual({ group: state.group, dailyAccommodations: [] });
  const newer = { ...daily, title: 'Newer hotel' };
  const current = { group: { ...afterGroup, tripDays: 7 }, dailyAccommodations: [newer] };
  expect(rollbackTripAndStays(current, rollback)).toEqual({ ...current, group: { ...state.group, tripDays: 7 } });
  expect(rollbackTripAndStays(current, { before: [], after: [] })).toEqual(current);
  expect(rollbackTripAndStays({ group: state.group, dailyAccommodations: [] }, { before: [], after: [],
    beforeDailyAccommodations: [daily], afterDailyAccommodations: [] }).dailyAccommodations).toEqual([daily]);
});

it('persists a local date picker ISO as a calendar date before queuing offline trip details', async () => {
  await updateGroupTripDetails('g', 2, new Date(2026, 9, 3, 0).toISOString());
  expect((await getCoreDataStore().readSnapshot('g'))?.group.departureDate).toBe('2026-10-03');
  const operations = await getCoreOperationOutbox().listOpenByGroup('g');
  expect(operations[0]).toMatchObject({ operationType: 'set_trip_details', payload: { tripDays: 2, departureDate: '2026-10-03' } });
  expect(supabase.rpc).not.toHaveBeenCalled();
});
