exports.default = function NativeObservers({ activityActive, activityState = { groupName: 'Headless team' }, activitySession, activityEnabled = true, premiumRecovery = false, onAppNotice }) {
  const React = require('react');
  const notifications = require('../../src/state/useGroupNotifications').useGroupNotifications();
  const pushes = require('../../src/state/usePushRegistration').usePushRegistration();
  const activities = require('../../src/state/useLiveActivity').useLiveActivity(activityActive, activityState, activitySession, activityEnabled);
  React.useEffect(() => require('../../src/state/appNotice').subscribeAppNotices(onAppNotice), [onAppNotice]);
  return React.createElement(React.Fragment, null, notifications, pushes, activities,
    premiumRecovery ? React.createElement(require('../../src/components/PremiumPurchaseRecovery').default) : null);
};
