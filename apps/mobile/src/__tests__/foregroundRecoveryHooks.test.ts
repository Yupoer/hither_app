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
const mockSubscribe = jest.fn(async (_session: string, callback: any, handlers: any): Promise<() => void> => { mockNavCallback = callback; mockNavHandlers = handlers; return mockUnsubscribe; });
const mockSession: any = { user: { id: 'me' }, membership: { group: { id: 'g' } } };
const mockInvites = jest.fn(async (): Promise<any[]> => []);
const mockAccept = jest.fn(async () => {}), mockDecline = jest.fn(async () => {});
const mockNotify = jest.fn(async () => {});
jest.mock('react-native', () => ({ AppState: mockApp }));
jest.mock('../api/supabase', () => ({ supabase: mockSupabase }));
jest.mock('../api/services/NavigationService', () => ({ listNavigationMemberStates: (...args: any[]) => (mockNavRows as any)(...args),
  subscribeSessionMemberStates: (session: string, callback: any, handlers: any) => mockSubscribe(session, callback, handlers) }));
jest.mock('../api/client', () => ({ fetchMyInvites: (...args: any[]) => (mockInvites as any)(...args), acceptSubgroupInvite: mockAccept, declineSubgroupInvite: mockDecline }));
jest.mock('../api/demo', () => ({ isDemoGroup: () => false }));
jest.mock('../state/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../native', () => ({ notifications: { scheduleLocalNotification: mockNotify } }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: async () => null, setItem: async () => {} }));
import { useOrganizerExceptions } from '../state/useOrganizerExceptions';
import { useSubgroupInvites } from '../state/useSubgroupInvites';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => { mockNavRows.mockReset(); mockNavRows.mockResolvedValue([]); mockSubscribe.mockClear(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-30T00:10:00Z')); jest.clearAllMocks(); mockChannels.length = 0; mockListeners.clear(); mockApp.currentState = 'active'; });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
async function appState(state: string) { await act(async () => { mockApp.currentState = state; for (const listener of mockListeners) listener(state); }); }

test('organizer recovery retains older unhandled help, follows navigation, resumes and isolates teams', async () => {
  const members = ['leader', 'A', 'B'].map(userId => ({ userId, name: userId, role: userId === 'leader' ? 'leader' : 'follower', status: 'active' }));
  let options: any = { groupId: 'g', groupState: { group: { id: 'g' }, members }, leaderUserId: 'leader', navigationSessionId: 'n',
    gatheringPoint: { id: 'd', title: 'Meeting', meetAt: '2026-09-30T00:09:00Z' }, stragglers: [{ userId: 'B', name: 'B', distanceM: 1000 }] };
  mockHelp.mockResolvedValue({ data: [{ sender_id: 'A', created_at: '2026-09-30T00:00:00Z' }], error: null });
  let api!: ReturnType<typeof useOrganizerExceptions>;
  function Harness() { api = useOrganizerExceptions(options); return api.lifecycle; }
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
  function Harness() { api = useSubgroupInvites(); return api.lifecycle; }
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

test('organizer releases a late subscription and rejects old session reads, ready and remove callbacks', async () => {
  let finishSubscription!: (cleanup: () => void) => void;
  let finishRows!: (rows: any[]) => void;
  let oldCallback!: (row: any) => void;
  let oldHandlers: any;
  const lateCleanup = jest.fn();
  mockSubscribe.mockImplementationOnce((_session, callback, handlers) => {
    oldCallback = callback; oldHandlers = handlers;
    return new Promise(resolve => { finishSubscription = resolve; });
  });
  mockNavRows.mockImplementationOnce(() => new Promise(resolve => { finishRows = resolve; }));
  let options: any = { groupId: 'g', groupState: { group: { id: 'g' }, members: [
    { userId: 'B', name: 'B', role: 'follower', status: 'active' },
  ] }, navigationSessionId: 'old', stragglers: [], nowMs: Date.now() };
  let api!: ReturnType<typeof useOrganizerExceptions>;
  function Probe() { api = useOrganizerExceptions(options); return api.lifecycle; }
  let root!: ReactTestRenderer;
  await act(async () => { root = create(React.createElement(Probe)); });
  options = { ...options, navigationSessionId: 'new' };
  await act(async () => { root.update(React.createElement(Probe)); });
  await act(async () => {
    mockNavCallback({ userId: 'B', localStatus: 'permission_denied', updatedAt: new Date().toISOString() });
  });
  expect(api.exceptions.length).toBeGreaterThan(0);
  const reads = mockNavRows.mock.calls.length;
  await act(async () => {
    finishSubscription(lateCleanup);
    finishRows([{ userId: 'B', localStatus: 'tracking' }]);
    oldCallback({ userId: 'B', localStatus: 'tracking' });
    oldHandlers.onReady(); oldHandlers.onRemove('B');
  });
  expect(lateCleanup).toHaveBeenCalledTimes(1);
  expect(mockNavRows).toHaveBeenCalledTimes(reads);
  expect(api.exceptions.length).toBeGreaterThan(0);
  options = { ...options, enabled: false, navigationSessionId: null };
  await act(async () => { root.update(React.createElement(Probe)); });
  expect(api.exceptions).toEqual([]);
  expect(mockUnsubscribe).toHaveBeenCalled();
  await act(async () => root.unmount());
  expect(mockListeners.size).toBe(0);
});

test('organizer preserves continuous firstSeen across same and equal new inputs and starts a new episode after leave', async () => {
  const startedAt = Date.now();
  let options: any = { groupId: 'g-observation', groupState: { group: { id: 'g-observation' }, members: [
    { userId: 'B', name: 'B', role: 'follower', status: 'active' },
  ] }, stragglers: [{ userId: 'B', name: 'B', distanceM: 1000 }], nowMs: startedAt };
  let api!: ReturnType<typeof useOrganizerExceptions>;
  function Probe() { api = useOrganizerExceptions(options); return api.lifecycle; }
  let root!: ReactTestRenderer;
  await act(async () => { root = create(React.createElement(React.StrictMode, null, React.createElement(Probe))); });
  expect(api.exceptions).toHaveLength(1);
  const original = api.exceptions[0].firstSeenAt;
  await act(async () => { root.update(React.createElement(React.StrictMode, null, React.createElement(Probe))); });
  expect(api.exceptions[0].firstSeenAt).toBe(original);
  options = { ...options, stragglers: options.stragglers.map((item: object) => ({ ...item })), nowMs: startedAt + 30_000 };
  await act(async () => { root.update(React.createElement(React.StrictMode, null, React.createElement(Probe))); });
  expect(api.exceptions[0].firstSeenAt).toBe(original);
  options = { ...options, stragglers: [], nowMs: startedAt + 60_000 };
  await act(async () => { root.update(React.createElement(React.StrictMode, null, React.createElement(Probe))); });
  options = { ...options, stragglers: [{ userId: 'B', name: 'B', distanceM: 1000 }], nowMs: startedAt + 90_000 };
  await act(async () => { root.update(React.createElement(React.StrictMode, null, React.createElement(Probe))); });
  expect(api.exceptions).toHaveLength(1);
  expect(api.exceptions[0].firstSeenAt).toBe(new Date(startedAt + 90_000).toISOString());
  await act(async () => root.unmount());
  expect(mockListeners.size).toBe(0);
});

test('organizer does not publish abandoned straggler observations', async () => {
  const startedAt = Date.now();
  const stragglers = [{ userId: 'B', name: 'B', distanceM: 1000 }];
  let options: any = { groupId: 'g-abandoned', groupState: { group: { id: 'g-abandoned' }, members: [
    { userId: 'B', name: 'B', role: 'follower', status: 'active' },
  ] }, stragglers, nowMs: startedAt };
  let suspend = false;
  const never = new Promise<void>(() => undefined);
  let api!: ReturnType<typeof useOrganizerExceptions>;
  function Probe() {
    api = useOrganizerExceptions(options);
    if (suspend) throw never;
    return api.lifecycle;
  }
  const tree = () => React.createElement(React.Suspense, { fallback: null }, React.createElement(Probe));
  let root!: ReactTestRenderer;
  await act(async () => { root = create(tree()); });
  const firstSeen = api.exceptions[0].firstSeenAt;
  suspend = true;
  options = { ...options, stragglers: [], nowMs: startedAt + 30_000 };
  await act(async () => { root.update(tree()); });
  suspend = false;
  options = { ...options, stragglers, nowMs: startedAt + 60_000 };
  await act(async () => { root.update(tree()); });
  expect(api.exceptions[0].firstSeenAt).toBe(firstSeen);
  await act(async () => root.unmount());
});
