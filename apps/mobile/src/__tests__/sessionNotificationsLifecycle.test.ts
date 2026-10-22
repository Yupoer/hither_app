import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { PendingInvite } from '../types';

const mockSession: { user: { id: string } | null; membership: { role: string; group: { id: string } } | null } = {
  user: { id: 'a' }, membership: { role: 'leader', group: { id: 'g' } },
};
const mockSessionContext = React.createContext(mockSession);
const mockActiveChannels = new Set<object>();
const mockPushListeners = new Set<() => void>();
const mockAppListeners = new Set<(state: string) => void>();
const mockFetch = jest.fn(async (): Promise<PendingInvite[]> => []);
const mockNotify = jest.fn(async (_payload: unknown) => null);
const mockSave = jest.fn(async (..._args: unknown[]) => undefined);
const mockPermission = jest.fn(async () => true);
const mockChannel = jest.fn(() => {
  const channel: { on: jest.Mock; subscribe: jest.Mock } = {
    on: jest.fn(() => channel),
    subscribe: jest.fn(() => { mockActiveChannels.add(channel); return channel; }),
  };
  return channel;
});
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { currentState: 'active', addEventListener: (_event: string, listener: (state: string) => void) => {
    mockAppListeners.add(listener); return { remove: () => mockAppListeners.delete(listener) };
  } },
}));
jest.mock('../state/SessionContext', () => ({ useSession: () => React.useContext(mockSessionContext) }));
jest.mock('../api/supabase', () => ({ supabase: {
  channel: mockChannel, removeChannel: (channel: object) => mockActiveChannels.delete(channel),
} }));
jest.mock('../api/client', () => ({
  fetchMyInvites: () => mockFetch(), savePushToken: (...args: unknown[]) => mockSave(...args),
}));
jest.mock('../api/demo', () => ({ isDemoGroup: () => false }));
jest.mock('../native', () => ({ notifications: {
  requestPermission: () => mockPermission(), getDevicePushToken: async () => 'native-token',
  scheduleLocalNotification: (payload: unknown) => mockNotify(payload),
  addForegroundListener: (listener: () => void) => {
    mockPushListeners.add(listener); return () => mockPushListeners.delete(listener);
  },
} }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { SessionNotifications } from '../state/SessionNotifications';
import { useSubgroupInvites } from '../state/useSubgroupInvites';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  expect(mockActiveChannels.size).toBe(0);
  expect(mockPushListeners.size).toBe(0);
  expect(mockAppListeners.size).toBe(0);
  mockChannel.mockClear();
  mockSave.mockClear();
  mockNotify.mockClear();
  mockFetch.mockReset().mockResolvedValue([]);
  mockSession.user = { id: 'a' };
  mockSession.membership = { role: 'leader', group: { id: 'g' } };
});

function Surface({ screen }: { screen: string }) {
  return React.createElement(mockSessionContext.Provider, { value: { ...mockSession } },
    React.createElement(SessionNotifications), React.createElement(React.Fragment, { key: screen }));
}

const suspended = new Promise<never>(() => undefined);
function InviteSnapshot(_props: { ids: string[] }) { return null; }
function InviteProbe({ suspend }: { suspend: boolean }) {
  const invites = useSubgroupInvites();
  if (suspend) throw suspended;
  return React.createElement(React.Fragment, null, invites.lifecycle,
    React.createElement(InviteSnapshot, { ids: invites.invites.map(invite => invite.id) }));
}
function InviteSurface({ actorId, suspend = false }: { actorId: string; suspend?: boolean }) {
  return React.createElement(mockSessionContext.Provider, {
    value: { user: { id: actorId }, membership: { role: 'leader', group: { id: 'g' } } },
  }, React.createElement(React.Suspense, { fallback: null }, React.createElement(InviteProbe, { suspend })));
}
const inviteA: PendingInvite = { id: 'invite-a', groupId: 'g', subgroupId: 'team', inviterId: 'leader',
  inviteeId: 'a', status: 'pending', subgroupName: 'Team', inviterName: 'Leader' };

it('keeps the committed account read alive when a different account render is discarded', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  let resolve!: (rows: PendingInvite[]) => void;
  const response = new Promise<PendingInvite[]>(done => { resolve = done; });
  mockFetch.mockReset().mockImplementation(async () => []).mockImplementationOnce(() => response);
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(React.createElement(InviteSurface, { actorId: 'a' })); });
    await act(async () => { React.startTransition(() => tree.update(React.createElement(InviteSurface, { actorId: 'b', suspend: true }))); });
    await act(async () => { resolve([inviteA]); });
    expect(tree.root.findByType(InviteSnapshot).props.ids).toEqual(['invite-a']);
  } finally {
    await act(async () => { tree?.unmount(); });
    jest.useRealTimers();
  }
});

it('rejects a retired account lease after committed A to B to A transitions', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  let resolve!: (rows: PendingInvite[]) => void;
  const response = new Promise<PendingInvite[]>(done => { resolve = done; });
  mockFetch.mockReset().mockImplementation(async () => []).mockImplementationOnce(() => response);
  mockNotify.mockClear();
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(React.createElement(InviteSurface, { actorId: 'a' })); });
    await act(async () => { tree.update(React.createElement(InviteSurface, { actorId: 'b' })); });
    await act(async () => { tree.update(React.createElement(InviteSurface, { actorId: 'a' })); });
    await act(async () => { resolve([inviteA]); });
    expect(tree.root.findByType(InviteSnapshot).props.ids).toEqual([]);
    expect(mockNotify).not.toHaveBeenCalled();
  } finally {
    await act(async () => { tree?.unmount(); });
    jest.useRealTimers();
  }
});

it('keeps one installed notification lifetime through screen branches and rapid account transitions', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(Surface, { screen: 'splash' })); });
  expect(mockActiveChannels.size).toBe(2);
  expect(mockPushListeners.size).toBe(1);
  expect(mockAppListeners.size).toBe(1);
  expect(mockSave).toHaveBeenCalledWith('native-token', 'ios', 'a');
  for (const screen of ['recovery', 'onboarding', 'map']) {
    mockSession.user = { id: 'a' };
    await act(async () => { tree.update(React.createElement(Surface, { screen })); });
    expect(mockChannel).toHaveBeenCalledTimes(2);
  }
  mockSession.user = { id: 'b' };
  await act(async () => { tree.update(React.createElement(Surface, { screen: 'map' })); });
  expect(mockActiveChannels.size).toBe(2);
  expect(mockPushListeners.size).toBe(1);
  expect(mockSave).toHaveBeenCalledWith('native-token', 'ios', 'b');
  mockSession.user = null;
  mockSession.membership = null;
  await act(async () => { tree.update(React.createElement(Surface, { screen: 'login' })); });
  expect(mockActiveChannels.size).toBe(0);
  expect(mockPushListeners.size).toBe(0);
  expect(mockAppListeners.size).toBe(0);
  await act(async () => { tree.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
