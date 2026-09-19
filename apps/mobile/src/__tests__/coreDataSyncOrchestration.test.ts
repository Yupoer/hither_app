/**
 * Production coreDataSync orchestration coverage.
 *
 * The public module is loaded with its real outbox/store factories. Only the
 * external SQLite, auth, crypto and transport boundaries are replaced so the
 * tests exercise the same enqueue, local projection and queue wiring used by
 * callers in the app.
 */

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

const mockApplyCoreOperation = jest.fn();
const mockFetchCoreEntityVersions = jest.fn();
const mockGetGroupRecoverySnapshot = jest.fn();
const mockRequireLocalActorId = jest.fn(async () => 'actor-a');
const mockHarness: {
  coreDb: any;
  store: any;
  outboxDb: any;
} = { coreDb: null, store: null, outboxDb: null };

jest.mock('../api/services/CoreDataService', () => ({
  applyCoreOperation: (operation: unknown) => mockApplyCoreOperation(operation),
  fetchCoreEntityVersions: (groupId: string) => mockFetchCoreEntityVersions(groupId),
}));

jest.mock('../api/services/GroupService', () => ({
  getGroupRecoverySnapshot: (groupId: string) => mockGetGroupRecoverySnapshot(groupId),
}));

jest.mock('../api/services/_helpers', () => ({
  requireLocalActorId: () => mockRequireLocalActorId(),
}));

jest.mock('../state/coreDataStore', () => {
  const actual = jest.requireActual('../state/coreDataStore');
  const coreDb = new actual.MemoryCoreDataDatabase();
  const store = actual.createCoreDataStore(coreDb, () => Date.now());
  mockHarness.coreDb = coreDb;
  mockHarness.store = store;
  return {
    ...actual,
    sharedCoreDb: coreDb,
    sharedCoreDataStore: store,
    getCoreActiveGathering: (groupId: string) => store.getActiveGathering(groupId),
  };
});

jest.mock('../state/coreOperationOutbox', () => {
  const actual = jest.requireActual('../state/coreOperationOutbox');
  class MemoryBackedSQLiteOutbox extends actual.MemoryCoreOperationOutboxDatabase {
    constructor() {
      super();
      mockHarness.outboxDb = this;
    }
  }
  return {
    ...actual,
    SQLiteCoreOperationOutboxDatabase: MemoryBackedSQLiteOutbox,
  };
});

import * as Crypto from 'expo-crypto';
import type { Destination, Group, GroupState } from '../types';
import type {
  ActiveGatheringState,
  CoreOperation,
  CoreOperationType,
} from '../types/coreData';
import {
  deriveActiveGatheringFromGroupState,
  startGathering,
} from '../utils/activeGatheringState';
import {
  createCoreDataStore,
  MemoryCoreDataDatabase,
} from '../state/coreDataStore';
import {
  MemoryCoreOperationOutboxDatabase,
} from '../state/coreOperationOutbox';
import {
  abortLeaderGatheringStart,
  enqueueDestinationAdd,
  enqueueDestinationComplete,
  enqueueDestinationDelete,
  enqueueDestinationEdit,
  enqueueDestinationMeetTime,
  enqueueDestinationReorder,
  enqueueGatherPointRequest,
  enqueueLeaderGatheringEnd,
  enqueueLeaderGatheringStart,
  enqueueLeaderGatheringSwitch,
  enqueuePersonalNavigationResponse,
  enqueueResolveGatherPointRequest,
  flushCoreOperationOutbox,
  getCoreDataStore,
  getCoreOperationOutbox,
  hydrateCoreEntityVersions,
  initializeCoreDataLayer,
  listOpenCoreOperations,
  projectOptimisticGathering,
  projectPendingDestinations,
  ensureCoreSnapshot,
} from '../state/coreDataSync';

const randomUUID = Crypto.randomUUID as jest.MockedFunction<typeof Crypto.randomUUID>;

function networkError(): Error & { code: string } {
  return Object.assign(new Error('network request failed'), { code: 'offline_transport' });
}

function makeGroup(id = 'group-1', overrides: Partial<Group> = {}): Group {
  return {
    id,
    name: 'Offline trip',
    inviteCode: 'ABC123',
    createdBy: 'leader-1',
    journeyStatus: 'paused',
    activeDestinationId: 'd1',
    stragglerAlerts: false,
    stragglerThresholdM: 200,
    ...overrides,
  };
}

function makeDestination(
  id: string,
  order: number,
  overrides: Partial<Destination> = {},
): Destination {
  return {
    id,
    title: `Stop ${id}`,
    order,
    day: 1,
    address: `${id} address`,
    coordinates: { latitude: 25 + order, longitude: 121 + order },
    kind: 'stop',
    ...overrides,
  };
}

function makeState(
  groupId = 'group-1',
  destinations: Destination[] = [makeDestination('d1', 0), makeDestination('d2', 1)],
  overrides: Partial<GroupState> = {},
): GroupState {
  return {
    group: makeGroup(groupId, { activeDestinationId: destinations[0]?.id, ...overrides.group }),
    members: [
      { userId: 'actor-a', name: 'Actor A', role: 'leader', status: 'active' },
    ],
    destinations,
    subgroups: [],
    nextDestination: destinations[0],
    ...overrides,
  };
}

function makeOperation(
  operationType: CoreOperationType,
  payload: Record<string, unknown>,
  overrides: Partial<CoreOperation> = {},
): CoreOperation {
  const createdAt = overrides.createdAt ?? 1_000;
  return {
    id: overrides.id ?? `operation-${operationType}`,
    actorId: 'actor-a',
    groupId: 'group-1',
    entityType: 'itinerary',
    entityId: 'group-1',
    entityVersion: overrides.entityVersion ?? 0,
    operationType,
    payload,
    sequence: overrides.sequence ?? 1,
    dependencyIds: [],
    createdAt,
    status: overrides.status ?? 'pending',
    attempts: 0,
    nextAttemptAt: createdAt,
    conflictResult: null,
    updatedAt: createdAt,
    ...overrides,
  };
}

function memoryCoreDb(): MemoryCoreDataDatabase {
  return mockHarness.coreDb as MemoryCoreDataDatabase;
}

function memoryOutboxDb(): MemoryCoreOperationOutboxDatabase {
  return mockHarness.outboxDb as MemoryCoreOperationOutboxDatabase;
}

async function drainTransport(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await flushCoreOperationOutbox().catch(() => undefined);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function seedSnapshot(
  state = makeState(),
  versions: { entityVersion?: number; itineraryVersion?: number; gatheringVersion?: number } = {},
) {
  return getCoreDataStore().saveRemoteGroupState(state, {
    entityVersion: versions.entityVersion ?? 3,
    itineraryVersion: versions.itineraryVersion ?? 10,
    gatheringVersion: versions.gatheringVersion ?? 3,
  });
}

beforeEach(async () => {
  await drainTransport();
  memoryCoreDb().snapshots.clear();
  memoryCoreDb().gatherings.clear();
  memoryCoreDb().navResponses.clear();
  memoryCoreDb().destinationAliases.clear();
  memoryOutboxDb().operations.clear();
  memoryOutboxDb().sequences.clear();

  mockApplyCoreOperation.mockReset();
  mockApplyCoreOperation.mockRejectedValue(networkError());
  mockFetchCoreEntityVersions.mockReset();
  mockFetchCoreEntityVersions.mockResolvedValue([]);
  mockGetGroupRecoverySnapshot.mockReset();
  mockRequireLocalActorId.mockReset();
  mockRequireLocalActorId.mockResolvedValue('actor-a');
  randomUUID.mockReset();
  let uuid = 0;
  randomUUID.mockImplementation(() => `generated-${++uuid}`);
  await initializeCoreDataLayer();
});

afterEach(async () => {
  await drainTransport();
});

describe('coreDataSync production orchestration', () => {
  it('hydrates a missing snapshot through the recovery boundary and fails closed', async () => {
    const recoveredState = makeState('cold-group', []);
    mockGetGroupRecoverySnapshot.mockResolvedValue({
      state: recoveredState,
      entityVersions: {
        'active_gathering:cold-group': 4,
        'itinerary:cold-group': 9,
      },
    });

    const recovered = await ensureCoreSnapshot('cold-group');
    expect(recovered).toMatchObject({
      groupId: 'cold-group',
      entityVersion: 4,
      itineraryVersion: 9,
      activeGathering: { entityVersion: 4 },
    });
    await expect(ensureCoreSnapshot('cold-group')).resolves.toBe(recovered);
    expect(mockGetGroupRecoverySnapshot).toHaveBeenCalledTimes(1);

    mockGetGroupRecoverySnapshot.mockRejectedValueOnce(new Error('recovery failed'));
    await expect(ensureCoreSnapshot('missing-group')).rejects.toThrow('recovery failed');
    await expect(enqueueDestinationAdd({
      groupId: 'missing-group',
      title: 'No local snapshot',
      latitude: 25,
      longitude: 121,
      actorId: 'actor-a',
    })).rejects.toMatchObject({ code: 'core_snapshot_missing' });
  });

  it('exposes the shared memory-backed store/outbox and hydrates independent versions', async () => {
    expect(getCoreDataStore().database).toBe(memoryCoreDb());
    expect(getCoreOperationOutbox()).toBeDefined();

    const state = makeState();
    mockFetchCoreEntityVersions.mockResolvedValue([
      {
        groupId: 'group-1',
        entityType: 'active_gathering',
        entityId: 'group-1',
        entityVersion: 7,
        state: {},
      },
      {
        groupId: 'group-1',
        entityType: 'itinerary',
        entityId: 'group-1',
        entityVersion: 12,
        state: {},
      },
    ]);

    await hydrateCoreEntityVersions('group-1', state);

    const saved = await getCoreDataStore().readSnapshot('group-1');
    expect(saved).toMatchObject({
      entityVersion: 7,
      itineraryVersion: 12,
      activeGathering: { entityVersion: 7 },
      source: 'remote',
    });
    expect(mockFetchCoreEntityVersions).toHaveBeenCalledWith('group-1');

    mockFetchCoreEntityVersions.mockRejectedValueOnce(new Error('temporary read failure'));
    await hydrateCoreEntityVersions('group-2', makeState('group-2'));
    expect((await getCoreDataStore().readSnapshot('group-2'))?.itineraryVersion).toBe(0);
  });

  it('enqueues CRUD operations with durable payloads, versions and local projection', async () => {
    const state = makeState('group-1', [
      makeDestination('d1', 0),
      makeDestination('d2', 1),
    ]);
    await seedSnapshot(state, { entityVersion: 3, itineraryVersion: 10, gatheringVersion: 3 });

    const added = await enqueueDestinationAdd({
      groupId: 'group-1',
      title: 'Unscheduled stop',
      address: 'New address',
      latitude: 24.9,
      longitude: 121.2,
      day: null,
      subgroupId: 'subgroup-1',
      providerPlaceId: 'provider-1',
      actorId: 'actor-a',
    });
    const edited = await enqueueDestinationEdit({
      groupId: 'group-1',
      destinationId: 'd1',
      patch: {
        title: 'Edited stop',
        address: 'Edited address',
        day: null,
        latitude: 24.5,
        longitude: 120.5,
      },
      actorId: 'actor-a',
    });
    const deleted = await enqueueDestinationDelete({
      groupId: 'group-1',
      destinationId: 'd2',
      actorId: 'actor-a',
    });
    const reordered = await enqueueDestinationReorder({
      groupId: 'group-1',
      updates: [
        { id: added.destinationId, position: 0, day: null, stayAnchor: true },
        { id: 'd1', position: 1, day: null, meetAt: '2026-09-19T12:00:00.000Z' },
      ],
      actorId: 'actor-a',
    });
    const meet = await enqueueDestinationMeetTime({
      destinationId: added.destinationId,
      groupId: 'group-1',
      meetAt: '2026-09-19T12:30:00.000Z',
      meetRedMinutes: 15,
      actorId: 'actor-a',
    });
    const completed = await enqueueDestinationComplete({
      groupId: 'group-1',
      destinationId: added.destinationId,
      sessionId: 'session-1',
      actorId: 'actor-a',
    });

    expect([added.operation, edited, deleted, reordered, meet, completed].map((op) => op?.entityVersion))
      .toEqual([10, 11, 12, 13, 14, 15]);
    expect(added.operation).toMatchObject({
      actorId: 'actor-a',
      entityType: 'itinerary',
      entityId: 'group-1',
      operationType: 'add_destination',
      payload: {
        destinationId: added.destinationId,
        day: null,
        providerPlaceId: 'provider-1',
      },
    });
    expect(edited.payload).toMatchObject({
      destinationId: 'd1',
      patch: { day: null, latitude: 24.5, longitude: 120.5 },
    });
    expect(meet.payload).toEqual({
      destinationId: added.destinationId,
      meetAt: '2026-09-19T12:30:00.000Z',
      meetRedMinutes: 15,
    });
    expect(completed.payload).toEqual({
      destinationId: added.destinationId,
      sessionId: 'session-1',
    });

    const snapshot = await getCoreDataStore().readSnapshot('group-1');
    const addedLocal = snapshot?.destinations.find((destination) => destination.id === added.destinationId);
    const editedLocal = snapshot?.destinations.find((destination) => destination.id === 'd1');
    expect(snapshot?.itineraryVersion).toBe(16);
    expect(snapshot?.destinations.some((destination) => destination.id === 'd2')).toBe(false);
    expect(addedLocal).toMatchObject({
      day: null,
      providerPlaceId: 'provider-1',
      meetAt: '2026-09-19T12:30:00.000Z',
      meetRedMinutes: 15,
      closedBySessionId: 'session-1',
      stayAnchor: true,
    });
    expect(editedLocal).toMatchObject({
      title: 'Edited stop',
      day: null,
      coordinates: { latitude: 24.5, longitude: 120.5 },
    });
    expect(snapshot?.activeGathering.pointStatuses[added.destinationId]).toBe('completed');

    const open = await listOpenCoreOperations('group-1');
    expect(open).toHaveLength(6);
    expect(open.map((operation) => operation.operationType)).toEqual([
      'add_destination',
      'edit_destination',
      'delete_destination',
      'reorder_destinations',
      'set_destination_meet_time',
      'complete_destination',
    ]);
    expect(mockApplyCoreOperation).toHaveBeenCalled();
  });

  it('does not throw the transport failure through a durable caller', async () => {
    await seedSnapshot();
    mockApplyCoreOperation.mockRejectedValue(networkError());

    await expect(enqueueDestinationAdd({
      groupId: 'group-1',
      title: 'Offline receipt',
      latitude: 25,
      longitude: 121,
      actorId: 'actor-a',
    })).resolves.toMatchObject({ operation: { operationType: 'add_destination' } });

    await drainTransport();
    const rows = await listOpenCoreOperations('group-1');
    expect(rows).toHaveLength(1);
    expect(['pending', 'failed', 'inflight']).toContain(rows[0].status);
    expect(rows[0].payload.title).toBe('Offline receipt');
  });

  it('applies accepted destination aliases to the local projection and alias table', async () => {
    await seedSnapshot(makeState('group-1', []), { itineraryVersion: 4 });
    mockApplyCoreOperation.mockImplementation(async (operation: CoreOperation) => ({
      status: 'accepted',
      operationId: operation.id,
      entityVersion: operation.entityVersion + 1,
      effects: {
        destinationIdAliases: {
          [String(operation.payload.destinationId)]: 'canonical-destination-1',
        },
      },
    }));

    const added = await enqueueDestinationAdd({
      groupId: 'group-1',
      title: 'Canonicalized stop',
      latitude: 25,
      longitude: 121,
      actorId: 'actor-a',
    });
    await drainTransport();

    const snapshot = await getCoreDataStore().readSnapshot('group-1');
    expect(snapshot?.destinations.map((destination) => destination.id)).toEqual([
      'canonical-destination-1',
    ]);
    expect(memoryCoreDb().destinationAliases.get(
      `group-1:${added.destinationId}`,
    )).toBe('canonical-destination-1');
    expect(await listOpenCoreOperations('group-1')).toHaveLength(0);
  });

  it('serializes concurrent adds without dropping either local destination', async () => {
    await seedSnapshot(makeState('group-1', []), { itineraryVersion: 20 });

    const [first, second] = await Promise.all([
      enqueueDestinationAdd({
        groupId: 'group-1',
        title: 'First concurrent stop',
        latitude: 25,
        longitude: 121,
        actorId: 'actor-a',
      }),
      enqueueDestinationAdd({
        groupId: 'group-1',
        title: 'Second concurrent stop',
        latitude: 26,
        longitude: 122,
        actorId: 'actor-a',
      }),
    ]);

    const snapshot = await getCoreDataStore().readSnapshot('group-1');
    expect(snapshot?.destinations.map((destination) => destination.id).sort()).toEqual(
      [first.destinationId, second.destinationId].sort(),
    );
    expect([first.operation.entityVersion, second.operation.entityVersion].sort((a, b) => a - b))
      .toEqual([20, 21]);
    expect((await listOpenCoreOperations('group-1'))).toHaveLength(2);
  });

  it('projects every pending itinerary operation, including null day and coordinates', () => {
    const base = makeState('group-1', [
      makeDestination('d1', 0),
      makeDestination('d2', 1),
    ]);
    const operations = [
      makeOperation('add_destination', {
        destinationId: 'd3',
        title: 'Added',
        address: 'Added address',
        latitude: 23,
        longitude: 120,
        day: 2,
        kind: 'accommodation',
      }, { id: 'op-add', sequence: 1 }),
      makeOperation('edit_destination', {
        destinationId: 'd1',
        patch: {
          title: 'Edited',
          address: 'Updated address',
          day: null,
          latitude: 22,
          longitude: 119,
          subgroupId: 'subgroup-1',
          kind: 'accommodation',
          stayAnchor: true,
        },
      }, { id: 'op-edit', sequence: 2 }),
      makeOperation('delete_destination', { destinationId: 'd2' }, { id: 'op-delete', sequence: 3 }),
      makeOperation('reorder_destinations', {
        updates: [
          { id: 'd1', position: 1, day: null },
          { id: 'd3', position: 0, day: 2 },
        ],
      }, { id: 'op-reorder', sequence: 4 }),
      makeOperation('set_destination_meet_time', {
        destinationId: 'd3',
        meetAt: '2026-09-19T13:00:00.000Z',
      }, { id: 'op-meet', sequence: 5 }),
      makeOperation('complete_destination', {
        destinationId: 'd1',
      }, { id: 'op-complete', sequence: 6, createdAt: 1_000 }),
    ];

    const projected = projectPendingDestinations(base, operations);
    expect(projected.destinations).toHaveLength(2);
    expect(projected.destinations.map((destination) => destination.id)).toEqual(['d3', 'd1']);
    expect(projected.destinations[0]).toMatchObject({
      title: 'Added',
      meetAt: '2026-09-19T13:00:00.000Z',
      day: 2,
    });
    expect(projected.destinations[1]).toMatchObject({
      title: 'Edited',
      address: 'Updated address',
      day: null,
      coordinates: { latitude: 22, longitude: 119 },
      subgroupId: 'subgroup-1',
      kind: 'accommodation',
      stayAnchor: true,
      closedAt: new Date(1_000).toISOString(),
    });
  });

  it('covers empty reorder and destination lookup without an explicit group', async () => {
    await seedSnapshot();
    await expect(enqueueDestinationReorder({ groupId: 'group-1', updates: [] })).resolves.toBeNull();

    const operation = await enqueueDestinationMeetTime({
      destinationId: 'd1',
      meetAt: null,
      meetRedMinutes: null,
      actorId: 'actor-a',
    });
    expect(operation.payload).toEqual({
      destinationId: 'd1',
      meetAt: null,
      meetRedMinutes: null,
    });
  });

  it('does not surface transport failures from default gathering auto-flush branches', async () => {
    await seedSnapshot();

    await expect(enqueueLeaderGatheringStart('group-1', {
      activeDestinationId: 'd1',
      actorId: 'actor-a',
      navigationRequestId: 'auto-start',
    })).resolves.toBeDefined();
    await expect(enqueueLeaderGatheringSwitch('group-1', {
      activeDestinationId: 'd2',
      actorId: 'actor-a',
      navigationRequestId: 'auto-switch',
    })).resolves.toBeDefined();
    await expect(enqueueLeaderGatheringEnd('group-1', {
      nextDestinationId: 'd2',
      actorId: 'actor-a',
    })).resolves.toBeDefined();

    await drainTransport();
    expect(mockApplyCoreOperation).toHaveBeenCalled();
  });

  it('runs the local-first gathering wrappers and preserves their payload/version contract', async () => {
    const state = makeState();
    await seedSnapshot(state, { entityVersion: 2, gatheringVersion: 2 });
    const base = deriveActiveGatheringFromGroupState(state, 2, 1_000);

    const started = await enqueueLeaderGatheringStart('group-1', {
      activeDestinationId: 'd1',
      actorId: 'actor-a',
      navigationRequestId: 'navigation-request-1',
      flushImmediately: false,
    });
    expect(started.local).toMatchObject({ journeyPhase: 'en_route', activeDestinationId: 'd1' });
    expect(started.local.entityVersion).toBe(base.entityVersion + 1);

    const switched = await enqueueLeaderGatheringSwitch('group-1', {
      activeDestinationId: 'd2',
      actorId: 'actor-a',
      navigationRequestId: 'navigation-request-2',
      flushImmediately: false,
    });
    expect(switched.local).toMatchObject({ journeyPhase: 'en_route', activeDestinationId: 'd2' });

    const ended = await enqueueLeaderGatheringEnd('group-1', {
      nextDestinationId: 'd2',
      actorId: 'actor-a',
      flushImmediately: false,
    });
    expect(ended.local.journeyPhase).toBe('staying');

    const rows = await listOpenCoreOperations('group-1');
    expect(rows.map((operation) => operation.operationType)).toEqual([
      'start_gathering',
      'switch_gathering',
      'end_gathering',
    ]);
    expect(rows.map((operation) => operation.entityVersion)).toEqual([2, 3, 4]);
    expect(rows[0].payload).toMatchObject({
      activeDestinationId: 'd1',
      navigationRequestId: 'navigation-request-1',
    });
    expect(rows[2].payload).toMatchObject({
      action: 'end',
      nextDestinationId: 'd2',
      activeDestinationId: 'd2',
    });

    const projected = projectOptimisticGathering(state, started.local);
    expect(projected.group.journeyStatus).toBe('going');
    expect(projected.destinations.find((destination) => destination.id === 'd1')?.closedAt).toBeUndefined();
    expect(projectOptimisticGathering(state, {
      ...started.local,
      activeDestinationId: 'missing-destination',
    }).nextDestination?.id).toBe('d1');
    expect((await getCoreDataStore().getActiveGathering('group-1'))?.journeyPhase).toBe('staying');
  });

  it('aborts a local gathering start by restoring the base state', async () => {
    const state = makeState();
    await seedSnapshot(state, { entityVersion: 1, gatheringVersion: 1 });
    const started = await enqueueLeaderGatheringStart('group-1', {
      activeDestinationId: 'd1',
      actorId: 'actor-a',
      flushImmediately: false,
    });

    await abortLeaderGatheringStart({
      operationId: started.operationId,
      restore: started.base,
      message: 'navigation session rejected',
    });

    const row = await getCoreOperationOutbox().getOperation(started.operationId);
    expect(row).toMatchObject({
      status: 'conflict',
      conflictResult: { code: 'invalid_transition', message: 'navigation session rejected' },
    });
    expect(await getCoreDataStore().getActiveGathering('group-1')).toEqual(started.base);
  });

  it('queues gathering requests and user-scoped navigation responses locally', async () => {
    await seedSnapshot();

    const submitted = await enqueueGatherPointRequest({
      groupId: 'group-1',
      subgroupId: 'subgroup-1',
      items: [{ title: 'Cafe', latitude: 25, longitude: 121, day: null }],
      actorId: 'actor-a',
    });
    const resolved = await enqueueResolveGatherPointRequest({
      groupId: 'group-1',
      requestId: submitted.requestId,
      approve: true,
      actorId: 'actor-a',
    });

    await enqueuePersonalNavigationResponse({
      groupId: 'group-1',
      sessionId: 'session-1',
      userId: 'actor-a',
      response: 'needs_help',
      operationId: 'navigation-response-1',
    });

    expect(submitted.requestId).toBe('generated-1');
    expect(submitted.operation).toMatchObject({
      entityId: 'generated-1',
      entityVersion: 0,
      operationType: 'submit_gather_point_request',
      payload: {
        requestId: 'generated-1',
        subgroupId: 'subgroup-1',
      },
    });
    expect(resolved).toMatchObject({
      entityId: 'generated-1',
      entityVersion: 0,
      operationType: 'resolve_gather_point_request',
      payload: { requestId: 'generated-1', approve: true },
    });
    expect(await getCoreDataStore().getNavigationResponse('session-1', 'actor-a')).toMatchObject({
      response: 'needs_help',
      entityVersion: 1,
    });
    expect(await listOpenCoreOperations('group-1')).toHaveLength(3);
  });
});
