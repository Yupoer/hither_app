exports.default = function NativeObservers({ activityActive, activityState = { groupName: 'Headless team' }, activitySession, activityEnabled = true, premiumRecovery = false, onAppNotice }) {
  require('../../src/state/useGroupNotifications').useGroupNotifications();
  require('../../src/state/usePushRegistration').usePushRegistration();
  require('../../src/state/useLiveActivity').useLiveActivity(activityActive, activityState, activitySession, activityEnabled);
  require('react').useEffect(() => require('../../src/state/appNotice').subscribeAppNotices(onAppNotice), [onAppNotice]);
  return premiumRecovery ? require('react').createElement(require('../../src/components/PremiumPurchaseRecovery').default) : null;
};
