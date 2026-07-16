// Mock the supabase singleton so importing the client does not pull in
// react-native-url-polyfill / AsyncStorage (native-only) or require env vars.
jest.mock('../api/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), auth: { getSession: jest.fn() } },
}));

import {
  addDestination,
  createGroup,
  joinGroup,
  getGroupState,
  generateInviteCode,
  mapGroup,
  mapDestination,
  mapMember,
  mapNotificationPreferences,
  sendCommand,
  savePushToken,
  getNotificationPreferences,
  setNotificationPreferences,
  setJourneyStatus,
  setJourneyTarget,
  reorderDestinations,
  setDestinationMeetTime,
  setStragglerConfig,
  requestGroupLocationRefresh,
  submitGatherPointRequest,
  resolveGatherPointRequest,
  resolveGatherPointRequestResilient,
  isNetworkRequestError,
  setDestinationArrival,
  setDestinationArrivalAt,
  deleteVisitedWaypoint,
  upsertLiveActivitySession,
  deleteLiveActivitySession,
  deleteMyLiveActivitySessions,
  deleteMyLiveActivitySessionsForGroups,
} from '../api/client';
import { supabase } from '../api/supabase';

const mockedAuth = supabase.auth as unknown as { getSession: jest.Mock };
const mockedFrom = supabase.from as unknown as jest.Mock;
const mockedRpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('pure mappers (snake_case row -> camelCase type)', () => {
  it('generateInviteCode: 6 chars from the schema set', () => {
    for (let i = 0; i < 25; i++) {
      expect(generateInviteCode()).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/,
      );
    }
  });

  it('mapGroup converts persisted journey target fields', () => {
    expect(
      mapGroup({
        id: 'g1',
        name: '週末出遊',
        invite_code: 'ABC234',
        created_by: 'u1',
        created_at: '2026-01-01T00:00:00Z',
        journey_status: 'going',
        active_destination_id: 'destination-1',
        journey_started_at: '2026-07-13T10:00:00Z',
      }),
    ).toEqual({
      id: 'g1',
      name: '週末出遊',
      inviteCode: 'ABC234',
      createdBy: 'u1',
      createdAt: '2026-01-01T00:00:00Z',
      journeyStatus: 'going',
      activeDestinationId: 'destination-1',
      journeyStartedAt: '2026-07-13T10:00:00Z',
      stragglerAlerts: true,
      stragglerThresholdM: 500,
      tripDays: undefined,
      departureDate: undefined,
    });
  });

  it('mapGroup defaults journeyStatus to paused when null', () => {
    expect(
      mapGroup({
        id: 'g1',
        name: '團',
        invite_code: 'ABC234',
        created_by: 'u1',
        created_at: null,
        journey_status: null,
      }).journeyStatus,
    ).toBe('paused');
  });

  it('mapDestination maps position->order, day, and lat/lng->coordinates', () => {
    const d = mapDestination({
      id: 'd1',
      title: '集合點',
      address: null,
      latitude: 25.033,
      longitude: 121.565,
      position: 1,
      day: 1,
    } as any);
    expect(d.order).toBe(1);
    expect(d.day).toBe(1);
    expect(d.title).toBe('集合點');
    expect(d.coordinates).toEqual({ latitude: 25.033, longitude: 121.565 });
  });

  it('mapMember combines membership + profile nickname + location', () => {
    expect(
      mapMember(
        { user_id: 'u1', role: 'leader', status: 'arrived' },
        { id: 'u1', nickname: '隊長小燈籠' },
        { user_id: 'u1', latitude: 25, longitude: 121, updated_at: 't0' },
      ),
    ).toEqual({
      userId: 'u1',
      name: '隊長小燈籠',
      role: 'leader',
      status: 'arrived',
      avatar: undefined,
      avatarColor: undefined,
      solo: false,
      subgroupId: undefined,
      coordinates: { latitude: 25, longitude: 121 },
      lastUpdated: 't0',
    });
  });

  it('mapMember without a location row yields no coordinates', () => {
    const m = mapMember(
      { user_id: 'u2', role: 'follower' },
      undefined,
      undefined,
    );
    expect(m.coordinates).toBeUndefined();
    expect(m.name).toBe('');
  });
});

describe('group state', () => {
  it('loads persisted trip details for every group-state viewer', async () => {
    const groupRow = {
      id: 'g1',
      name: '旅行團',
      invite_code: 'ABC234',
      created_by: 'u1',
      created_at: '2026-01-01T00:00:00Z',
      journey_status: 'paused',
      trip_days: 4,
      departure_date: '2026-08-01',
    };
    let selectedGroupFields = '';
    const groups = {} as {
      select: jest.Mock;
      eq: jest.Mock;
      single: jest.Mock;
    };
    groups.select = jest.fn((fields: string) => {
      selectedGroupFields = fields;
      return groups;
    });
    groups.eq = jest.fn(() => groups);
    groups.single = jest.fn(async () => ({
      data: selectedGroupFields.includes('trip_days')
        ? groupRow
        : { ...groupRow, trip_days: undefined, departure_date: undefined },
      error: null,
    }));
    const empty = (data: unknown[] = []) => ({
      select: jest.fn(() => ({
        eq: jest.fn(async () => ({ data, error: null })),
      })),
    });
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'groups') return groups;
      if (table === 'memberships') return empty();
      if (table === 'member_locations') return empty();
      if (table === 'subgroups') return empty();
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(async () => ({ data: [], error: null })),
          })),
        })),
      };
    });

    const state = await getGroupState('g1');

    expect(selectedGroupFields).toContain('trip_days');
    expect(selectedGroupFields).toContain('departure_date');
    expect(state.group.tripDays).toBe(4);
    expect(state.group.departureDate).toBe('2026-08-01');
  });
});

describe('createGroup', () => {
  it('inserts a group as leader and returns the mapped group', async () => {
    mockedAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'uid' } } },
      error: null,
    });
    const single = jest.fn().mockResolvedValue({
      data: {
        id: 'g1',
        name: '週末出遊',
        invite_code: 'ABC234',
        created_by: 'uid',
        created_at: 't0',
      },
      error: null,
    });
    const membershipInsert = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockImplementation((table: string) =>
      table === 'groups'
        ? { insert: () => ({ select: () => ({ single }) }) }
        : { insert: membershipInsert },
    );

    const group = await createGroup('週末出遊');
    expect(group.name).toBe('週末出遊');
    expect(group.inviteCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(membershipInsert).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'leader', user_id: 'uid' }),
    );
  });
});

describe('joinGroup', () => {
  it('throws when the invite code matches no group', async () => {
    mockedAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'uid' } } },
      error: null,
    });
    mockedRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0002', message: 'group not found for code ZZZ999' },
    });

    await expect(joinGroup('zzz999')).rejects.toThrow('找不到這個群組');
  });

  it('upper-cases the code and joins via the join_group RPC', async () => {
    mockedAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'uid' } } },
      error: null,
    });
    mockedRpc.mockResolvedValue({
      data: {
        id: 'g1',
        name: '團',
        invite_code: 'ABC234',
        created_by: 'leader',
        created_at: 't0',
      },
      error: null,
    });

    const group = await joinGroup('abc234');
    expect(group.inviteCode).toBe('ABC234');
    expect(mockedRpc).toHaveBeenCalledWith('join_group', { p_code: 'ABC234' });
  });
});

describe('addDestination', () => {
  // Chainable mock for the `itinerary_items` table: the edge-position read
  // (max position) ends in .maybeSingle(); .insert(...) resolves to
  // `insertResult` and records its payload.
  function itineraryTable(edgePosition: number | null, insertResult: unknown) {
    const obj: Record<string, unknown> = {};
    const self = () => obj;
    Object.assign(obj, {
      select: self,
      eq: self,
      is: self,
      order: self,
      limit: self,
      maybeSingle: () =>
        Promise.resolve({
          data: edgePosition === null ? null : { position: edgePosition },
          error: null,
        }),
      insert: jest.fn(() => Promise.resolve(insertResult)),
    });
    return obj as { insert: jest.Mock };
  }

  it('appends the new stop to the end (maxPosition + 1)', async () => {
    const itinerary = itineraryTable(2, { error: null });
    mockedFrom.mockImplementation(() => itinerary);

    await addDestination('g1', {
      title: '台北101',
      address: '台北市信義區',
      coordinates: { latitude: 25.034, longitude: 121.564 },
    });

    expect(itinerary.insert).toHaveBeenCalledWith({
      group_id: 'g1',
      subgroup_id: null,
      title: '台北101',
      address: '台北市信義區',
      day: 1,
      latitude: 25.034,
      longitude: 121.564,
      position: 3, // 2 + 1, after the current last stop
    });
  });

  it('with a subgroupId: inserts subgroup_id and scopes max-position to that subgroup', async () => {
    const itinerary = itineraryTable(1, { error: null });
    mockedFrom.mockImplementation(() => itinerary);

    await addDestination(
      'g1',
      { title: '小隊集合點', coordinates: { latitude: 1, longitude: 2 } },
      'sg1',
    );

    expect(itinerary.insert).toHaveBeenCalledWith(
      expect.objectContaining({ subgroup_id: 'sg1', position: 2 }),
    );
  });

  it('uses position 0 when the itinerary is empty', async () => {
    const itinerary = itineraryTable(null, { error: null });
    mockedFrom.mockImplementation(() => itinerary);

    await addDestination('g1', {
      title: '中正紀念堂',
      coordinates: { latitude: 25.036, longitude: 121.518 },
    });

    expect(itinerary.insert).toHaveBeenCalledWith(
      expect.objectContaining({ position: 0, address: null }),
    );
  });

  it('throws when the insert is rejected (e.g. a follower hitting RLS)', async () => {
    const itinerary = itineraryTable(0, {
      error: { code: '42501', message: 'new row violates row-level security' },
    });
    mockedFrom.mockImplementation(() => itinerary);

    await expect(
      addDestination('g1', {
        title: '某處',
        coordinates: { latitude: 0, longitude: 0 },
      }),
    ).rejects.toThrow('row-level security');
  });
});

describe('notifications, commands & journey', () => {
  beforeEach(() => {
    mockedAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'uid' } } },
      error: null,
    });
  });

  it('mapNotificationPreferences maps snake_case flags to camelCase', () => {
    expect(
      mapNotificationPreferences({
        add_gathering: true,
        leader_commands: false,
        follower_requests: true,
        journey: false,
      }),
    ).toEqual({
      addGathering: true,
      leaderCommands: false,
      followerRequests: true,
      journey: false,
    });
  });

  it('savePushToken upserts the token for the current user (no-op on null)', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockImplementation(() => ({ upsert }));

    await savePushToken(null);
    expect(upsert).not.toHaveBeenCalled();

    await savePushToken('hextoken');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'uid', token: 'hextoken', platform: 'ios' }),
      { onConflict: 'user_id,token' },
    );
  });

  it('sendCommand inserts a command with the sender id', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockImplementation(() => ({ insert }));

    await sendCommand('g1', 'need_restroom', '我要上廁所');
    expect(insert).toHaveBeenCalledWith({
      group_id: 'g1',
      sender_id: 'uid',
      type: 'need_restroom',
      message: '我要上廁所',
      latitude: null,
      longitude: null,
    });
  });

  it('requests a group-wide location refresh through the server cooldown RPC', async () => {
    mockedRpc.mockResolvedValue({
      data: { accepted: true, retry_after_seconds: 60 },
      error: null,
    });

    await expect(requestGroupLocationRefresh('g1')).resolves.toEqual({
      accepted: true,
      retryAfterSeconds: 60,
    });
    expect(mockedRpc).toHaveBeenCalledWith('request_group_location_refresh', {
      p_group_id: 'g1',
    });
  });

  it('submits a coordinate-preserving gathering-point request', async () => {
    mockedRpc.mockResolvedValue({ data: 'request-1', error: null });
    await expect(submitGatherPointRequest('g1', 'sg1', [{
      title: '車站',
      address: '台北市',
      coordinates: { latitude: 25.1, longitude: 121.5 },
    }])).resolves.toBe('request-1');
    expect(mockedRpc).toHaveBeenCalledWith('submit_gather_point_request', {
      p_group_id: 'g1',
      p_subgroup_id: 'sg1',
      p_items: [{
        title: '車站', address: '台北市', latitude: 25.1, longitude: 121.5, day: 1,
      }],
    });
  });

  it('resolves gathering requests and manual arrivals through guarded RPCs', async () => {
    mockedRpc.mockResolvedValue({
      data: { status: 'approved', inserted_count: 2 },
      error: null,
    });
    await expect(resolveGatherPointRequest('request-1', true)).resolves.toEqual({
      status: 'approved',
      insertedCount: 2,
    });
    mockedRpc.mockResolvedValue({ data: null, error: null });
    await setDestinationArrival('destination-1', 'member-1', true);
    expect(mockedRpc).toHaveBeenNthCalledWith(1, 'resolve_gather_point_request', {
      p_request_id: 'request-1', p_approve: true,
    });
    expect(mockedRpc).toHaveBeenNthCalledWith(2, 'set_destination_arrival', {
      p_destination_id: 'destination-1', p_target_user_id: 'member-1', p_arrived: true,
    });
  });

  it('detects RN network transport failures', () => {
    expect(isNetworkRequestError(new Error('TypeError: Network request failed'))).toBe(true);
    expect(isNetworkRequestError(new Error('leader membership required'))).toBe(false);
  });

  it('recovers gather resolve when the request is no longer pending after a network blip', async () => {
    // Transport fails after the server already applied the write.
    mockedRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Network request failed' },
    });
    mockedFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    });
    await expect(
      resolveGatherPointRequestResilient('request-1', true, { groupId: 'g1' }),
    ).resolves.toEqual({ status: 'approved', insertedCount: 0 });
    // Recovery short-circuits before a second RPC attempt.
    expect(mockedRpc).toHaveBeenCalledTimes(1);
  });

  it('submits an explicit arrival timestamp through the timestamp-aware RPC', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: null });
    await setDestinationArrivalAt(
      'destination-1',
      'member-1',
      true,
      '2026-07-15T08:30:00.000Z',
    );
    expect(mockedRpc).toHaveBeenCalledWith('set_destination_arrival_at', {
      p_destination_id: 'destination-1',
      p_target_user_id: 'member-1',
      p_arrived: true,
      p_arrived_at: '2026-07-15T08:30:00.000Z',
    });
  });

  it('deletes a history row without touching destination arrivals', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const remove = jest.fn(() => ({ eq }));
    mockedFrom.mockImplementation(() => ({ delete: remove }));
    await deleteVisitedWaypoint('history-1');
    expect(remove).toHaveBeenCalledWith();
    expect(eq).toHaveBeenCalledWith('id', 'history-1');
  });

  it('returns the server cooldown when another member already requested a refresh', async () => {
    mockedRpc.mockResolvedValue({
      data: { accepted: false, retry_after_seconds: 37 },
      error: null,
    });

    await expect(requestGroupLocationRefresh('g1')).resolves.toEqual({
      accepted: false,
      retryAfterSeconds: 37,
    });
  });

  it('getNotificationPreferences returns all-on defaults when no row exists', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    mockedFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }));

    expect(await getNotificationPreferences()).toEqual({
      addGathering: true,
      leaderCommands: true,
      followerRequests: true,
      journey: true,
    });
  });

  it('setNotificationPreferences upserts all four flags by user_id', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockImplementation(() => ({ upsert }));

    await setNotificationPreferences({
      addGathering: false,
      leaderCommands: true,
      followerRequests: false,
      journey: true,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'uid',
        add_gathering: false,
        leader_commands: true,
        follower_requests: false,
        journey: true,
      }),
      { onConflict: 'user_id' },
    );
  });

  it('setJourneyStatus updates groups.journey_status', async () => {
    const update = jest.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    mockedFrom.mockImplementation(() => ({ update }));

    await setJourneyStatus('g1', 'going');
    expect(update).toHaveBeenCalledWith({ journey_status: 'going' });
  });

  it('setJourneyTarget atomically starts the persisted destination through RPC', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: null });

    await setJourneyTarget('g1', 'destination-1');

    expect(mockedRpc).toHaveBeenCalledWith('set_journey_target', {
      p_group_id: 'g1',
      p_destination_id: 'destination-1',
    });
  });

  it('setJourneyTarget clears the persisted destination when paused', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: null });

    await setJourneyTarget('g1', null);

    expect(mockedRpc).toHaveBeenCalledWith('set_journey_target', {
      p_group_id: 'g1',
      p_destination_id: null,
    });
  });

  it('setStragglerConfig updates groups.straggler_alerts and threshold', async () => {
    const update = jest.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    mockedFrom.mockImplementation(() => ({ update }));

    await setStragglerConfig('g1', false, 1000);
    expect(update).toHaveBeenCalledWith({
      straggler_alerts: false,
      straggler_threshold_m: 1000,
    });
  });

  it('setDestinationMeetTime updates itinerary_items.meet_at and red minutes', async () => {
    const update = jest.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    mockedFrom.mockImplementation(() => ({ update }));

    await setDestinationMeetTime('d1', '2026-07-09T10:00:00.000Z', 10);
    expect(update).toHaveBeenCalledWith({
      meet_at: '2026-07-09T10:00:00.000Z',
      meet_red_minutes: 10,
    });
  });

  it('reorderDestinations writes an aligned meet time when supplied', async () => {
    const eqGroup = jest.fn().mockResolvedValue({ error: null });
    const eqId = jest.fn(() => ({ eq: eqGroup }));
    const update = jest.fn(() => ({ eq: eqId }));
    mockedFrom.mockImplementation(() => ({ update }));

    await reorderDestinations('g1', [
      {
        id: 'd1',
        position: 2,
        day: 3,
        meetAt: '2026-08-02T06:30:00.000Z',
      },
    ]);

    expect(update).toHaveBeenCalledWith({
      position: 2,
      day: 3,
      meet_at: '2026-08-02T06:30:00.000Z',
    });
  });

  it('reorderDestinations does not overwrite meet_at when no value is supplied', async () => {
    const eqGroup = jest.fn().mockResolvedValue({ error: null });
    const eqId = jest.fn(() => ({ eq: eqGroup }));
    const update = jest.fn(() => ({ eq: eqId }));
    mockedFrom.mockImplementation(() => ({ update }));

    await reorderDestinations('g1', [{ id: 'd1', position: 1, day: 1 }]);

    expect(update).toHaveBeenCalledWith({ position: 1, day: 1 });
  });

  it('setDestinationMeetTime(null) clears the meet time', async () => {
    const update = jest.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    mockedFrom.mockImplementation(() => ({ update }));

    await setDestinationMeetTime('d1', null);
    expect(update).toHaveBeenCalledWith({ meet_at: null });
  });

  it('setDestinationMeetTime throws when RLS rejects (follower, not leader)', async () => {
    const update = jest.fn(() => ({
      eq: () =>
        Promise.resolve({
          error: { code: '42501', message: 'new row violates row-level security' },
        }),
    }));
    mockedFrom.mockImplementation(() => ({ update }));

    await expect(setDestinationMeetTime('d1', null)).rejects.toThrow('row-level security');
  });
});

describe('live activity sessions', () => {
  beforeEach(() => {
    mockedAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'uid' } } },
      error: null,
    });
  });

  it('upserts the current user session by user and group', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockImplementation(() => ({ upsert }));

    await upsertLiveActivitySession({
      groupId: 'g1',
      destinationId: 'd1',
      activityId: 'activity-1',
      pushToken: 'token-1',
      initialDistanceM: 1000,
      currentDistanceM: 800,
      etaSeconds: 600,
      travelMode: 'walk',
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'uid',
        group_id: 'g1',
        destination_id: 'd1',
        activity_id: 'activity-1',
        push_token: 'token-1',
      }),
      { onConflict: 'user_id,group_id' },
    );
  });

  it('deletes only the current activity session', async () => {
    const eqActivity = jest.fn().mockResolvedValue({ error: null });
    const eqUser = jest.fn(() => ({ eq: eqActivity }));
    const remove = jest.fn(() => ({ eq: eqUser }));
    mockedFrom.mockImplementation(() => ({ delete: remove }));

    await deleteLiveActivitySession('activity-1');

    expect(eqUser).toHaveBeenCalledWith('user_id', 'uid');
    expect(eqActivity).toHaveBeenCalledWith('activity_id', 'activity-1');
  });

  it('deletes all live activity sessions for the current user', async () => {
    const eqUser = jest.fn().mockResolvedValue({ error: null });
    const remove = jest.fn(() => ({ eq: eqUser }));
    mockedFrom.mockImplementation(() => ({ delete: remove }));

    await deleteMyLiveActivitySessions();

    expect(eqUser).toHaveBeenCalledWith('user_id', 'uid');
  });

  it('deletes live activity sessions for selected groups', async () => {
    const inGroups = jest.fn().mockResolvedValue({ error: null });
    const eqUser = jest.fn(() => ({ in: inGroups }));
    const remove = jest.fn(() => ({ eq: eqUser }));
    mockedFrom.mockImplementation(() => ({ delete: remove }));

    await deleteMyLiveActivitySessionsForGroups(['g1', 'g2']);

    expect(eqUser).toHaveBeenCalledWith('user_id', 'uid');
    expect(inGroups).toHaveBeenCalledWith('group_id', ['g1', 'g2']);
  });
});
