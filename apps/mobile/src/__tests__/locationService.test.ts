const mockSupabase = {
  from: jest.fn(),
  rpc: jest.fn(),
};
const mockIsDemoGroup = jest.fn((_groupId?: string) => false);
const mockDemoUpdateMyLocation = jest.fn((..._args: unknown[]) => undefined);
const mockRequireUserId = jest.fn(async () => 'user-1');
const mockOrThrow = jest.fn((error: { message: string } | null) => {
  if (error) throw new Error(error.message);
});

jest.mock('../api/supabase', () => ({ supabase: mockSupabase }));
jest.mock('../api/demo', () => ({
  isDemoGroup: (groupId?: string) => mockIsDemoGroup(groupId),
  demoUpdateMyLocation: (...args: unknown[]) => mockDemoUpdateMyLocation(...args),
}));
jest.mock('../api/services/_helpers', () => ({
  requireUserId: () => mockRequireUserId(),
  orThrow: (error: { message: string } | null) => mockOrThrow(error),
}));

const {
  ackMyLocationRefresh,
  ingestLocationBatch,
  listMyPendingLocationRefreshes,
  requestGroupLocationRefresh,
  updateMyLocation,
} = require('../api/services/LocationService') as typeof import('../api/services/LocationService');

describe('LocationService durable refresh seams', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDemoGroup.mockReturnValue(false);
    mockRequireUserId.mockResolvedValue('user-1');
    mockSupabase.from.mockReturnValue({
      upsert: jest.fn().mockResolvedValue({ error: null }),
    });
  });

  it('updates demo locations locally and remote locations through member upsert', async () => {
    const coordinates = { latitude: 25, longitude: 121 };
    mockIsDemoGroup.mockReturnValueOnce(true);
    await updateMyLocation(coordinates, 'demo');
    expect(mockDemoUpdateMyLocation).toHaveBeenCalledWith(coordinates);
    expect(mockRequireUserId).not.toHaveBeenCalled();

    await updateMyLocation(coordinates, 'group-1');
    expect(mockRequireUserId).toHaveBeenCalledTimes(1);
    const memberLocations = mockSupabase.from.mock.results[0]?.value;
    expect(mockSupabase.from).toHaveBeenCalledWith('member_locations');
    expect(memberLocations.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        group_id: 'group-1',
        user_id: 'user-1',
        latitude: 25,
        longitude: 121,
      }),
      { onConflict: 'group_id,user_id' },
    );
  });

  it('keeps demo events local and sends only remote events to the batch RPC', async () => {
    mockIsDemoGroup.mockImplementation((groupId?: string) => groupId === 'demo');
    mockSupabase.rpc.mockResolvedValue({
      data: { acceptedIds: ['remote-1'], rejected: [{ id: 'remote-2', reason: 'old' }] },
      error: null,
    });
    const base = {
      navigationSessionId: null,
      capturedAt: 10,
      coords: { latitude: 25, longitude: 121 },
      trackingMode: 'passiveBackground',
      source: 'refresh_request',
      sequence: 10,
    };
    await expect(ingestLocationBatch([
      { ...base, id: 'demo-1', groupId: 'demo' },
      { ...base, id: 'remote-1', groupId: 'group-1' },
    ])).resolves.toEqual({
      acceptedIds: ['demo-1', 'remote-1'],
      rejected: [{ id: 'remote-2', reason: 'old' }],
    });
    expect(mockDemoUpdateMyLocation).toHaveBeenCalledWith(base.coords);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('ingest_location_batch', {
      p_events: [expect.objectContaining({ id: 'remote-1', groupId: 'group-1' })],
    });

    mockSupabase.rpc.mockClear();
    await expect(ingestLocationBatch([{ ...base, id: 'demo-2', groupId: 'demo' }]))
      .resolves.toEqual({ acceptedIds: ['demo-2'], rejected: [] });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('maps refresh cooldown, pending rows, and versioned ACKs from RPC responses', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: { accepted: true, retry_after_seconds: 1.2 }, error: null })
      .mockResolvedValueOnce({
        data: [
          { group_id: 'group-1', requested_by: 'leader-1', requested_at: '2026-08-13T00:00:00Z' },
          { group_id: null, requested_by: 'bad', requested_at: 'bad' },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(requestGroupLocationRefresh('group-1')).resolves.toEqual({
      accepted: true,
      retryAfterSeconds: 2,
    });
    await expect(listMyPendingLocationRefreshes()).resolves.toEqual([{
      groupId: 'group-1',
      requestedBy: 'leader-1',
      requestedAt: '2026-08-13T00:00:00Z',
    }]);
    await expect(ackMyLocationRefresh('group-1', '2026-08-13T00:00:00Z')).resolves.toBe(true);
    expect(mockSupabase.rpc).toHaveBeenNthCalledWith(1, 'request_group_location_refresh', {
      p_group_id: 'group-1',
    });
    expect(mockSupabase.rpc).toHaveBeenNthCalledWith(2, 'list_my_pending_location_refreshes');
    expect(mockSupabase.rpc).toHaveBeenNthCalledWith(3, 'ack_my_location_refresh', {
      p_group_id: 'group-1',
      p_requested_at: '2026-08-13T00:00:00Z',
    });
  });
});
