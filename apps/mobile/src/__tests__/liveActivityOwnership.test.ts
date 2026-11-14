import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockNative = {
  completeGroupActivity: jest.fn(async () => {}),
  endGroupActivity: jest.fn(async () => {}), endAllGroupActivities: jest.fn(async () => {}),
  startGroupActivity: jest.fn(async (): Promise<{ activityId: string } | null> => ({ activityId: 'activity' })),
  listGroupActivities: jest.fn(async () => [] as { activityId: string; destinationId?: string; navigationSessionId?: string }[]),
  updateGroupActivity: jest.fn(async () => {}), observeExistingActivities: jest.fn(async () => {}),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushToStartTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  startPushToStartTokenObservation: jest.fn(async () => {}),
};
jest.mock('react-native', () => ({ AppState: { currentState: 'active' }, Platform: { OS: 'ios' } }));
jest.mock('../native', () => ({ liveActivity: mockNative }));
jest.mock('../api/services/LiveActivityService', () => ({
  deleteLiveActivitySession: jest.fn(async () => {}), deleteMyLiveActivitySessions: jest.fn(async () => {}),
  deleteMyLiveActivitySessionsForGroups: jest.fn(async () => {}),
  getOrCreateLiveActivityDeviceId: jest.fn(async () => 'device'),
  upsertLiveActivitySession: jest.fn(async () => {}),
}));
jest.mock('../state/SessionContext', () => ({ useSession: () => ({ user: null }) }));
jest.mock('../state/diagnostics', () => ({ diagnostics: { write: jest.fn(async () => {}) } }));
jest.mock('../utils/liveActivityTokenGate', () => ({ getSharedLiveActivityTokenGate: jest.fn() }));
import { LiveActivityRuntime } from '../state/useLiveActivity';

function Harness({ active }: { active: boolean | undefined }) {
  return React.createElement(LiveActivityRuntime, {
    active: active,
    state: { groupName: 'Team' },
    session: { groupId: 'team', navigationSessionId: 'nav-1', destinationId: 'stop', initialDistanceM: 100, travelMode: 'walk' },
  });
}

it('preserves on unmount/hydration, adopts on return, and ends on an explicit stop', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let view!: ReactTestRenderer;
  await act(async () => { view = create(React.createElement(Harness, { active: true })); });
  expect(mockNative.startGroupActivity).toHaveBeenCalledTimes(1);
  mockNative.endAllGroupActivities.mockClear();
  await act(async () => view.unmount());
  expect(mockNative.endAllGroupActivities).not.toHaveBeenCalled();
  mockNative.listGroupActivities.mockResolvedValue([{ activityId: 'activity', destinationId: 'stop', navigationSessionId: 'nav-1' }]);
  await act(async () => { view = create(React.createElement(Harness, { active: undefined })); });
  expect(mockNative.endAllGroupActivities).not.toHaveBeenCalled();
  await act(async () => view.update(React.createElement(Harness, { active: true })));
  expect(mockNative.startGroupActivity).toHaveBeenCalledTimes(1);
  await act(async () => view.update(React.createElement(Harness, { active: false })));
  expect(mockNative.endGroupActivity).toHaveBeenCalledWith('activity');
  await act(async () => view.unmount());
});

it('the real hook replaces the native owner when only the session changes at the same destination', async () => {
  jest.clearAllMocks();
  mockNative.listGroupActivities.mockResolvedValue([]);
  mockNative.startGroupActivity.mockResolvedValueOnce({ activityId: 'A' }).mockResolvedValueOnce({ activityId: 'B' });
  function ScopedHarness({ sessionId }: { sessionId: string }) {
    return React.createElement(LiveActivityRuntime, {
    active: true,
    state: { groupName: 'Team' },
    session: { groupId: 'team', destinationId: 'stop', navigationSessionId: sessionId, initialDistanceM: 100, travelMode: 'walk' },
  });

  }
  let view!: ReactTestRenderer;
  await act(async () => { view = create(React.createElement(ScopedHarness, { sessionId: 'session-A' })); });
  await act(async () => { view.update(React.createElement(ScopedHarness, { sessionId: 'session-B' })); });
  expect(mockNative.endGroupActivity).toHaveBeenCalledWith('A');
  expect(mockNative.startGroupActivity).toHaveBeenCalledTimes(2);
  expect(mockNative.startGroupActivity).toHaveBeenLastCalledWith(expect.objectContaining({ navigationSessionId: 'session-B', destinationId: 'stop' }));
  expect(mockNative.updateGroupActivity).toHaveBeenLastCalledWith('B', expect.objectContaining({ navigationSessionId: 'session-B' }));
  await act(async () => view.unmount());
});

it('finishes the matching Live Activity when the scoped roster has arrived', async () => {
  jest.clearAllMocks();
  mockNative.listGroupActivities.mockResolvedValue([]);
  const session = { groupId: 'team', navigationSessionId: 'nav-1', destinationId: 'stop',
    initialDistanceM: 100, travelMode: 'walk' } as const;
  const state = { groupName: 'Team' };
  let view!: ReactTestRenderer;
  await act(async () => { view = create(React.createElement(LiveActivityRuntime, {
    active: true, state, session,
  })); });
  await act(async () => { view.update(React.createElement(LiveActivityRuntime, {
    active: true, allArrived: true, state, session,
  })); });
  expect(mockNative.completeGroupActivity).toHaveBeenCalledWith('nav-1', 'stop');
  expect(mockNative.completeGroupActivity.mock.invocationCallOrder[0])
    .toBeLessThan(mockNative.endGroupActivity.mock.invocationCallOrder[0]);
  expect(mockNative.startGroupActivity).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});

it('reports an unavailable native activity rather than silently showing a running journey', async () => {
  jest.clearAllMocks();
  mockNative.listGroupActivities.mockResolvedValue([]);
  const start = jest.spyOn(mockNative, 'startGroupActivity');
  start.mockImplementationOnce(async () => null);
  const status = jest.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(React.createElement(LiveActivityRuntime, {
    active: true, state: { groupName: 'Team' }, onAvailabilityChange: status,
    session: { groupId: 'team', navigationSessionId: 'nav-unavailable', destinationId: 'stop', initialDistanceM: 100, travelMode: 'walk' },
  })); });
  expect(status).toHaveBeenCalledWith('unavailable');
  await act(async () => view.unmount());
});
