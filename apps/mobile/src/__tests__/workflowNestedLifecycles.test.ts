import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useSubgroupActions } from '../screens/MapScreen/hooks/useSubgroupActions';
import { useCoordinationRequests } from '../screens/MapScreen/hooks/useCoordinationRequests';
import { useGatheringWorkflow } from '../screens/MapScreen/hooks/useGatheringWorkflow';

const mockSession = { user: { id: 'a' }, membership: { role: 'leader', group: { id: 'g1' } } };
const mockChannels = new Set<object>();
const mockListeners = new Set<(state: string) => void>();
const mockInvites = jest.fn(async (..._args: unknown[]) => []);
const mockCoordination = jest.fn(async (..._args: unknown[]) => []);
const mockArrivals = jest.fn(async (..._args: unknown[]) => []);
const mockCreateChannel = jest.fn(() => {
  const channel = {
    on: (..._args: unknown[]) => channel,
    subscribe: (status?: (value: string) => void) => { mockChannels.add(channel); status?.('SUBSCRIBED'); return channel; },
  };
  return channel;
});
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  AppState: { currentState: 'active', addEventListener: (_: string, listener: (state: string) => void) => {
    mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
  } },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null) } }));
jest.mock('../state/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../api/supabase', () => ({ supabase: { channel: () => mockCreateChannel(), removeChannel: (channel: object) => mockChannels.delete(channel) } }));
jest.mock('../api/demo', () => ({ isDemoGroup: () => false }));
jest.mock('../api/client', () => ({
  fetchMyInvites: (...args: unknown[]) => mockInvites(...args),
  fetchSentInvites: jest.fn(async () => []),
  fetchCoordinationRequests: (...args: unknown[]) => mockCoordination(...args),
  fetchCoordinationResponses: jest.fn(async () => []),
  fetchDestinationArrivals: (...args: unknown[]) => mockArrivals(...args),
  fetchPendingGatherPointRequests: jest.fn(async () => []),
}));
jest.mock('../state/coreDataSync', () => ({ getCoreOperationOutbox: () => ({ removeArrival: jest.fn() }) }));
jest.mock('../native', () => ({ notifications: { scheduleLocalNotification: jest.fn() } }));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn(), logError: jest.fn() }));
jest.mock('../utils/haptics', () => ({ mediumTap: jest.fn(), selectionTick: jest.fn() }));


(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const t = (key: string) => key;
const empty: [] = [];
function Surface({ groupId, userId, screen }: { groupId: string; userId: string; screen: string }) {
  const subgroup = useSubgroupActions({ groupId, userName: userId, members: empty, allSubgroups: empty,
    mySubgroupId: undefined, refresh: async () => true, t, onMergedBack: () => {} });
  const coordination = useCoordinationRequests({ groupId, userId });
  const gathering = useGatheringWorkflow({ groupId, userId, myScopeId: undefined,
    isMainLeader: true, isSubgroupLeader: false, canEditItinerary: true, t,
    arrivalOperations: empty, arrivalSessionScope: empty, rawDestinations: empty });
  return React.createElement(React.Fragment, null,
    subgroup.lifecycle, coordination.lifecycle, gathering.lifecycle,
    React.createElement(React.Fragment, { key: screen }));
}

it('installs nested invite and workflow repair jobs once, keeps them across screen branches and releases every resource', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(React.createElement(Surface, { groupId: 'g1', userId: 'a', screen: 'loading' })); });
    expect(mockChannels.size).toBe(3);
    expect(mockListeners.size).toBe(3);
    expect(mockCreateChannel).toHaveBeenCalledTimes(3);
    await act(async () => { tree.update(React.createElement(Surface, { groupId: 'g1', userId: 'a', screen: 'map' })); });
    expect(mockCreateChannel).toHaveBeenCalledTimes(3);
    await act(async () => { for (const listener of mockListeners) listener('active'); });
    expect(mockInvites).toHaveBeenCalledTimes(2);
    expect(mockCoordination).toHaveBeenCalledTimes(2);
    expect(mockArrivals).toHaveBeenCalledTimes(2);
    mockSession.user = { id: 'b' };
    mockSession.membership = { role: 'leader', group: { id: 'g2' } };
    await act(async () => { tree.update(React.createElement(Surface, { groupId: 'g2', userId: 'b', screen: 'empty' })); });
    expect(mockChannels.size).toBe(3);
    expect(mockListeners.size).toBe(3);
    expect(mockCreateChannel).toHaveBeenCalledTimes(6);
    await act(async () => { for (const listener of mockListeners) listener('active'); });
    expect(mockInvites).toHaveBeenLastCalledWith('b');
    expect(mockCoordination).toHaveBeenLastCalledWith('g2');
    expect(mockArrivals).toHaveBeenLastCalledWith('g2');
  } finally {
    await act(async () => { tree.unmount(); });
    expect(mockChannels.size).toBe(0);
    expect(mockListeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  }
});

it('replays nested workflow setup and cleanup under StrictMode without losing foreground ownership', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  mockSession.user = { id: 'strict' };
  mockSession.membership = { role: 'leader', group: { id: 'strict-group' } };
  const before = mockArrivals.mock.calls.length;
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(React.createElement(React.StrictMode, null,
      React.createElement(Surface, { groupId: 'strict-group', userId: 'strict', screen: 'map' }))); });
    expect(mockChannels.size).toBe(3);
    expect(mockListeners.size).toBe(3);
    expect(mockArrivals.mock.calls.length - before).toBeGreaterThanOrEqual(2);
  } finally {
    await act(async () => { tree.unmount(); });
    expect(mockChannels.size).toBe(0);
    expect(mockListeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  }
});
