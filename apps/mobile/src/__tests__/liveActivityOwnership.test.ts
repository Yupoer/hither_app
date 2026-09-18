import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockNative = {
  endGroupActivity: jest.fn(async () => {}), endAllGroupActivities: jest.fn(async () => {}),
  startGroupActivity: jest.fn(async () => ({ activityId: 'activity' })),
  listGroupActivities: jest.fn(async () => [] as { activityId: string }[]),
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
import { useLiveActivity } from '../state/useLiveActivity';

function Harness({ active }: { active: boolean | undefined }) {
  useLiveActivity(active, { groupName: 'Team' }, { groupId: 'team', destinationId: 'stop', initialDistanceM: 100, travelMode: 'walk' });
  return null;
}

it('preserves on unmount/hydration, adopts on return, and ends on an explicit stop', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let view!: ReactTestRenderer;
  await act(async () => { view = create(React.createElement(Harness, { active: true })); });
  expect(mockNative.startGroupActivity).toHaveBeenCalledTimes(1);
  mockNative.endAllGroupActivities.mockClear();
  await act(async () => view.unmount());
  expect(mockNative.endAllGroupActivities).not.toHaveBeenCalled();
  mockNative.listGroupActivities.mockResolvedValue([{ activityId: 'activity' }]);
  await act(async () => { view = create(React.createElement(Harness, { active: undefined })); });
  expect(mockNative.endAllGroupActivities).not.toHaveBeenCalled();
  await act(async () => view.update(React.createElement(Harness, { active: true })));
  expect(mockNative.startGroupActivity).toHaveBeenCalledTimes(1);
  await act(async () => view.update(React.createElement(Harness, { active: false })));
  expect(mockNative.endGroupActivity).toHaveBeenCalledWith('activity');
  await act(async () => view.unmount());
});
