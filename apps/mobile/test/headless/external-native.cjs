const assert = require('node:assert/strict');

exports.createExternalNative = function createExternalNative({ platform, strict = (_name, value) => value, record = () => {}, profile = {} }) {
  assert(['ios', 'android'].includes(platform));
  const boundary = (name, value) => strict(name, Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, child && typeof child === 'object' && !Array.isArray(child) ? boundary(`${name}.${key}`, child) : child])));
  const receipts = [];
  const effect = (method, value) => {
    const receipt = { method, ...(value === undefined ? {} : { value: structuredClone(value) }) };
    receipts.push(receipt);
    record(receipt);
  };
  const listeners = names => new Map(names.map(name => [name, new Set()]));
  const listen = (events, name, listener) => {
    assert(events.has(name), `Unsupported native event ${name}`);
    assert.equal(typeof listener, 'function');
    events.get(name).add(listener);
    return boundary(`NativeSubscription.${name}`, { remove: () => events.get(name).delete(listener) });
  };
  const emit = (events, name, value) => {
    assert(events.has(name), `Unsupported native event ${name}`);
    for (const listener of [...events.get(name)]) listener(value);
  };
  const settings = (state, patch) => {
    assert(patch && typeof patch === 'object' && !Array.isArray(patch));
    for (const [key, value] of Object.entries(patch)) {
      assert(Object.hasOwn(state, key), `Unsupported fixture setting ${key}`);
      state[key] = structuredClone(value);
    }
  };
  const fail = (state, key) => {
    if (state[key]) throw new Error(String(state[key]));
  };

  const iapEvents = listeners(['purchase', 'error']);
  const iap = {
    products: [], availablePurchases: [], pendingTransactions: [], introEligible: false,
    initError: null, fetchError: null, requestError: null, finishError: null, restoreError: null,
  };
  const iapModule = boundary('expo-iap', {
    __esModule: true,
    initConnection: async () => { effect('iap.initConnection'); fail(iap, 'initError'); return true; },
    purchaseUpdatedListener: (listener, options) => {
      assert.deepEqual(options, { dedupeTransactionIOS: true });
      return listen(iapEvents, 'purchase', listener);
    },
    purchaseErrorListener: listener => listen(iapEvents, 'error', listener),
    fetchProducts: async input => {
      assert(['subs', 'in-app'].includes(input.type));
      assert(Array.isArray(input.skus) && input.skus.every(sku => typeof sku === 'string'));
      effect('iap.fetchProducts', input);
      fail(iap, 'fetchError');
      return structuredClone(iap.products.filter(product => input.skus.includes(product.id) && product.type === input.type));
    },
    isEligibleForIntroOfferIOS: async groupId => {
      assert.equal(platform, 'ios', 'Android must not query StoreKit introductory eligibility');
      assert.equal(typeof groupId, 'string');
      effect('iap.isEligibleForIntroOfferIOS', groupId);
      return iap.introEligible;
    },
    requestPurchase: async input => {
      assert(['subs', 'in-app'].includes(input.type));
      const branch = platform === 'ios' ? input.request.apple : input.request.google;
      const token = platform === 'ios' ? branch.appAccountToken : branch.obfuscatedAccountId;
      const products = platform === 'ios' ? [branch.sku] : branch.skus;
      assert.equal(typeof token, 'string');
      assert(token.length > 0 && Array.isArray(products) && products.length > 0);
      assert(products.every(product => typeof product === 'string' && product.length > 0));
      effect('iap.requestPurchase', input);
      fail(iap, 'requestError');
    },
    getPendingTransactionsIOS: async () => {
      effect('iap.getPendingTransactionsIOS');
      if (platform !== 'ios') throw new Error('StoreKit queue unavailable on Android');
      return structuredClone(iap.pendingTransactions);
    },
    getAvailablePurchases: async options => {
      assert.deepEqual(options, { onlyIncludeActiveItemsIOS: true });
      effect('iap.getAvailablePurchases', options);
      return structuredClone(iap.availablePurchases);
    },
    restorePurchases: async () => { effect('iap.restorePurchases'); fail(iap, 'restoreError'); },
    finishTransaction: async input => {
      assert(input.purchase && typeof input.isConsumable === 'boolean');
      effect('iap.finishTransaction', input);
      fail(iap, 'finishError');
      const id = input.purchase.transactionId ?? input.purchase.id;
      iap.availablePurchases = iap.availablePurchases.filter(purchase => (purchase.transactionId ?? purchase.id) !== id);
      iap.pendingTransactions = iap.pendingTransactions.filter(purchase => (purchase.transactionId ?? purchase.id) !== id);
    },
  });

  const ads = { canRequestAds: true, formAvailable: false, afterFormCanRequestAds: true, consentError: null, initializeError: null, loadError: null, showError: null };
  const adInstances = new Map();
  let nextAd = 0;
  const mobileAdsFactory = () => boundary('MobileAds.instance', { initialize: async () => {
    effect('ads.initialize'); fail(ads, 'initializeError'); return [];
  } });
  const adsModule = boundary('react-native-google-mobile-ads', {
    __esModule: true,
    MobileAds: !profile.adsFactory || profile.adsFactory === 'named' ? mobileAdsFactory : undefined,
    mobileAds: !profile.adsFactory || profile.adsFactory === 'lowercase' ? mobileAdsFactory : undefined,
    default: !profile.adsFactory || profile.adsFactory === 'default' ? mobileAdsFactory : undefined,
    AdsConsent: {
      requestInfoUpdate: async () => {
        effect('ads.requestInfoUpdate'); fail(ads, 'consentError');
        return { canRequestAds: ads.canRequestAds, isConsentFormAvailable: ads.formAvailable };
      },
      loadAndShowConsentFormIfRequired: async () => {
        effect('ads.loadAndShowConsentFormIfRequired'); fail(ads, 'consentError');
        return { canRequestAds: ads.afterFormCanRequestAds };
      },
      getConsentInfo: async () => ({ canRequestAds: ads.canRequestAds }),
    },
    RewardedAdEventType: { LOADED: 'loaded', EARNED_REWARD: 'earned' },
    AdEventType: { CLOSED: 'closed', ERROR: 'error' },
    TestIds: { REWARDED: 'fixture-rewarded' },
    RewardedAd: {
      createForAdRequest: (unitId, options) => {
        assert.equal(typeof unitId, 'string');
        assert.equal(typeof options?.serverSideVerificationOptions?.customData, 'string');
        const id = `ad-${++nextAd}`;
        const events = listeners(['loaded', 'earned', 'closed', 'error']);
        adInstances.set(id, { events, unitId, options: structuredClone(options) });
        effect('ads.createForAdRequest', { id, unitId, options });
        return boundary('RewardedAd.instance', {
          addAdEventListener: (event, listener) => {
            const subscription = listen(events, event, listener);
            return subscription.remove;
          },
          load: () => { effect('ads.load', { id }); fail(ads, 'loadError'); },
          show: async () => { effect('ads.show', { id }); fail(ads, 'showError'); },
        });
      },
    },
  });

  const notificationEvents = listeners(['received']);
  const notifications = { permission: 'granted', nativeToken: `fixture-${platform}-native-push`, expoToken: `fixture-${platform}-expo-push`, nativeTokenError: null, tokenError: null, scheduleError: null, cancelError: null };
  let notificationHandler;
  const notificationTasks = new Set();
  let nextNotification = 0;
  const scheduled = new Map();
  const notificationsModule = boundary('expo-notifications', {
    __esModule: true,
    SchedulableTriggerInputTypes: { DATE: 'date' },
    registerTaskAsync: async taskName => {
      assert.equal(typeof taskName, 'string');
      notificationTasks.add(taskName);
      effect('notifications.registerTaskAsync', taskName);
    },
    setNotificationHandler: handler => {
      assert.equal(typeof handler.handleNotification, 'function');
      notificationHandler = handler;
    },
    requestPermissionsAsync: async () => {
      effect('notifications.requestPermissionsAsync');
      return { status: notifications.permission, granted: notifications.permission === 'granted', canAskAgain: true };
    },
    getDevicePushTokenAsync: async () => {
      effect('notifications.getDevicePushTokenAsync'); fail(notifications, 'tokenError');
      return { type: platform, data: notifications.expoToken };
    },
    scheduleNotificationAsync: async input => {
      assert(input.content && (input.trigger === null || input.trigger.type === 'date'));
      effect('notifications.scheduleNotificationAsync', input); fail(notifications, 'scheduleError');
      const id = `notification-${++nextNotification}`;
      scheduled.set(id, structuredClone(input));
      return id;
    },
    cancelScheduledNotificationAsync: async id => {
      effect('notifications.cancelScheduledNotificationAsync', id); fail(notifications, 'cancelError');
      scheduled.delete(id);
    },
    addNotificationReceivedListener: listener => listen(notificationEvents, 'received', listener),
  });

  const liveEvents = listeners(['onPushToken', 'onPushToStartToken']);
  const live = { startError: null, updateError: null, endError: null, listError: null, startResult: undefined };
  const activities = new Map();
  let nextActivity = 0;
  const liveModule = boundary('HitherLiveActivity', {
    addListener: (name, listener) => listen(liveEvents, name, listener),
    startPushToStartTokenObservation: async () => { effect('live.startPushToStartTokenObservation'); },
    observeExistingActivities: async () => { effect('live.observeExistingActivities'); },
    listGroupActivities: async () => {
      effect('live.listGroupActivities'); fail(live, 'listError');
      return [...activities.values()].map(({ state, ...activity }) => structuredClone(activity));
    },
    startGroupActivity: async state => {
      effect('live.startGroupActivity', state); fail(live, 'startError');
      if (live.startResult === null) return null;
      const result = live.startResult ?? { activityId: `activity-${++nextActivity}` };
      assert.equal(typeof result.activityId, 'string');
      activities.set(result.activityId, { ...structuredClone(result), navigationSessionId: state.navigationSessionId, destinationId: state.destinationId, state: structuredClone(state) });
      return structuredClone(result);
    },
    updateGroupActivity: async (handle, state) => {
      effect('live.updateGroupActivity', { handle, state }); fail(live, 'updateError');
      assert(activities.has(handle), `Unknown native activity ${handle}`);
      activities.get(handle).state = structuredClone(state);
    },
    updateAllGroupActivities: async state => {
      effect('live.updateAllGroupActivities', state); fail(live, 'updateError');
      for (const activity of activities.values()) activity.state = structuredClone(state);
    },
    endGroupActivity: async handle => {
      effect('live.endGroupActivity', handle); fail(live, 'endError'); activities.delete(handle);
    },
    endAllGroupActivities: async () => {
      effect('live.endAllGroupActivities'); fail(live, 'endError'); activities.clear();
    },
  });
  const locationEvents = listeners(['onBackgroundLocation', 'onBackgroundLocationError']);
  const location = { permission: 'granted', locked: null, prepareResult: true, startResult: true,
    prepareError: null, startError: null, stopError: null, hasError: null };
  let locationPrepared = false;
  let locationRunning = false;
  const locationSupported = platform === 'ios' && profile.nativeLocationLiveUpdates !== false;
  const locationModule = boundary('HitherLocation', {
    supportsBackgroundLiveUpdates: platform === 'ios' ? () => locationSupported : undefined,
    isDeviceLocked: platform === 'ios' ? async () => location.locked : undefined,
    getCurrentLocation: platform === 'android' ? async () => null : undefined,
    prepareBackgroundLocation: platform === 'ios' ? async enabled => {
      assert.equal(typeof enabled, 'boolean');
      effect('nativeLocation.prepare', enabled); fail(location, 'prepareError');
      locationPrepared = Boolean(enabled && locationSupported && location.permission === 'granted' && location.prepareResult);
      if (!enabled) locationRunning = false;
      return locationPrepared;
    } : undefined,
    hasBackgroundLocation: platform === 'ios' ? async () => {
      effect('nativeLocation.hasStarted'); fail(location, 'hasError'); return locationRunning;
    } : undefined,
    startBackgroundLocation: platform === 'ios' ? async options => {
      assert(options && typeof options === 'object' && !Array.isArray(options));
      assert.equal(options.activityType, 3);
      assert.equal(options.showsBackgroundLocationIndicator, true);
      effect('nativeLocation.start', options); fail(location, 'startError');
      locationRunning = Boolean(locationSupported && locationPrepared && location.permission === 'granted' && location.startResult);
      return locationRunning;
    } : undefined,
    stopBackgroundLocation: platform === 'ios' ? async () => {
      effect('nativeLocation.stop'); fail(location, 'stopError'); locationRunning = false;
    } : undefined,
    addListener: platform === 'ios' ? (name, listener) => listen(locationEvents, name, listener) : undefined,
  });
  const nativeModules = {
    HitherLocation: profile.nativeLocation === true ? locationModule : null,
    HitherNotifications: profile.notifications === false ? null : boundary('HitherNotifications', {
      getDevicePushToken: async () => {
        effect('nativeNotifications.getDevicePushToken'); fail(notifications, 'nativeTokenError');
        return notifications.nativeToken;
      },
    }),
    HitherLiveActivity: profile.liveActivity === false ? null : liveModule,
  };
  const modules = { 'expo-notifications': notificationsModule, 'expo-iap': profile.iap === false ? null : iapModule,
    'react-native-google-mobile-ads': profile.ads === false ? null : adsModule };
  return {
    modules, nativeModules,
    handles: kind => ['iapConfigure', 'iapPurchase', 'iapError', 'adsConfigure', 'adEvent', 'notificationsConfigure',
      'notification', 'liveConfigure', 'liveExisting', 'livePushToken', 'livePushToStart',
      'nativeLocationConfigure', 'nativeLocation', 'nativeLocationError'].includes(kind),
    async input(input) {
      switch (input.kind) {
        case 'nativeLocationConfigure':
          assert.equal(profile.nativeLocation, true, 'Native location capability is disabled');
          settings(location, input.patch);
          assert(['granted', 'denied'].includes(location.permission));
          assert.equal(typeof location.prepareResult, 'boolean');
          assert.equal(typeof location.startResult, 'boolean');
          assert(location.locked === null || typeof location.locked === 'boolean');
          return;
        case 'nativeLocation': {
          assert(locationRunning, 'No native background location owner');
          const sample = input.sample;
          assert(Number.isFinite(sample?.timestamp));
          assert(Number.isFinite(sample.coords?.latitude) && Math.abs(sample.coords.latitude) <= 90);
          assert(Number.isFinite(sample.coords?.longitude) && Math.abs(sample.coords.longitude) <= 180);
          assert(Number.isFinite(sample.coords?.accuracy) && sample.coords.accuracy >= 0);
          assert(sample.stationary === undefined || typeof sample.stationary === 'boolean');
          effect('nativeLocation.sample', sample);
          emit(locationEvents, 'onBackgroundLocation', structuredClone(sample)); return;
        }
        case 'nativeLocationError':
          assert(locationRunning, 'No native background location owner');
          assert.deepEqual(input.error, { code: 'location_stream_failed' });
          locationRunning = false;
          effect('nativeLocation.error', input.error);
          emit(locationEvents, 'onBackgroundLocationError', structuredClone(input.error)); return;
        case 'iapConfigure': settings(iap, input.patch); return;
        case 'iapPurchase': emit(iapEvents, 'purchase', structuredClone(input.purchase)); return;
        case 'iapError': emit(iapEvents, 'error', structuredClone(input.error)); return;
        case 'adsConfigure': settings(ads, input.patch); return;
        case 'adEvent': {
          const ad = adInstances.get(input.id ?? `ad-${nextAd}`);
          assert(ad, `Unknown ad ${input.id}`);
          effect('ads.event', { id: input.id ?? `ad-${nextAd}`, event: input.event });
          emit(ad.events, input.event, structuredClone(input.value)); return;
        }
        case 'notificationsConfigure': settings(notifications, input.patch); return;
        case 'notification': {
          const notification = { request: { identifier: input.id ?? 'fixture-push', content: structuredClone(input.content) } };
          const result = notificationHandler ? await notificationHandler.handleNotification(notification) : null;
          effect('notifications.presentation', result);
          emit(notificationEvents, 'received', notification); return result;
        }
        case 'liveConfigure': settings(live, input.patch ?? {}); return;
        case 'liveExisting':
          assert(Array.isArray(input.activities));
          activities.clear();
          for (const activity of input.activities) { assert.equal(typeof activity.activityId, 'string'); activities.set(activity.activityId, structuredClone(activity)); }
          return;
        case 'livePushToken': emit(liveEvents, 'onPushToken', structuredClone(input.event)); return;
        case 'livePushToStart': emit(liveEvents, 'onPushToStartToken', { token: input.token }); return;
        default: throw new Error(`Unsupported native fixture input ${input.kind}`);
      }
    },
    observe: () => ({ receipts: structuredClone(receipts), notificationTasks: [...notificationTasks], scheduled: [...scheduled].map(([id, input]) => ({ id, input: structuredClone(input) })),
      location: { available: profile.nativeLocation === true, supported: profile.nativeLocation === true && locationSupported,
        prepared: locationPrepared, running: locationRunning, listeners: [...locationEvents.values()].reduce((sum, set) => sum + set.size, 0) },
      activities: [...activities.values()].map(activity => structuredClone(activity)),
      ads: [...adInstances].map(([id, ad]) => ({ id, unitId: ad.unitId, options: structuredClone(ad.options), listeners: [...ad.events.values()].reduce((sum, set) => sum + set.size, 0) })),
      listeners: { iap: [...iapEvents.values()].reduce((sum, set) => sum + set.size, 0), notification: notificationEvents.get('received').size, live: [...liveEvents.values()].reduce((sum, set) => sum + set.size, 0) } }),
    dispose: () => ({ ...(profile.nativeLocation === true ? { location: { running: locationRunning, prepared: locationPrepared,
      processListeners: [...locationEvents.values()].reduce((sum, set) => sum + set.size, 0) } } : {}),
      iapProcessListeners: [...iapEvents.values()].reduce((sum, set) => sum + set.size, 0),
      notification: notificationEvents.get('received').size,
      live: [...liveEvents.values()].reduce((sum, set) => sum + set.size, 0),
      ads: [...adInstances.values()].reduce((sum, ad) => sum + [...ad.events.values()].reduce((count, set) => count + set.size, 0), 0) }),
  };
};
