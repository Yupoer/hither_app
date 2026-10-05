import React from 'react';
const mockListeners = new Set<() => void>();
const mockApp = { currentState: 'active', addEventListener: (_: string, callback: () => void) => {
  mockListeners.add(callback); return { remove: () => mockListeners.delete(callback) };
} };
const mockNative = {
  endGroupActivity: jest.fn(async () => {}), endAllGroupActivities: jest.fn(async () => {}),
  startGroupActivity: jest.fn(async () => ({ activityId: 'activity' })),
  listGroupActivities: jest.fn(async () => []), updateGroupActivity: jest.fn(async () => {}),
  observeExistingActivities: jest.fn(async () => {}),
  addPushTokenListener: () => ({ remove() {} }), addPushToStartTokenListener: () => ({ remove() {} }),
  startPushToStartTokenObservation: jest.fn(async () => {}),
};
const mockDeleteMySessions = jest.fn(async () => {});
jest.mock('react-native', () => ({ AppState: mockApp, Platform: { OS: 'ios' } }));
jest.mock('../native', () => ({ liveActivity: mockNative }));
jest.mock('../api/services/LiveActivityService', () => ({
  deleteLiveActivitySession: jest.fn(async () => {}), deleteMyLiveActivitySessions: mockDeleteMySessions,
  getOrCreateLiveActivityDeviceId: jest.fn(async () => 'device'), upsertLiveActivitySession: jest.fn(async () => {}),
}));
jest.mock('../state/SessionContext', () => ({ useSession: () => ({ user: null }) }));
jest.mock('../state/diagnostics', () => ({ diagnostics: { write: jest.fn(async () => {}) } }));
import { useLiveActivity, clearLiveActivities } from '../state/useLiveActivity';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('flushes the final throttled update and sends the same deadline immediately on resume', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  jest.setSystemTime(100000);
  function Harness({ progress }: { progress: number }) {
    useLiveActivity(true, { groupName: 'Team', distanceMeters: 900, etaSeconds: 600,
      sampledAtMs: 100000, etaTargetAtMs: 700000, progress },
    { groupId: 'team', destinationId: 'stop', initialDistanceM: 1000, travelMode: 'walk' });
    return null;
  }
  let tree: any;
  await act(async () => { tree = create(React.createElement(Harness, { progress: 0 })); });
  await act(async () => { tree.update(React.createElement(Harness, { progress: 0.1 })); });
  const firstCount = mockNative.updateGroupActivity.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(1000); tree.update(React.createElement(Harness, { progress: 0.2 })); });
  expect(mockNative.updateGroupActivity).toHaveBeenCalledTimes(firstCount);
  await act(async () => { jest.advanceTimersByTime(9000); });
  expect(mockNative.updateGroupActivity).toHaveBeenLastCalledWith('activity', expect.objectContaining({ progress: 0.2, etaTargetAtMs: 700000 }));
  await act(async () => { tree.update(React.createElement(Harness, { progress: 0.3 })); });
  expect(jest.getTimerCount()).toBe(1);
  await act(async () => { mockApp.currentState = 'background'; mockListeners.forEach(cb => cb()); });
  expect(jest.getTimerCount()).toBe(0);
  const hiddenCount = mockNative.updateGroupActivity.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(120000); });
  expect(mockNative.updateGroupActivity).toHaveBeenCalledTimes(hiddenCount);
  await act(async () => { mockApp.currentState = 'active'; mockListeners.forEach(cb => cb()); });
  expect(mockNative.updateGroupActivity).toHaveBeenCalledTimes(hiddenCount + 1);
  expect(mockNative.updateGroupActivity).toHaveBeenLastCalledWith('activity', expect.objectContaining({ progress: 0.3, etaTargetAtMs: 700000 }));
  await act(async () => { tree.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

it('terminal cleanup ends native activities without entering the authenticated session-delete path', async () => {
  mockNative.endAllGroupActivities.mockClear();
  mockDeleteMySessions.mockClear();
  await clearLiveActivities({ localOnly: true });
  expect(mockNative.endAllGroupActivities).toHaveBeenCalledTimes(1);
  expect(mockDeleteMySessions).not.toHaveBeenCalled();
  await clearLiveActivities();
  expect(mockNative.endAllGroupActivities).toHaveBeenCalledTimes(2);
  expect(mockDeleteMySessions).toHaveBeenCalledTimes(1);
});
