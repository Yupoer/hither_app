jest.mock('../api/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    getLocalAuthActorId: jest.fn(),
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));
jest.mock('../state/coreDataSync', () => {
  throw new Error('native durable adapter intentionally unavailable in remote contract tests');
});

import { supabase } from '../api/supabase';
import {
  fetchDestinationArrivals,
  resolveGatherPointRequest,
  resolveGatherPointRequestResilient,
  setDestinationArrival,
  setDestinationArrivalAt,
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

beforeEach(() => {
  jest.clearAllMocks();
  mockedSupabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'actor-1' } } }, error: null });
  mockedSupabase.getLocalAuthActorId.mockResolvedValue('actor-1');
});

describe('GatheringWorkflowService remote adapter', () => {
  it('submits and resolves through the remote RPC contract', async () => {
    mockedSupabase.rpc
      .mockResolvedValueOnce({ data: 'request-1', error: null })
      .mockResolvedValueOnce({ data: { status: 'rejected', inserted_count: 3 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await expect(submitGatherPointRequest('g-1', undefined, [{ title: 'A', coordinates: { latitude: 1, longitude: 2 } }])).resolves.toBe('request-1');
    await expect(resolveGatherPointRequest('r-1', false)).resolves.toEqual({ status: 'rejected', insertedCount: 3 });
    await expect(resolveGatherPointRequest('r-2', true)).resolves.toEqual({ status: 'approved', insertedCount: 0 });
  });

  it('recovers an already-applied request and retries a pending network failure once', async () => {
    mockedSupabase.rpc.mockRejectedValueOnce({ code: 'ECONNRESET', message: 'Network request failed' });
    mockedSupabase.from.mockReturnValueOnce(query({ data: [], error: null }));
    await expect(resolveGatherPointRequestResilient('r-1', true, { groupId: 'g-1' })).resolves.toEqual({ status: 'approved', insertedCount: 0 });

    mockedSupabase.rpc
      .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'Network request failed' })
      .mockResolvedValueOnce({ data: { status: 'approved', inserted_count: 2 }, error: null });
    mockedSupabase.from.mockReturnValueOnce(query({ data: [{
      id: 'r-2', group_id: 'g-1', subgroup_id: null, requester_id: 'u-1',
      items: [], status: 'pending', created_at: '2026-09-19T00:00:00Z',
    }], error: null }));
    await expect(resolveGatherPointRequestResilient('r-2', true, { groupId: 'g-1' })).resolves.toEqual({ status: 'approved', insertedCount: 2 });
    expect(mockedSupabase.rpc).toHaveBeenLastCalledWith('resolve_gather_point_request', { p_request_id: 'r-2', p_approve: true });
  });

  it('maps arrivals and writes remote arrival RPCs with the local actor seam', async () => {
    mockedSupabase.from.mockReturnValue(query({ data: [{
      id: 'a-1', group_id: 'g-1', destination_id: 'd-1', user_id: 'u-1',
      arrived_at: '2026-09-19T00:00:00Z', source: 'manual', marked_by: 'u-1',
    }], error: null }));
    await expect(fetchDestinationArrivals('g-1')).resolves.toMatchObject([{ id: 'a-1', groupId: 'g-1' }]);

    mockedSupabase.rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: null });
    await setDestinationArrival('d-1', 'u-1', true);
    await setDestinationArrivalAt('d-1', 'u-1', false, null);
    expect(mockedSupabase.rpc).toHaveBeenNthCalledWith(1, 'set_destination_arrival', { p_destination_id: 'd-1', p_target_user_id: 'u-1', p_arrived: true });
    expect(mockedSupabase.rpc).toHaveBeenNthCalledWith(2, 'set_destination_arrival_at', { p_destination_id: 'd-1', p_target_user_id: 'u-1', p_arrived: false, p_arrived_at: null });
  });
});
