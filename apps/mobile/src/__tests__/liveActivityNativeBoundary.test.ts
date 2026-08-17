jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => null,
}));

import {
  addPushTokenListener,
  addPushToStartTokenListener,
  endAllGroupActivities,
  endGroupActivity,
  listGroupActivities,
  observeExistingActivities,
  startGroupActivity,
  startPushToStartTokenObservation,
  updateAllGroupActivities,
  updateGroupActivity,
} from '../native/liveActivity';

describe('liveActivity JS boundary (Expo Go no-op)', () => {
  const state = { groupName: 'Team', gatheringTitle: 'Station', progress: 0.2 };

  it('returns safe no-ops when the native module is absent', async () => {
    expect(await startGroupActivity(state)).toBeNull();
    expect(await listGroupActivities()).toEqual([]);
    await expect(updateGroupActivity('id', state)).resolves.toBeUndefined();
    await expect(updateAllGroupActivities(state)).resolves.toBeUndefined();
    await expect(endGroupActivity('id')).resolves.toBeUndefined();
    await expect(endAllGroupActivities()).resolves.toBeUndefined();
    await expect(observeExistingActivities()).resolves.toBeUndefined();
    await expect(startPushToStartTokenObservation()).resolves.toBeUndefined();
    const tokenSub = addPushTokenListener(() => undefined);
    const ptsSub = addPushToStartTokenListener(() => undefined);
    tokenSub.remove();
    ptsSub.remove();
  });
});
