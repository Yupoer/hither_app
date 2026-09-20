jest.mock('../api/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    getLocalAuthActorId: jest.fn(),
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

const mockStore = {
  readSnapshot: jest.fn(),
  database: { findSnapshotGroupForDestination: jest.fn() },
};
const mockOutbox = {
  enqueueArrival: jest.fn(),
  enqueueMutation: jest.fn(),
  flush: jest.fn(),
};
const mockCoreSync = {
  ensureCoreSnapshot: jest.fn(),
  getCoreDataStore: jest.fn(() => mockStore),
  getCoreOperationOutbox: jest.fn(() => mockOutbox),
  enqueueGatherPointRequest: jest.fn(),
  enqueueResolveGatherPointRequest: jest.fn(),
};
jest.mock('../state/coreDataSync', () => mockCoreSync);

import { supabase } from '../api/supabase';
import {
  fetchDestinationArrivals,
  fetchPendingGatherPointRequests,
  resolveGatherPointRequest,
  resolveGatherPointRequestResilient,
  setDestinationArrival,
  setDestinationArrivalAt,
  correctDestinationArrival,
  submitGatherPointRequest,
} from '../api/services/GatheringWorkflowService';

const mockedSupabase = supabase as unknown as {
  auth: { getSession: jest.Mock };
  getLocalAuthActorId: jest.Mock;
  rpc: jest.Mock;
  from: jest.Mock;
};

const query = (result: unknown) => {
  const builder: any = {};
  for (const method of ['select', 'eq', 'order']) builder[method] = jest.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
};

const items = [{
  title: 'Cafe', address: 'A', coordinates: { latitude: 25, longitude: 121 },
}];

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.readSnapshot.mockResolvedValue(null);
  mockCoreSync.ensureCoreSnapshot.mockResolvedValue({ groupId: 'g-1' });
  mockStore.database.findSnapshotGroupForDestination.mockResolvedValue(null);
  mockOutbox.flush.mockResolvedValue(undefined);
  mockedSupabase.getLocalAuthActorId.mockResolvedValue('actor-1');
  mockedSupabase.auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'token', user: { id: 'actor-1' } } }, error: null,
  });
});

describe('GatheringWorkflowService durable and remote adapters', () => {
  it('queues gather requests from a local snapshot', async () => {
    mockCoreSync.enqueueGatherPointRequest.mockResolvedValueOnce({ requestId: 'request-local' });
    await expect(submitGatherPointRequest('g-1', 'sg-1', items)).resolves.toBe('request-local');
    expect(mockCoreSync.enqueueGatherPointRequest).toHaveBeenCalledWith({
      groupId: 'g-1', subgroupId: 'sg-1',
      items: [{ title: 'Cafe', address: 'A', latitude: 25, longitude: 121, day: null }],
    });

    expect(mockedSupabase.rpc).not.toHaveBeenCalled();
  });

  it('maps pending requests and rejects provider errors unchanged', async () => {
    mockedSupabase.from.mockReturnValue(query({ data: [{
      id: 'r-1', group_id: 'g-1', subgroup_id: null, requester_id: 'u-1',
      items: [{ title: 'Cafe', address: 'A', latitude: 25, longitude: 121, day: 2 }],
      status: 'pending', created_at: '2026-09-19T00:00:00Z',
    }], error: null }));
    await expect(fetchPendingGatherPointRequests('g-1')).resolves.toEqual([{
      id: 'r-1', groupId: 'g-1', requesterId: 'u-1', status: 'pending',
      createdAt: '2026-09-19T00:00:00Z',
      items: [{ title: 'Cafe', address: 'A', day: 2, coordinates: { latitude: 25, longitude: 121 } }],
    }]);

    const failure = { code: '42501', message: 'permission denied' };
    mockedSupabase.from.mockReturnValueOnce(query({ data: null, error: failure }));
    await expect(fetchPendingGatherPointRequests('g-1')).rejects.toMatchObject({ code: '42501', cause: failure });
  });

  it('resolves with durable queue or maps both structured and empty RPC results', async () => {
    mockCoreSync.enqueueResolveGatherPointRequest.mockResolvedValueOnce(undefined);
    await expect(resolveGatherPointRequest('r-1', true, { groupId: 'g-1' })).resolves.toEqual({ status: 'approved', insertedCount: 0 });

    expect(mockCoreSync.enqueueResolveGatherPointRequest).toHaveBeenCalledWith({
      groupId: 'g-1', requestId: 'r-1', approve: true,
    });
  });

  it('surfaces a durable business rejection without converting it to a success', async () => {
    const businessFailure = Object.assign(new Error('leader membership required'), { code: '42501' });
    mockCoreSync.enqueueResolveGatherPointRequest.mockRejectedValueOnce(businessFailure);
    await expect(resolveGatherPointRequest('r-3', false, { groupId: 'g-1' })).rejects.toBe(businessFailure);
    expect(mockCoreSync.enqueueResolveGatherPointRequest).toHaveBeenCalledTimes(1);
  });

  it('does not retry business errors and maps destination arrivals', async () => {
    mockedSupabase.from.mockReturnValue(query({ data: [{
      id: 'a-1', group_id: 'g-1', destination_id: 'd-1', user_id: 'u-1',
      arrived_at: '2026-09-19T00:00:00Z', source: 'manual', marked_by: 'u-1',
    }], error: null }));
    await expect(fetchDestinationArrivals('g-1')).resolves.toEqual([{
      id: 'a-1', groupId: 'g-1', destinationId: 'd-1', userId: 'u-1',
      arrivedAt: '2026-09-19T00:00:00Z', source: 'manual', markedBy: 'u-1',
    }]);
  });

  it('uses the local actor and outbox for arrival writes when the destination is local', async () => {
    mockStore.database.findSnapshotGroupForDestination.mockResolvedValue('g-1');
    mockCoreSync.getCoreOperationOutbox.mockReturnValue(mockOutbox);
    await expect(setDestinationArrival('d-1', 'u-1', true)).resolves.toBeUndefined();
    expect(mockOutbox.enqueueArrival).toHaveBeenCalledWith('g-1', 'd-1', expect.objectContaining({
      actorId: 'actor-1', userId: 'u-1', arrived: true, completeSolo: false,
    }));
    expect(mockedSupabase.rpc).not.toHaveBeenCalled();

    mockStore.database.findSnapshotGroupForDestination.mockResolvedValue('g-1');
    await expect(setDestinationArrivalAt('d-1', 'u-1', false, null)).resolves.toBeUndefined();
    expect(mockOutbox.enqueueArrival).toHaveBeenLastCalledWith('g-1', 'd-1', expect.objectContaining({ arrived: false, arrivedAt: null }));

    mockOutbox.flush.mockRejectedValueOnce(new Error('flush later'));
    await expect(setDestinationArrival('d-1', 'u-1', true)).resolves.toBeUndefined();
    mockOutbox.flush.mockRejectedValueOnce(new Error('flush later')); 
    await expect(setDestinationArrivalAt('d-1', 'u-1', true, '2026-09-19T00:00:00Z')).resolves.toBeUndefined();
    await Promise.resolve();
  });

  it('keeps an explicit subgroup session even when the cached main-team lane differs', async () => {
    mockStore.database.findSnapshotGroupForDestination.mockResolvedValue('g-1');
    mockStore.readSnapshot.mockResolvedValue({
      activeGathering: { activeDestinationId: 'main-stop' },
    });
    await setDestinationArrivalAt('sub-stop', 'u-1', false, null, 'sub-session');
    expect(mockOutbox.enqueueArrival).toHaveBeenLastCalledWith('g-1', 'sub-stop',
      expect.objectContaining({ navigationSessionId: 'sub-session', arrived: false }));
  });

  it('falls back to RPCs when no local destination snapshot exists', async () => {
    mockedSupabase.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await setDestinationArrival('d-1', 'u-1', true);
    await setDestinationArrivalAt('d-1', 'u-1', true, '2026-09-19T00:00:00Z');
    expect(mockedSupabase.rpc).toHaveBeenNthCalledWith(1, 'set_destination_arrival', {
      p_destination_id: 'd-1', p_target_user_id: 'u-1', p_arrived: true,
    });
    expect(mockedSupabase.rpc).toHaveBeenNthCalledWith(2, 'set_destination_arrival_at', {
      p_destination_id: 'd-1', p_target_user_id: 'u-1', p_arrived: true,
      p_arrived_at: '2026-09-19T00:00:00Z',
    });
  });

  it('queues leader history corrections as a distinct null-timestamp operation', async () => {
    mockStore.database.findSnapshotGroupForDestination.mockResolvedValue('g-1');
    mockStore.readSnapshot.mockResolvedValue({ itineraryVersion: 7 });
    mockOutbox.enqueueMutation.mockResolvedValue({ id: 'correction-1' });
    await expect(correctDestinationArrival({
      destinationId: 'd-1', targetUserId: 'member-1', arrived: true, sessionId: 'session-1',
    })).resolves.toMatchObject({ id: 'correction-1' });
    expect(mockOutbox.enqueueMutation).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'g-1', entityType: 'itinerary', entityId: 'd-1', entityVersion: 7,
      operationType: 'leader_correct_arrival', actorId: 'actor-1',
      payload: expect.objectContaining({
        targetUserId: 'member-1', sessionId: 'session-1', navigationSessionId: 'session-1',
        arrived: true, arrivedAt: null, source: 'leader_correction',
      }),
    }));
    expect(mockedSupabase.rpc).not.toHaveBeenCalled();
  });
});
