const assert = require('node:assert/strict');

const operations = {};
function register(name, inventory, file, symbol, level, input, run) {
  operations[name] = { inventory: inventory.split(','), sources: [{ file, symbol }], entry: `${file}::${symbol}`,
    level, input, completion: 'Await actual rendered state, durable state and external receipts in the scenario.', run };
}
function control(name, inventory, file, symbol, testId, kind = 'press') {
  register(name, inventory, file, symbol, 'screen', '{ value?, within? }', (app, input = {}) =>
    app.host.call({ testId, kind, ...input }));
}
function exported(name, inventory, file, symbol) {
  register(name, inventory, file, symbol, 'service', '{ args: Parameters<typeof entry> }', (_app, { args = [] }) => {
    assert(Array.isArray(args));
    return require(`../../${file}`)[symbol](...args);
  });
}

const store = 'src/screens/MapScreen/components/StorePane.tsx';
control('store.watch-ad', 'W04,W05,W06,W07,W08,W09,W10,W11,W12', store, 'onWatchAd', 'store-ad-cta');
control('store.register', 'W04,W17', store, 'onRequireRegistration', 'store-register');
control('store.subscribe', 'W17', store, 'onOpenSubscribe', 'store-open-subscribe');
register('store.redeem', 'W13,W14,W15,W16', store, 'confirmRedeem', 'screen', '{ productCode }',
  (app, { productCode }) => app.host.call({ testId: `store-redeem-${productCode}`, kind: 'press' }));
for (const [symbol, ids] of [['getStoreSnapshot', 'W01,W17'], ['createRewardSession', 'W07'],
  ['updateRewardSessionStatus', 'W08,W10'], ['redeemStoreProduct', 'W14,W15,W16']]) {
  exported(`store.service.${symbol}`, ids, 'src/api/services/StoreService.ts', symbol);
}

const premium = 'src/components/PremiumPresentation.tsx';
for (const plan of ['annual', 'monthly', 'trip']) {
  control(`premium.select.${plan}`, 'B01', premium, 'setSelectedPlan', `paywall-premium-presentation-plan-${plan}`);
}
control('premium.purchase', 'B02,B03,B04,B05', premium, 'handlePurchase', 'paywall-premium-presentation-purchase');
control('premium.restore', 'B06', premium, 'handleRestore', 'paywall-premium-presentation-restore');
control('premium.promo.open', 'B08', premium, 'setRedeemOpen', 'paywall-premium-presentation-redeem');
control('premium.promo.edit', 'B08', premium, 'setPromoCode', 'paywall-redeem-input', 'changeText');
control('premium.promo.submit', 'B08', premium, 'handleRedeem', 'paywall-redeem-submit');
for (const [symbol, ids] of [['loadPremiumStoreProducts', 'B01'], ['purchasePremiumSubscription', 'B03,B04,B05'],
  ['restorePremiumSubscription', 'B06'], ['reconcileUnfinishedPremiumPurchases', 'B07'],
  ['refreshPremiumProjection', 'B10'], ['ensurePersonalPremiumAccess', 'B10']]) {
  exported(`premium.flow.${symbol}`, ids, 'src/services/premiumPurchaseFlow.ts', symbol);
}
for (const symbol of ['getTripEntitlement', 'getPremiumProjection', 'getPremiumAppAccountToken',
  'applyVerifiedSubscription', 'applyVerifiedTripPass', 'syncAppStoreSubscription', 'restoreEntitlements', 'applyVerifiedPurchase']) {
  exported(`premium.service.${symbol}`, 'B11', 'src/api/services/EntitlementService.ts', symbol);
}
exported('premium.direct-write-rejected', 'B12', 'src/api/services/EntitlementService.ts', 'setProStatus');

for (const key of ['addGathering', 'leaderCommands', 'followerRequests', 'journey', 'arrival']) {
  control(`notifications.preference.${key}`, 'N01,N02', 'src/components/NotificationPreferencesCard.tsx', 'toggle',
    `notification-preference-${key}`, 'toggle');
}
for (const [symbol, ids] of [['savePushToken', 'N03'], ['sendCommand', 'N16'],
  ['getNotificationPreferences', 'N01'], ['setNotificationPreferences', 'N02']]) {
  exported(`notifications.service.${symbol}`, ids, 'src/api/services/NotificationService.ts', symbol);
}
for (const [symbol, ids] of [['getDevicePushToken', 'N04'], ['scheduleLocalNotification', 'N05'],
  ['scheduleLocalNotificationAt', 'N07'], ['cancelScheduledNotification', 'N07'], ['notifyThisDeviceAutoComplete', 'N08']]) {
  exported(`notifications.native.${symbol}`, ids, 'src/native/notifications.ts', symbol);
}
for (const symbol of ['notifyJourneyOperator', 'notifyJourneyApproach']) {
  exported(`notifications.journey.${symbol}`, 'N15', 'src/state/journeyNotifications.ts', symbol);
}
register('commands.fixed', 'N16', 'src/components/QuickCommandsCard.tsx', 'sendFixed', 'screen', '{ type }',
  (app, { type }) => app.host.call({ testId: `quick-command-${type}`, kind: 'press' }));
register('commands.custom', 'N16', 'src/components/QuickCommandsCard.tsx', 'sendCustom', 'screen', '{ slot }',
  (app, { slot }) => app.host.call({ testId: `quick-command-custom-${slot}`, kind: 'press' }));
control('commands.open-all', 'N16', 'src/components/QuickCommandsCard.tsx', 'onOpenAll', 'quick-commands-all');
for (const [symbol, ids] of [['upsertDeviceActivityToken', 'L05'], ['upsertLiveActivitySession', 'L06,L09'],
  ['deleteLiveActivitySession', 'L02,L09'], ['deleteMyLiveActivitySessions', 'L02,L09'],
  ['deleteMyLiveActivitySessionsForGroups', 'L02,L09'], ['updateDeviceActivityAccent', 'L08'], ['updateLiveActivityProgress', 'L09']]) {
  exported(`live.service.${symbol}`, ids, 'src/api/services/LiveActivityService.ts', symbol);
}
exported('live.clear', 'L02', 'src/state/useLiveActivity.ts', 'clearLiveActivities');

exports.operations = operations;
