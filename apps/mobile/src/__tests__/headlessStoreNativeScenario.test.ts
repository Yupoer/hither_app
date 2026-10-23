const { createExternalNative } = require('../../test/headless/external-native.cjs');

describe.each(['ios', 'android'])('external-only Store/native scenarios on %s', platform => {
  let native: ReturnType<typeof createExternalNative>;
  let state: { currentState: string };
  let locked: boolean;
  const fatal: string[] = [];
  async function waitForPurchaseRequest(count: number) {
    for (let turn = 0; turn < 20; turn++) {
      if (native.observe().receipts.filter((call: { method: string }) => call.method === 'iap.requestPurchase').length === count) return;
      await Promise.resolve();
    }
    throw new Error('Actual purchase request did not reach expo-iap');
  }
  const strict = (name: string, value: object): object => new Proxy(value, {
    get(target, key) {
      if (typeof key === 'symbol' || ['__esModule', 'then'].includes(String(key))) return Reflect.get(target, key);
      if (!Reflect.has(target, key)) {
        fatal.push(`${name}.${String(key)}`);
        throw new Error(`Unsupported external ${name}.${String(key)}`);
      }
      return Reflect.get(target, key);
    },
  });
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    fatal.length = 0;
    state = { currentState: 'active' };
    locked = false;
    native = createExternalNative({ platform, strict });
    jest.doMock('react-native', () => ({ Platform: { OS: platform }, AppState: state }));
    jest.doMock('expo-constants', () => ({ __esModule: true, default: {
      executionEnvironment: 'standalone', appOwnership: 'standalone',
    }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
    jest.doMock('expo-modules-core', () => ({ requireOptionalNativeModule: (name: string) =>
      name === 'HitherLocation' ? { isDeviceLocked: async () => locked } : native.nativeModules[name] ?? null }));
    for (const [name, module] of Object.entries(native.modules)) jest.doMock(name, () => module);
  });
  afterEach(() => {
    expect(native.dispose()).toEqual({ iapProcessListeners: 0, notification: 0, live: 0, ads: 0 });
    jest.clearAllTimers();
    jest.useRealTimers();
    expect(fatal).toEqual([]);
  });

  it('B05 routes the actual purchase adapter to its platform branch and keeps completion explicit', async () => {
    const purchases = require('../native/purchases');
    const productId = 'app.hither.premium.annual';
    await native.input({ kind: 'iapConfigure', patch: { products: [{ id: productId, type: 'subs', displayName: 'Annual',
      displayPrice: '$20', price: 20, currency: 'USD', subscriptionGroupIdIOS: 'premium', introductoryPriceIOS: '$0' }], introEligible: true } });
    const catalog = await purchases.fetchPremiumProducts();
    expect(catalog[0].introductoryOfferEligibleIOS).toBe(platform === 'ios');
    const pending = purchases.requestPremiumSubscription(productId, 'fixture-account');
    await waitForPurchaseRequest(1);
    const purchase = { transactionId: 'tx-annual', productId, purchaseToken: 'fixture-receipt', appAccountToken: 'fixture-account' };
    await native.input({ kind: 'iapPurchase', purchase });
    const result = await pending;
    expect(result).toMatchObject({ status: 'purchased', transactionId: 'tx-annual' });
    const calls = native.observe().receipts;
    const request = calls.find((call: { method: string }) => call.method === 'iap.requestPurchase');
    expect(platform === 'ios' ? request.value.request.apple.sku : request.value.request.google.skus[0]).toBe(productId);
    expect(calls.some((call: { method: string }) => call.method === 'iap.finishTransaction')).toBe(false);
    await purchases.finishPremiumPurchase(result, { isConsumable: false });
    expect(native.observe().receipts.at(-1)).toMatchObject({ method: 'iap.finishTransaction', value: { isConsumable: false } });
    purchases.__resetPurchaseAdapterForTests();
    expect(native.observe().listeners.iap).toBe(0);
  });

  it('B05 retains native cancellation, malformed events and the real 120 second waiter timeout', async () => {
    const purchases = require('../native/purchases');
    await purchases.fetchPremiumProducts();
    const cancelled = purchases.requestPremiumSubscription('app.hither.premium.monthly', 'fixture-account');
    await waitForPurchaseRequest(1);
    await native.input({ kind: 'iapError', error: { productId: 'app.hither.premium.monthly', code: 'user_cancelled' } });
    await expect(cancelled).resolves.toEqual({ status: 'cancelled' });
    const pending = purchases.requestPremiumSubscription('app.hither.premium.annual', 'fixture-account');
    await waitForPurchaseRequest(2);
    await native.input({ kind: 'iapPurchase', purchase: { productId: 'app.hither.premium.annual' } });
    await jest.advanceTimersByTimeAsync(119999);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ status: 'failed', reason: 'store_purchase_timeout' });
    purchases.__resetPurchaseAdapterForTests();
    expect(native.observe().listeners.iap).toBe(0);
  });

  it('fixture contract rejects unknown nested exports and does not clear leaked listener evidence', async () => {
    expect(() => native.modules['react-native-google-mobile-ads'].AdsConsent.unknownMethod()).toThrow('Unsupported external');
    expect(fatal.splice(0)).toEqual(['react-native-google-mobile-ads.AdsConsent.unknownMethod']);
    expect(() => native.modules['react-native-google-mobile-ads'].MobileAds().unknownMethod()).toThrow('Unsupported external');
    expect(fatal.splice(0)).toEqual(['MobileAds.instance.unknownMethod']);
    const subscription = native.modules['expo-notifications'].addNotificationReceivedListener(() => {});
    expect(native.dispose().notification).toBe(1);
    expect(native.observe().listeners.notification).toBe(1);
    subscription.remove();
    const request = platform === 'ios'
      ? { apple: { sku: 'product-without-owner' }, google: { skus: ['ignored'], obfuscatedAccountId: 'valid' } }
      : { apple: { sku: 'ignored', appAccountToken: 'valid' }, google: { skus: ['product-without-owner'] } };
    await expect(native.modules['expo-iap'].requestPurchase({ type: 'subs', request })).rejects.toThrow();
    expect(native.observe().receipts).toEqual([]);
  });

  it('W06 W08 W09 gates consent and treats earned ad events as verification only', async () => {
    const ads = require('../native/rewardedAds');
    await native.input({ kind: 'adsConfigure', patch: { canRequestAds: false } });
    await expect(ads.ensureRewardedAdsReady()).resolves.toEqual({ available: false, reason: 'consent_required' });
    expect(native.observe().receipts.some((call: { method: string }) => call.method === 'ads.initialize')).toBe(false);
    await native.input({ kind: 'adsConfigure', patch: { canRequestAds: true } });
    await expect(ads.ensureRewardedAdsReady()).resolves.toEqual({ available: true });
    const controller = ads.createRewardedAdController(platform);
    const loading = controller.load('fixture-session');
    const ad = native.observe().ads[0];
    expect(ad.options.serverSideVerificationOptions.customData).toBe('fixture-session');
    expect(ad.unitId).toBe(ads.rewardedAdUnitForPlatform(platform));
    await native.input({ kind: 'adEvent', event: 'loaded' });
    await expect(loading).resolves.toBe('ready');
    const showing = controller.show();
    await native.input({ kind: 'adEvent', event: 'earned', value: { amount: 10 } });
    await native.input({ kind: 'adEvent', event: 'closed' });
    await expect(showing).resolves.toBe('verifying');
    expect(native.observe().receipts.some((call: { method: string }) => /credit|grant/i.test(call.method))).toBe(false);
    controller.dispose();
    expect(native.observe().ads[0].listeners).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['named', 'default', 'lowercase'])('W06 initializes the actual adapter with the %s SDK export', async adsFactory => {
    native = createExternalNative({ platform, strict, profile: { adsFactory } });
    jest.doMock('react-native-google-mobile-ads', () => native.modules['react-native-google-mobile-ads']);
    const ads = require('../native/rewardedAds');
    await expect(ads.ensureRewardedAdsReady()).resolves.toEqual({ available: true });
    expect(native.observe().receipts.map((call: { method: string }) => call.method)).toEqual(['ads.requestInfoUpdate', 'ads.initialize']);
  });

  it('W06 B05 fails closed for explicitly unavailable native packages', async () => {
    native = createExternalNative({ platform, strict, profile: { iap: false, ads: false } });
    jest.doMock('expo-iap', () => native.modules['expo-iap']);
    jest.doMock('react-native-google-mobile-ads', () => native.modules['react-native-google-mobile-ads']);
    await expect(require('../native/rewardedAds').ensureRewardedAdsReady()).resolves.toEqual({ available: false, reason: 'missing_module' });
    const purchases = require('../native/purchases');
    await expect(purchases.requestPremiumSubscription('app.hither.premium.annual', 'fixture-account')).resolves.toEqual({ status: 'unavailable', reason: 'native_iap_not_linked' });
    expect(native.observe().receipts).toEqual([]);
  });

  it('W08 W09 distinguishes no fill, dismissed and timeout and disposes SDK listeners', async () => {
    const ads = require('../native/rewardedAds');
    const controller = ads.createRewardedAdController(platform);
    const loading = controller.load('empty-session');
    await native.input({ kind: 'adEvent', event: 'error', value: { code: 'no-fill', message: 'No fill' } });
    await expect(loading).resolves.toBe('no_fill');
    const retry = controller.load('retry-session');
    await native.input({ kind: 'adEvent', event: 'loaded' });
    await expect(retry).resolves.toBe('ready');
    const showing = controller.show();
    await native.input({ kind: 'adEvent', event: 'closed' });
    await jest.advanceTimersByTimeAsync(ads.REWARDED_AD_CLOSED_EARNED_GRACE_MS);
    await expect(showing).resolves.toBe('dismissed');
    const timeout = controller.load('timeout-session');
    await jest.advanceTimersByTimeAsync(ads.REWARDED_AD_LOAD_TIMEOUT_MS);
    await expect(timeout).resolves.toBe('error');
    controller.dispose();
    expect(native.observe().ads.every((ad: { listeners: number }) => ad.listeners === 0)).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('N04 N05 N07 N08 executes permission fallback, date scheduling and auto-completion platform policy', async () => {
    const notifications = require('../native/notifications');
    await native.input({ kind: 'notificationsConfigure', patch: { nativeToken: ' native-device-token ' } });
    await expect(notifications.getDevicePushToken()).resolves.toBe('native-device-token');
    await native.input({ kind: 'notificationsConfigure', patch: { nativeTokenError: 'native unavailable', permission: 'denied' } });
    await expect(notifications.getDevicePushToken()).resolves.toBeNull();
    await expect(notifications.scheduleLocalNotification({ title: 'Denied' })).resolves.toBeNull();
    expect(native.observe().scheduled).toEqual([]);
    await native.input({ kind: 'notificationsConfigure', patch: { nativeTokenError: null, permission: 'granted' } });
    await expect(notifications.scheduleLocalNotificationAt({ title: 'Past' }, new Date(Date.now()))).resolves.toBeNull();
    const id = await notifications.scheduleLocalNotificationAt({ title: 'Meet' }, new Date(Date.now() + 60000));
    expect(native.observe().scheduled).toHaveLength(1);
    await notifications.cancelScheduledNotification(id);
    await notifications.cancelScheduledNotification('stale-id');
    expect(native.observe().scheduled).toEqual([]);
    const branch = await notifications.notifyThisDeviceAutoComplete({ title: 'Complete' });
    expect(branch).toBe(platform === 'ios' ? 'remote_expected' : 'local');
    expect(native.observe().scheduled).toHaveLength(platform === 'ios' ? 0 : 1);
  });

  it('N05 N06 suppresses iOS approach foreground presentation and deduplicates the actual handler', async () => {
    const notifications = require('../native/notifications');
    const input = { title: 'Approach', data: { kind: 'approach', eventId: 'approach-1' } };
    const presented = await native.input({ kind: 'notification', content: input });
    expect(presented.shouldShowBanner).toBe(platform !== 'ios');
    const duplicate = await native.input({ kind: 'notification', content: input });
    expect(duplicate.shouldShowBanner).toBe(false);
    const before = native.observe().scheduled.length;
    await notifications.scheduleLocalNotification(input);
    expect(native.observe().scheduled).toHaveLength(before + (platform === 'ios' ? 0 : 1));
    state.currentState = 'background'; locked = true;
    await notifications.scheduleLocalNotification({ ...input, data: { kind: 'approach', eventId: 'approach-2' } });
    expect(native.observe().scheduled).toHaveLength(before + (platform === 'ios' ? 1 : 2));
  });

  it('N15 persists the actual journey delivery claim across reload and releases a failed claim for retry', async () => {
    const storage = new Map<string, string>();
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      getItem: async (key: string) => storage.get(key) ?? null,
      setItem: async (key: string, value: string) => { storage.set(key, value); },
    }));
    const notifications = require('../native/notifications');
    const ledger = require('../state/journeyNotificationLedger');
    const deliver = () => notifications.scheduleLocalNotification({ title: 'Journey started' });
    await Promise.all([ledger.deliverJourneyEventOnce('operator:event-1', deliver), ledger.deliverJourneyEventOnce('operator:event-1', deliver)]);
    expect(native.observe().scheduled).toHaveLength(1);
    jest.resetModules();
    const restored = require('../state/journeyNotificationLedger');
    await restored.deliverJourneyEventOnce('operator:event-1', deliver);
    expect(native.observe().scheduled).toHaveLength(1);
    await native.input({ kind: 'notificationsConfigure', patch: { permission: 'denied' } });
    await restored.deliverJourneyEventOnce('operator:event-retry', deliver);
    expect(native.observe().scheduled).toHaveLength(1);
    await native.input({ kind: 'notificationsConfigure', patch: { permission: 'granted' } });
    await restored.deliverJourneyEventOnce('operator:event-retry', deliver);
    expect(native.observe().scheduled).toHaveLength(2);
  });

  it('L01 L02 exposes actual native activity state and ends only the specified handle', async () => {
    const live = require('../native/liveActivity');
    const first = await live.startGroupActivity({ groupName: 'First', navigationSessionId: 'nav-1', destinationId: 'point-1' });
    const second = await live.startGroupActivity({ groupName: 'Second', navigationSessionId: 'nav-2', destinationId: 'point-2' });
    await live.updateGroupActivity(first.activityId, { groupName: 'Updated', distanceMeters: 100 });
    expect(native.observe().activities.find((activity: { activityId: string }) => activity.activityId === first.activityId).state.distanceMeters).toBe(100);
    await live.endGroupActivity(first.activityId);
    expect(await live.listGroupActivities()).toEqual([expect.objectContaining({ activityId: second.activityId })]);
    await live.endAllGroupActivities();
    expect(await live.listGroupActivities()).toEqual([]);
  });
});
