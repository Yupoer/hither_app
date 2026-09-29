const mockRows: Record<string, any> = {};
const mockFilters: any[] = [];
const mockChannels: any[] = [];
const mockRemove = jest.fn();
const mockRpc = jest.fn();
const mockSupabase = { rpc: mockRpc, from: (table: string) => {
  const query: any = { select: () => query, eq: (key: string, value: unknown) => { mockFilters.push([table, key, value]); return query; },
    is: (key: string, value: unknown) => { mockFilters.push([table, key, value]); return query; },
    gt: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: mockRows[table], error: null }),
    upsert: async (row: unknown) => { mockRows[table] = row; return { error: null }; },
    then: (resolve: any) => Promise.resolve({ data: mockRows[table], error: null }).then(resolve) };
  return query;
}, channel: (name: string) => {
  const channel: any = { name, events: [], on: (_: string, filter: unknown, callback: any) => { channel.events.push({ filter, callback }); return channel; }, subscribe: (callback: any) => { channel.ready = callback; return channel; } };
  mockChannels.push(channel); return channel;
}, removeChannel: mockRemove };
jest.mock('../api/supabase', () => ({ supabase: mockSupabase }));
jest.mock('../api/services/_helpers', () => ({ requireUserId: async () => 'me', orThrow: (error: any) => { if (error) throw error; } }));
import { completeNavigationSession, getActiveNavigationSession, getBackgroundNavigationContext, getLocationSharingEnabled, getMyNavigationMemberState,
  listNavigationMemberStates, setLocationSharingEnabled, subscribeNavigationSession, subscribeSessionMemberStates } from '../api/services/NavigationService';
const session = { id: 's', group_id: 'g', scope_subgroup_id: 'sub', destination_id: 'd', destination_name: 'Meet', destination_latitude: 25, destination_longitude: 121, arrival_radius_m: 50, version: 1, status: 'active' };
const member = { navigation_session_id: 's', user_id: 'me', local_status: 'tracking_active', updated_at: '2026-09-30T00:00:00Z' };

test('recovery reads the proper subgroup and honors membership, privacy and closed targets', async () => {
  mockRows.memberships = { subgroup_id: 'sub', solo: false }; mockRows.member_privacy_settings = { sharing_enabled: true };
  mockRows.navigation_sessions = session; mockRows.itinerary_items = { id: 'd', title: 'Meet', latitude: 25, longitude: 121, day: 1, subgroup_id: 'sub' };
  expect(await getBackgroundNavigationContext('g')).toMatchObject({ actorId: 'me', hasMembership: true, target: { id: 'd' }, session: { scopeSubgroupId: 'sub' } });
  expect(mockFilters).toContainEqual(['navigation_sessions', 'scope_subgroup_id', 'sub']);
  await getActiveNavigationSession('g', null);
  expect(mockFilters).toContainEqual(['navigation_sessions', 'scope_subgroup_id', null]);
  await expect(setLocationSharingEnabled(false, 'another')).rejects.toThrow('location_privacy_account_changed');
  await setLocationSharingEnabled(false, 'me'); expect(await getLocationSharingEnabled()).toBe(false);
  expect((await getBackgroundNavigationContext('g')).session).toBeNull();
  await setLocationSharingEnabled(true, 'me'); mockRows.itinerary_items.closed_at = 'closed';
  expect((await getBackgroundNavigationContext('g')).target).toBeNull();
  mockRows.memberships = null;
  expect((await getBackgroundNavigationContext('g')).hasMembership).toBe(false);
  mockRows.navigation_member_states = member;
  expect(await getMyNavigationMemberState('s')).toMatchObject({ userId: 'me' });
  mockRows.navigation_member_states = [member];
  expect(await listNavigationMemberStates('s')).toHaveLength(1);
  mockRpc.mockResolvedValue({ data: { ...session, status: 'completed' }, error: null });
  expect(await completeNavigationSession('s', 1)).toMatchObject({ status: 'completed' });
});

test('independent session subscriptions preserve scope, reconnect callbacks and explicit member removals', async () => {
  const onSession = jest.fn(), onMember = jest.fn(), onReady = jest.fn(), onRemove = jest.fn();
  const stop = await subscribeNavigationSession('g', onSession, onMember, 'sub', onReady);
  const stopOther = await subscribeNavigationSession('g', onSession, onMember, null, onReady);
  const stopMembers = await subscribeSessionMemberStates('s', onMember, { onReady, onRemove });
  expect(new Set(mockChannels.map(channel => channel.name)).size).toBe(3);
  mockChannels[0].ready('SUBSCRIBED'); mockChannels[2].ready('SUBSCRIBED'); expect(onReady).toHaveBeenCalledTimes(2);
  mockChannels[0].events[0].callback({ new: { ...session, scope_subgroup_id: 'wrong' } }); expect(onSession).not.toHaveBeenCalled();
  mockChannels[0].events[0].callback({ new: session }); expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ id: 's', scopeSubgroupId: 'sub' }));
  mockChannels[0].events[1].callback({ new: member });
  mockChannels[2].events[0].callback({ eventType: 'UPDATE', new: member }); expect(onMember).toHaveBeenCalledTimes(2);
  mockChannels[2].events[0].callback({ eventType: 'DELETE', old: { user_id: 'me' } }); expect(onRemove).toHaveBeenCalledWith('me');
  stop(); stopOther(); stopMembers(); expect(mockRemove).toHaveBeenCalledTimes(3);
});
