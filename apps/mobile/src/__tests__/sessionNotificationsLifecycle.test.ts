import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockSession: { user: { id: string } | null; membership: { role: string; group: { id: string } } | null } = {
  user: { id: 'a' }, membership: { role: 'leader', group: { id: 'g' } },
};
const mockActiveChannels = new Set<object>();
const mockPushListeners = new Set<() => void>();
const mockAppListeners = new Set<(state: string) => void>();
const mockFetch = jest.fn(async () => []);
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
jest.mock('../state/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../api/supabase', () => ({ supabase: {
  channel: mockChannel, removeChannel: (channel: object) => mockActiveChannels.delete(channel),
} }));
jest.mock('../api/client', () => ({
  fetchMyInvites: () => mockFetch(), savePushToken: (...args: unknown[]) => mockSave(...args),
}));
jest.mock('../api/demo', () => ({ isDemoGroup: () => false }));
jest.mock('../native', () => ({ notifications: {
  requestPermission: () => mockPermission(), getDevicePushToken: async () => 'native-token',
  addForegroundListener: (listener: () => void) => {
    mockPushListeners.add(listener); return () => mockPushListeners.delete(listener);
  },
} }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { SessionNotifications } from '../state/SessionNotifications';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Surface({ screen }: { screen: string }) {
  return React.createElement(React.Fragment, null, React.createElement(SessionNotifications),
    React.createElement(React.Fragment, { key: screen }));
}

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
