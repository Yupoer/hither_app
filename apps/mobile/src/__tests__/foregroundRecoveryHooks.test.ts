import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockListeners = new Set<(state: string) => void>();
const mockApp = { currentState: 'active', addEventListener: (_: string, callback: (state: string) => void) => {
  mockListeners.add(callback); return { remove: () => mockListeners.delete(callback) };
} };
const mockChannels: any[] = [];
const mockHelp = jest.fn(async (): Promise<any> => ({ data: [], error: null }));
const mockSupabase = { from: () => {
  const query: any = { select: () => query, eq: () => query, gte: () => query, order: () => query, limit: mockHelp };
  return query;
}, channel: (name: string) => {
  const channel: any = { name, events: [], on: (_: string, filter: any, callback: any) => { channel.events.push({ filter, callback }); return channel; },
    subscribe: (callback: any) => { channel.ready = callback; return channel; } };
  mockChannels.push(channel); return channel;
}, removeChannel: jest.fn() };
const mockNavRows = jest.fn(async (): Promise<any[]> => []);
let mockNavCallback: any, mockNavHandlers: any;
const mockUnsubscribe = jest.fn();
const mockSession: any = { user: { id: 'me' }, membership: { group: { id: 'g' } } };
const mockInvites = jest.fn(async (): Promise<any[]> => []);
const mockAccept = jest.fn(async () => {}), mockDecline = jest.fn(async () => {});
const mockNotify = jest.fn(async () => {});
jest.mock('react-native', () => ({ AppState: mockApp }));
jest.mock('../api/supabase', () => ({ supabase: mockSupabase }));
jest.mock('../api/services/NavigationService', () => ({ listNavigationMemberStates: (...args: any[]) => (mockNavRows as any)(...args),
  subscribeSessionMemberStates: async (_: string, callback: any, handlers: any) => { mockNavCallback = callback; mockNavHandlers = handlers; return mockUnsubscribe; } }));
jest.mock('../api/client', () => ({ fetchMyInvites: (...args: any[]) => (mockInvites as any)(...args), acceptSubgroupInvite: mockAccept, declineSubgroupInvite: mockDecline }));
jest.mock('../api/demo', () => ({ isDemoGroup: () => false }));
jest.mock('../state/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../native', () => ({ notifications: { scheduleLocalNotification: mockNotify } }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: async () => null, setItem: async () => {} }));
import { useOrganizerExceptions } from '../state/useOrganizerExceptions';
import { useSubgroupInvites } from '../state/useSubgroupInvites';

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-30T00:10:00Z')); jest.clearAllMocks(); mockChannels.length = 0; mockListeners.clear(); mockApp.currentState = 'active'; });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
async function appState(state: string) { await act(async () => { mockApp.currentState = state; for (const listener of mockListeners) listener(state); }); }

test('organizer recovery retains older unhandled help, follows navigation, resumes and isolates teams', async () => {
  const members = ['leader', 'A', 'B'].map(userId => ({ userId, name: userId, role: userId === 'leader' ? 'leader' : 'follower', status: 'active' }));
  let options: any = { groupId: 'g', groupState: { group: { id: 'g' }, members }, leaderUserId: 'leader', navigationSessionId: 'n',
    gatheringPoint: { id: 'd', title: 'Meeting', meetAt: '2026-09-30T00:09:00Z' }, stragglers: [{ userId: 'B', name: 'B', distanceM: 1000 }] };
  mockHelp.mockResolvedValue({ data: [{ sender_id: 'A', created_at: '2026-09-30T00:00:00Z' }], error: null });
  let api!: ReturnType<typeof useOrganizerExceptions>;
  function Harness() { api = useOrganizerExceptions(options); return null; }
  let root!: ReactTestRenderer;
  await act(async () => { root = create(React.createElement(Harness)); });
  expect(api.exceptions.some(item => item.memberId === 'A')).toBe(true);
  const helpChannel = mockChannels[0];
  await act(async () => {
    helpChannel.events[0].callback({ new: { sender_id: 'B', type: 'need_help', created_at: '2026-09-30T00:09:00Z' } });
    mockNavCallback({ userId: 'B', localStatus: 'permission_denied', updatedAt: '2026-09-30T00:09:00Z' });
    mockNavCallback({ userId: 'B', localStatus: 'tracking', updatedAt: '2026-09-30T00:09:30Z' });
  });
  mockHelp.mockResolvedValue({ data: Array.from({ length: 50 }, () => ({ sender_id: 'B', created_at: '2026-09-30T00:08:00Z' })), error: null });
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
  expect(api.exceptions.some(item => item.memberId === 'A')).toBe(true);
  const key = api.exceptions[0].rootCauseKey;
  await act(async () => { expect(await api.markHandled(key, 'acknowledge')).toBe(true); });
  expect(api.pendingKeys.size).toBe(0);
  expect(api.handling[key].status).toBe('acknowledged');
  await appState('background'); const reads = mockHelp.mock.calls.length;
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
  expect(mockHelp).toHaveBeenCalledTimes(reads);
  await appState('active');
  expect(mockHelp.mock.calls.length).toBeGreaterThan(reads);
  await act(async () => { helpChannel.ready('SUBSCRIBED'); mockNavHandlers.onReady(); mockNavHandlers.onRemove('B'); });
  mockHelp.mockResolvedValue({ data: [], error: null });
  options = { ...options, groupId: 'other', groupState: { group: { id: 'other' }, members: [] }, navigationSessionId: null, stragglers: [] };
  await act(async () => { root.update(React.createElement(Harness)); });
  await act(async () => { helpChannel.events[0].callback({ new: { sender_id: 'A', type: 'need_help' } }); });
  expect(api.exceptions).toEqual([]);
  expect(mockUnsubscribe).toHaveBeenCalled();
  options = { ...options, groupId: null, enabled: false };
  await act(async () => { root.update(React.createElement(Harness)); });
  await act(async () => { expect(await api.markHandled('unknown', 'resolve')).toBe(false); root.unmount(); });
});

test('invite recovery keeps cached rows on failure, deduplicates notices and rejects a late old-account read', async () => {
  mockSession.user = { id: 'me' }; mockSession.membership = { group: { id: 'g' } };
  mockInvites.mockResolvedValue([{ id: 'initial', inviterName: 'Leader', subgroupName: 'Team' }]);
  let api!: ReturnType<typeof useSubgroupInvites>;
  function Harness() { api = useSubgroupInvites(); return null; }
  let root!: ReactTestRenderer;
  await act(async () => { root = create(React.createElement(Harness)); });
  expect(api.invites.map(row => row.id)).toEqual(['initial']); expect(mockNotify).not.toHaveBeenCalled();
  mockInvites.mockResolvedValue([{ id: 'new', inviterName: 'Leader', subgroupName: 'Team' }]);
  await act(async () => { mockChannels[0].ready('SUBSCRIBED'); mockChannels[0].events[0].callback({}); await jest.advanceTimersByTimeAsync(300); });
  expect(api.invites[0].id).toBe('new'); expect(mockNotify).toHaveBeenCalledTimes(1);
  mockInvites.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await api.refresh(); }); expect(api.invites[0].id).toBe('new');
  await act(async () => { await api.accept('new'); await api.decline('new'); });
  expect(mockAccept).toHaveBeenCalledWith('new'); expect(mockDecline).toHaveBeenCalledWith('new');
  expect(mockNotify).toHaveBeenCalledTimes(1);
  let settle!: (rows: any[]) => void;
  mockInvites.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  await act(async () => { void api.refresh(); });
  mockSession.user = { id: 'another' }; mockSession.membership = { group: { id: 'other' } }; mockInvites.mockResolvedValue([]);
  await act(async () => { root.update(React.createElement(Harness)); });
  await act(async () => { settle([{ id: 'old-account' }]); }); expect(api.invites).toEqual([]);
  await appState('background'); await appState('active');
  mockSession.user = null;
  await act(async () => { root.update(React.createElement(Harness)); });
  expect(api.invites).toEqual([]);
  await act(async () => root.unmount());
});
