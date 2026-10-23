exports.default = function NativeObservers({ activityActive, activityState = { groupName: 'Headless team' }, activitySession, activityEnabled = true }) {
  require('../../src/state/useGroupNotifications').useGroupNotifications();
  require('../../src/state/usePushRegistration').usePushRegistration();
  require('../../src/state/useLiveActivity').useLiveActivity(activityActive, activityState, activitySession, activityEnabled);
  return null;
};
