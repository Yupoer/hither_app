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
  ['refreshPremiumProjection', 'B10'], ['ensurePersonalPremiumAccess', 'B10,B12']]) {
  exported(`premium.flow.${symbol}`, ids, 'src/services/premiumPurchaseFlow.ts', symbol);
}
for (const symbol of ['getTripEntitlement', 'getPremiumProjection', 'getPremiumAppAccountToken',
  'applyVerifiedSubscription', 'applyVerifiedTripPass', 'syncAppStoreSubscription', 'restoreEntitlements']) {
  exported(`premium.service.${symbol}`, 'B11', 'src/api/services/EntitlementService.ts', symbol);
}

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
exported('commands.flush', 'N16', 'src/state/coreDataSync.ts', 'flushCoreOperationOutbox');
for (const [symbol, ids] of [['upsertDeviceActivityToken', 'L05'], ['upsertLiveActivitySession', 'L06,L09'],
  ['deleteLiveActivitySession', 'L02,L09'], ['deleteMyLiveActivitySessions', 'L02,L09'],
  ['deleteMyLiveActivitySessionsForGroups', 'L02,L09'], ['updateDeviceActivityAccent', 'L08'], ['updateLiveActivityProgress', 'L09']]) {
  exported(`live.service.${symbol}`, ids, 'src/api/services/LiveActivityService.ts', symbol);
}
exported('live.clear', 'L02', 'src/state/useLiveActivity.ts', 'clearLiveActivities');

exports.operations = operations;
exports.lifecycle = [
  { name: 'store.foreground-connectivity', inventory: ['W02'],
    sources: [{ file: store, symbol: 'refreshConnectivity' }], trigger: 'Mount StorePane or deliver AppState active.',
    scenarios: [{ file: 'src/__tests__/headlessStoreScenario.test.ts', pattern: 'W02 W03' }] },
  { name: 'store.product-highlight', inventory: ['W03'],
    sources: [{ file: store, symbol: 'highlightProductCode' }], trigger: 'Mount StorePane with a product highlight and advance 280ms.',
    scenarios: [{ file: 'src/__tests__/headlessStoreScenario.test.ts', pattern: 'W02 W03' }] },
  { name: 'notifications.foreground-dispatch', inventory: ['N06'],
    sources: [{ file: 'src/native/notifications.ts', symbol: 'handleNotification' }], trigger: 'Inject an external foreground push payload.',
    scenarios: [{ file: 'src/__tests__/headlessStoreNativeScenario.test.ts', pattern: 'N05 N06' }] },
  { name: 'notifications.group-realtime', inventory: ['N09', 'N10', 'N11', 'N12', 'N13', 'N14'],
    sources: [{ file: 'src/state/useGroupNotifications.ts', symbol: 'useGroupNotifications' }], trigger: 'Mount the real hook with SessionProvider membership and inject external push or Realtime events.',
    scenarios: [{ file: 'src/__tests__/headlessStoreScenario.test.ts', pattern: 'N09 N10 N11 N12 N13 N14' }] },
  { name: 'live.activity-lifecycle', inventory: ['L01', 'L03', 'L04', 'L07'],
    sources: [{ file: 'src/state/useLiveActivity.ts', symbol: 'LiveActivityRuntime' }], trigger: 'Mount the real runtime component, change activity input, and inject native token callbacks.',
    scenarios: [{ file: 'src/__tests__/headlessStoreScenario.test.ts', pattern: 'adopts only its scoped activity' }] },
];
exports.scenarios = [
  ['W01,W07,W09,W10,W11,W13,W14,W16,W17', 'executes Store callbacks and waits for external SSV', 'Issued session, no client credit, late SSV balance, exact redemption binding and callback.'],
  ['W02,W03', 'restores the owned offline snapshot', 'Owned durable cache, group isolation, one highlighted card, consumed callback and focus receipt.'],
  ['W04,W17,B02', 'renders registration guards', 'Actual anonymous auth identity, registration callback, no ad or native purchase request.'],
  ['W05,W08,W12', 'fails an empty ad session', 'Failed server session, retryable CTA, silent probe cleanup, no show or credit, offline disabled.'],
  ['W13,W14,W15,W16', 'preserves the redemption request key', 'Cancelled confirmation has no mutation, lost response retains key, replay charges once, terminal error grants nothing.'],
  ['B01,B02,B03,B04,B05', 'selects the actual plan', 'Native localized catalog and selected plan, held server verification prevents native finish, authoritative activation.'],
  ['B03,B04,B11', 'binds an actual consumable purchase', 'Exact group grant, no personal Premium, consumable finish after verification.'],
  ['B06,B08', 'restores verified subscriptions', 'Invalid promo retained, verified restore activates, unverified receipt stays unfinished.'],
  ['B08', 'clears the actual promo form', 'Successful server redemption activates the authoritative projection before form close, with no native purchase.'],
  ['B07,B10,B11,B12', 'recovers unfinished purchases', 'Actual recovery component single-flight, cache avoids transport, revoked personal grant denied despite team grant.'],
  ['N01,N02', 'loads all five actual preference toggles', 'Each exact wire field persists and failed optimistic toggle rolls back with an alert.'],
  ['N16', 'invokes actual QuickCommands role guards', 'Role grid, empty custom slot editor, durable offline UUID payload and exact replay notification intent.'],
  ['N03,N09,N10,N11,N12,N13,N14', 'dispatches real role-scoped realtime notifications', 'Platform token scope, sender and role guards, command/add/straggler/journey/arrival paths, push dedupe, stale actor awaits, preferences and unmount cleanup.'],
  ['L01,L02,L03,L04,L05,L06,L07,L08,L09', 'adopts only its scoped activity', 'Hydration preserves activity, scope adoption, token gate, throttled display, owned session payload, progress nullability and local-only cleanup.'],
].map(([inventory, pattern, assertions]) => ({ inventory: inventory.split(','),
  file: 'src/__tests__/headlessStoreScenario.test.ts', pattern, platforms: ['ios', 'android'], assertions }));
exports.scenarios.push(...[
  ['B05', 'routes the actual purchase adapter', 'Native platform request and intro eligibility, explicit finish and cleanup.'],
  ['B05', 'retains native cancellation', 'Cancelled result, malformed receipt rejection and actual 120 second timeout.'],
  ['W06,W08,W09', 'gates consent and treats earned ad events', 'No initialize without consent, SSV customData, earned only verifies, no grant, cleanup.'],
  ['W06', 'initializes the actual adapter', 'Named, default and lowercase SDK factories.'],
  ['W06,B05', 'fails closed for explicitly unavailable', 'Missing native packages cannot create ad or purchase effects.'],
  ['W08,W09', 'distinguishes no fill', 'Empty inventory, dismissed ad, load timeout and listener cleanup.'],
  ['N04,N05,N07,N08', 'executes permission fallback', 'Native token normalization, denied OS permission, date scheduling and platform completion path.'],
  ['N05,N06', 'suppresses iOS approach', 'Actual foreground handler dedupe and locked/background approach gates.'],
  ['N15', 'persists the actual journey delivery claim', 'Concurrent and process-reload dedupe, failed delivery permits retry.'],
].map(([inventory, pattern, assertions]) => ({ inventory: inventory.split(','),
  file: 'src/__tests__/headlessStoreNativeScenario.test.ts', pattern, platforms: ['ios', 'android'], assertions })));
