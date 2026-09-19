jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

jest.mock('../api/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn(), getUser: jest.fn() },
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

const mockIsDemoGroup = jest.fn(() => false);
const mockGetDemoState = jest.fn();
const mockDemoSetJourneyStatus = jest.fn();
const mockDemoSetJourneyTarget = jest.fn();
const mockDemoSetSolo = jest.fn();
const mockDemoSelfSplit = jest.fn();
const mockDemoSelfMerge = jest.fn();
jest.mock('../api/demo', () => ({
  isDemoGroup: mockIsDemoGroup,
  getDemoState: mockGetDemoState,
  demoSetJourneyStatus: mockDemoSetJourneyStatus,
  demoSetJourneyTarget: mockDemoSetJourneyTarget,
  demoSetSolo: mockDemoSetSolo,
  demoSelfSplit: mockDemoSelfSplit,
  demoSelfMerge: mockDemoSelfMerge,
}));

const mockListDailyAccommodations = jest.fn();
jest.mock('../api/services/DailyAccommodationService', () => ({
  listDailyAccommodations: (...args: unknown[]) => mockListDailyAccommodations(...args),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase';
import {
  createGroup,
  getCachedMyJoinedGroups,
  getGroupRecoverySnapshot,
  getGroupState,
  getMyJoinedGroups,
  invalidateMyJoinedGroupsCache,
  joinedGroupAvatarsKey,
  joinGroup,
  kickGroupMember,
  leaveGroups,
  mapGroup,
  mapMember,
  mapSubgroup,
  mapSubgroupInvite,
  reportStraggler,
  selfMerge,
  selfSplit,
  setJourneyStatus,
  setJourneyTarget,
  setSolo,
  setStragglerConfig,
  updateGroupAvatar,
  updateGroupTripDetails,
} from '../api/services/GroupService';

const mockedSupabase = supabase as unknown as {
  auth: { getSession: jest.Mock; getUser: jest.Mock };
  rpc: jest.Mock;
  from: jest.Mock;
};
const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'g-1', name: 'Trip', invite_code: 'ABC123', avatar: '🐑', avatar_color: '#E8543F',
  created_by: 'user-1', created_at: '2026-09-19T00:00:00Z', journey_status: 'paused',
  active_destination_id: null, journey_started_at: null, straggler_alerts: true,
  straggler_threshold_m: 500, trip_days: 3, departure_date: '2026-10-01', accommodation_auto_add: true,
  ...overrides,
}) as any;

const query = (result: unknown) => {
  const builder: any = {};
  for (const method of ['select', 'eq', 'in', 'order', 'update', 'delete']) builder[method] = jest.fn(() => builder);
  builder.maybeSingle = jest.fn(() => builder);
  builder.single = jest.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
};

const setTables = (tables: Record<string, unknown>) => {
  mockedSupabase.from.mockImplementation((table: string) => query(tables[table] ?? { data: [], error: null }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsDemoGroup.mockReturnValue(false);
  mockListDailyAccommodations.mockResolvedValue([]);
  mockGetDemoState.mockReturnValue({ group: row(), members: [], destinations: [], subgroups: [] });
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue(undefined);
  mockedSupabase.auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'token', user: { id: 'user-1' } } }, error: null,
  });
  mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mockedSupabase.rpc.mockResolvedValue({ data: null, error: null });
  setTables({});
  invalidateMyJoinedGroupsCache();
});

describe('GroupService pure mappers and group lifecycle', () => {
  it('maps persisted and default group/member/subgroup fields', () => {
    expect(mapGroup(row({ avatar: 'unknown', avatar_color: 'bad', created_by: null, created_at: null }))).toMatchObject({
      id: 'g-1', createdBy: '', journeyStatus: 'paused', stragglerAlerts: true,
    });
    expect(mapMember(
      { user_id: 'u-1', role: 'leader', status: null, solo: null, subgroup_id: null },
      { id: 'u-1', nickname: 'Ada', avatar: '🦊', avatar_color: '#E8543F' },
      { user_id: 'u-1', latitude: 25, longitude: 121, updated_at: 'now' },
    )).toMatchObject({ userId: 'u-1', name: 'Ada', status: 'active', coordinates: { latitude: 25, longitude: 121 } });
    expect(mapMember({ user_id: 'u-2', role: 'follower' }, undefined, { user_id: 'u-2', latitude: null, longitude: null, updated_at: null })).toMatchObject({ name: '', solo: false });
    expect(mapSubgroup({ id: 'sg', name: 'Team', mode: 'collab', leader_id: null, parent_subgroup_id: 'root' })).toEqual({ id: 'sg', name: 'Team', mode: 'collab', leaderId: undefined, parentId: 'root' });
    expect(mapSubgroupInvite({ id: 'i', group_id: 'g-1', subgroup_id: 'sg', inviter_id: 'a', invitee_id: 'b', status: 'pending', created_at: null })).toMatchObject({ groupId: 'g-1', subgroupId: 'sg', createdAt: undefined });
    expect(joinedGroupAvatarsKey('user-1')).toBe('@hither/joined-group-avatars:user-1');
  });

  it('creates groups, updates validated avatars, and maps anonymous access errors', async () => {
    mockedSupabase.rpc.mockResolvedValueOnce({ data: row(), error: null });
    await expect(createGroup('  Trip  ')).resolves.toMatchObject({ id: 'g-1', name: 'Trip' });
    expect(mockedSupabase.rpc).toHaveBeenCalledWith('create_group', { p_name: 'Trip' });

    mockedSupabase.rpc.mockResolvedValueOnce({ data: row(), error: null });
    setTables({ groups: { data: row({ avatar: '🐺', avatar_color: '#4A90D9' }), error: null } });
    await expect(createGroup('Trip', '🐺', '#4A90D9')).resolves.toMatchObject({ avatar: '🐺', avatarColor: '#4A90D9' });
    const groupUpdate = (mockedSupabase.from.mock.results[0]?.value) as any;
    expect(groupUpdate.update).toHaveBeenCalledWith({ avatar: '🐺', avatar_color: '#4A90D9' });

    mockedSupabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0401', message: 'expired' } });
    await expect(createGroup('Trip')).rejects.toThrow('anonymous access expired');
    mockedSupabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0406', message: 'registration required member 6' } });
    await expect(createGroup('Trip')).rejects.toThrow('leader registration required');
    await expect(updateGroupAvatar('g-1', 'not-valid', 'bad')).resolves.toMatchObject({ id: 'g-1' });
  });

  it('joins groups and maps not-found, member-cap, and anonymous errors', async () => {
    mockedSupabase.rpc.mockResolvedValueOnce({ data: row(), error: null });
    await expect(joinGroup('ab12cd')).resolves.toMatchObject({ id: 'g-1' });
    expect(mockedSupabase.rpc).toHaveBeenCalledWith('join_group', { p_code: 'AB12CD' });

    mockedSupabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'missing' } });
    await expect(joinGroup('missing')).rejects.toThrow('找不到這個群組');
    mockedSupabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0003', message: 'cap' } });
    await expect(joinGroup('cap')).rejects.toMatchObject({ code: 'member_limit' });
    mockedSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'anonymous access expired' } });
    await expect(joinGroup('expired')).rejects.toThrow('anonymous access expired');
  });
});

describe('GroupService snapshots and joined-group cache', () => {
  it('loads a complete group state and tolerates optional subgroup absence', async () => {
    setTables({
      groups: { data: row(), error: null },
      memberships: { data: [{ user_id: 'user-1', role: 'leader', status: 'active' }], error: null },
      itinerary_items: { data: [{ id: 'd-1', title: 'Next', position: 0, day: 1, address: null, latitude: 25, longitude: 121, closed_at: null }], error: null },
      member_locations: { data: [{ user_id: 'user-1', latitude: 25, longitude: 121, updated_at: 'now' }], error: null },
      profiles: { data: [{ id: 'user-1', nickname: 'Ada', avatar: '🦊', avatar_color: '#E8543F' }], error: null },
      subgroups: { data: [{ id: 'sg', name: 'Team', mode: 'collab', leader_id: 'user-1', parent_subgroup_id: null }], error: null },
    });
    mockListDailyAccommodations.mockResolvedValue([{ id: 'stay', groupId: 'g-1', stayDate: '2026-10-01', title: 'Hotel', coordinates: { latitude: 25, longitude: 121 } }]);
    await expect(getGroupState('g-1')).resolves.toMatchObject({
      group: { id: 'g-1' }, members: [{ userId: 'user-1', name: 'Ada' }],
      destinations: [{ id: 'd-1' }], subgroups: [{ id: 'sg' }], dailyAccommodations: [{ id: 'stay' }],
    });

    setTables({
      groups: { data: row(), error: null },
      memberships: { data: [], error: null },
      itinerary_items: { data: [], error: null },
      member_locations: { data: [], error: null },
      subgroups: { data: null, error: { message: 'optional unavailable' } },
    });
    await expect(getGroupState('g-1')).resolves.toMatchObject({ members: [], subgroups: [] });
  });

  it('uses the demo snapshot path without remote group queries', async () => {
    mockIsDemoGroup.mockReturnValue(true);
    mockedSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    mockGetDemoState.mockReturnValue({ group: { id: 'demo' }, members: [], destinations: [], subgroups: [] });
    await expect(getGroupState('demo')).resolves.toMatchObject({ group: { id: 'demo' } });
    expect(mockedSupabase.from).not.toHaveBeenCalled();
  });

  it('maps recovery snapshots, versions, revision fallback, and validation errors', async () => {
    mockedSupabase.rpc.mockResolvedValueOnce({ data: {
      group: row(),
      memberships: [{ user_id: 'user-1', role: 'leader' }],
      profiles: [{ id: 'user-1', nickname: 'Ada' }],
      locations: [],
      itinerary: [],
      subgroups: [],
      entity_versions: [null, { entity_type: 'itinerary' }, { entity_type: 'itinerary', entity_id: 'd-1', entity_version: 7 }, { entity_type: 'itinerary', entity_id: 'd-2', entity_version: 'bad' }],
      generated_at: '2026-09-19T00:00:00Z',
    }, error: null });
    await expect(getGroupRecoverySnapshot('g-1')).resolves.toMatchObject({
      revision: '2026-09-19T00:00:00Z', entityVersions: { 'itinerary:d-1': 7 },
    });

    mockedSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(getGroupRecoverySnapshot('g-1')).rejects.toThrow('group_recovery_snapshot_invalid');
    mockedSupabase.rpc.mockResolvedValueOnce({ data: {}, error: null });
    await expect(getGroupRecoverySnapshot('g-1')).rejects.toThrow('group_recovery_snapshot_missing_group');

    mockIsDemoGroup.mockReturnValue(true);
    await expect(getGroupRecoverySnapshot('demo')).resolves.toMatchObject({ revision: 'demo', entityVersions: {} });
  });

  it('handles signed-out, empty, profile-rich, and lite joined-group reads with disk cache', async () => {
    mockedSupabase.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(getMyJoinedGroups()).resolves.toEqual([]);

    mockedSupabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'user-1' } } }, error: null });
    setTables({ memberships: { data: [], error: null } });
    await expect(getMyJoinedGroups()).resolves.toEqual([]);
    expect(getCachedMyJoinedGroups('user-1')).toEqual([]);
    expect(getCachedMyJoinedGroups('other')).toBeNull();

    setTables({
      memberships: { data: [{ group_id: 'g-1', role: 'leader' }], error: null },
      groups: { data: [row()], error: null },
      profiles: { data: [{ id: 'user-1', avatar: '🦊', avatar_color: '#E8543F' }, { id: 'user-2', avatar: null, avatar_color: null }], error: null },
    });
    storage.getItem.mockResolvedValueOnce(JSON.stringify({}));
    // The second memberships query is selected by call order/table; the table
    // seam returns the same response for memberships, so make its rows useful
    // for both the own-membership and group-member query.
    setTables({
      memberships: { data: [{ group_id: 'g-1', role: 'leader', user_id: 'user-1' }, { group_id: 'g-1', role: 'leader', user_id: 'user-2' }], error: null },
      groups: { data: [row()], error: null },
      profiles: { data: [{ id: 'user-1', avatar: '🦊', avatar_color: '#E8543F' }, { id: 'user-2', avatar: null, avatar_color: null }], error: null },
    });
    const rich = await getMyJoinedGroups({ includeProfiles: true });
    expect(rich[0]).toMatchObject({ group: { id: 'g-1' }, memberCount: 2, role: 'leader' });
    expect(rich[0].memberProfiles).toHaveLength(2);
    await Promise.resolve();
    expect(storage.setItem).toHaveBeenCalledWith(expect.stringContaining('joined-group-avatars:user-1'), expect.any(String));

    invalidateMyJoinedGroupsCache();
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ 'g-1': [{ userId: 'cached', avatar: '🐑', avatarColor: '#E8543F' }] }));
    const lite = await getMyJoinedGroups({ includeProfiles: false });
    expect(lite[0].memberProfiles).toEqual([{ userId: 'cached', avatar: '🐑', avatarColor: '#E8543F' }]);
  });

  it('handles empty group results and best-effort avatar cache failures', async () => {
    setTables({
      memberships: { data: [{ group_id: 'g-1', role: 'leader' }], error: null },
      groups: { data: [], error: null },
    });
    await expect(getMyJoinedGroups()).resolves.toEqual([]);

    setTables({
      memberships: { data: [{ group_id: 'g-1', role: 'leader', user_id: 'user-1' }, { group_id: 'g-1', role: 'leader', user_id: 'user-2' }], error: null },
      groups: { data: [row()], error: null },
      profiles: { data: [{ id: 'user-2', avatar: '🐺', avatar_color: '#4A90D9' }], error: null },
    });
    storage.getItem.mockRejectedValueOnce(new Error('disk read')); 
    storage.setItem.mockRejectedValueOnce(new Error('disk write'));
    await expect(getMyJoinedGroups()).resolves.toHaveLength(1);
    expect(getCachedMyJoinedGroups('user-1')).toHaveLength(1);
  });
});

describe('GroupService mutations and demo branches', () => {
  it('leaves groups and keeps the local cache consistent', async () => {
    setTables({ memberships: { data: [{ group_id: 'g-1', role: 'leader' }], error: null }, groups: { data: [row()], error: null } });
    await getMyJoinedGroups({ includeProfiles: false });
    await expect(leaveGroups([])).resolves.toBeUndefined();
    await expect(leaveGroups(['g-1'])).resolves.toBeUndefined();
    expect(getCachedMyJoinedGroups('user-1')).toEqual([]);

    invalidateMyJoinedGroupsCache();
    await expect(leaveGroups(['g-2'])).resolves.toBeUndefined();
    expect(getCachedMyJoinedGroups('user-1')).toBeNull();
  });

  it('kicks members only through the atomic RPC and validates its returned code', async () => {
    mockIsDemoGroup.mockReturnValue(true);
    await expect(kickGroupMember('demo', 'u-2')).rejects.toThrow('kick_not_supported_in_demo');
    mockIsDemoGroup.mockReturnValue(false);
    mockedSupabase.rpc.mockResolvedValueOnce({ data: 'ABC123', error: null });
    await expect(kickGroupMember('g-1', 'u-2')).resolves.toBe('ABC123');
    mockedSupabase.rpc.mockResolvedValueOnce({ data: 'bad', error: null });
    await expect(kickGroupMember('g-1', 'u-2')).rejects.toThrow('kick_group_member_invalid_code');
  });

  it('runs remote group settings mutations and their demo equivalents', async () => {
    await setJourneyStatus('g-1', 'going');
    await setJourneyTarget('g-1', 'd-1');
    await setStragglerConfig('g-1', false, 900);
    await reportStraggler('g-1', 'u-2', 901);
    await updateGroupTripDetails('g-1', 4, '2026-11-01');
    await setSolo('g-1', true);
    mockedSupabase.rpc.mockResolvedValueOnce({ data: { id: 'sg', name: 'Team', mode: 'collab', leader_id: null, parent_subgroup_id: null }, error: null });
    await expect(selfSplit('g-1', 'Team')).resolves.toMatchObject({ id: 'sg' });
    await expect(selfMerge('g-1')).resolves.toBeUndefined();
    expect(mockedSupabase.rpc).toHaveBeenCalledWith('set_journey_target', { p_group_id: 'g-1', p_destination_id: 'd-1' });
    expect(mockedSupabase.rpc).toHaveBeenCalledWith('report_straggler', { p_group_id: 'g-1', p_member_id: 'u-2', p_distance_m: 901 });

    mockIsDemoGroup.mockReturnValue(true);
    await setJourneyStatus('demo', 'paused');
    await setJourneyTarget('demo', null);
    await setSolo('demo', false);
    await expect(selfSplit('demo', 'Demo team')).resolves.toEqual(undefined);
    await expect(selfMerge('demo')).resolves.toBeUndefined();
    await expect(reportStraggler('demo', 'u-2')).resolves.toBeUndefined();
    await expect(updateGroupTripDetails('demo', 1, '2026-01-01')).resolves.toBeUndefined();
    expect(mockDemoSetJourneyStatus).toHaveBeenCalledWith('paused');
    expect(mockDemoSetJourneyTarget).toHaveBeenCalledWith(null);
    expect(mockDemoSetSolo).toHaveBeenCalledWith(false);
    expect(mockDemoSelfSplit).toHaveBeenCalledWith('Demo team');
    expect(mockDemoSelfMerge).toHaveBeenCalled();
  });
});
