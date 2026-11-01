import type { PremiumPlan } from '../premiumCatalog';

const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type Observation = {
  presentation: {
    hosts: { testId?: string; text?: string; value?: unknown; checked?: boolean; selected?: boolean; disabled?: boolean }[];
    route: { route: string };
    preferences: { liveActivityEnabled: boolean };
    session: {
      isAnonymous: boolean;
      user: { id: string };
      membership: { group: { id: string } };
      premiumProjection: { personalPremiumActive: boolean; teamPremiumActive: boolean };
    };
  };
  native: { receipts: { method: string; value: unknown }[] };
  external: { alerts: number };
  pending: unknown[];
};
type Receipt = Observation['native']['receipts'][number];

const field = (value: Observation, testId: string) => value.presentation.hosts.find(host => host.testId === testId);
const has = (value: Observation, testId: string) => Boolean(field(value, testId));
const press = (device: Device, testId: string) => device.host.call({ kind: 'press', testId });
const catalog = {
  monthly: { id: 'app.hither.premium.monthly', type: 'subs', displayName: 'Monthly', displayPrice: '$3', price: 3, currency: 'USD', subscriptionGroupIdIOS: 'premium' },
  annual: { id: 'app.hither.premium.annual', type: 'subs', displayName: 'Annual', displayPrice: '$20', price: 20, currency: 'USD', subscriptionGroupIdIOS: 'premium' },
  trip: { id: 'hither.small_trip_pass', type: 'in-app', displayName: 'Trip', displayPrice: '$2', price: 2, currency: 'USD' },
};

describe.each(['ios', 'android'])('actual App Map Store entry points on %s', platform => {
  jest.setTimeout(120000);

  async function map(world: InstanceType<typeof World>) {
    world.backend.profiles.get(LEADER).preferences = {
      groupFeatureTourCompleted: true, addPlaceTourCompleted: true, routeReorderTourCompleted: true,
    };
    const device = await world.device({ id: 'store-entries', userId: LEADER, platform, mode: 'app' });
    for (const testId of ['onboarding-skip', 'role-my-teams', `team-card-${GROUP_ID}`, 'team-enter']) {
      await world.waitFor(device, (value: Observation) => has(value, testId), `App navigation ${testId}`);
      expect(await press(device, testId)).toEqual({ invoked: true });
    }
    const mounted = await world.waitFor(device, (value: Observation) => has(value, `gather-card-${DESTINATION}`), 'actual App Map');
    expect(mounted.presentation.route.route).toBe('Map');
    expect(mounted.presentation.session.membership.group.id).toBe(GROUP_ID);
    await device.perform('map.card.toggle', { destinationId: DESTINATION });
    return device;
  }

  async function pane(world: InstanceType<typeof World>, device: Device, index: number) {
    for (const phase of ['onBegin', 'onUpdate', 'onEnd']) {
      await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase,
        value: phase === 'onBegin' ? {} : { translationY: -250, velocityY: 0 }, success: true });
    }
    await device.perform('map.tab', { index });
    await world.settle();
  }

  async function storePaywall(world: InstanceType<typeof World>, device: Device) {
    await pane(world, device, 3);
    await world.waitFor(device, (value: Observation) => has(value, 'store-open-subscribe') && !has(value, 'store-loading'), 'parent Store subscribe entry');
    await device.perform('map.store.subscribe');
    const opened = await world.waitFor(device, (value: Observation) => has(value, 'paywall-premium-presentation-purchase'), 'actual Store Paywall');
    expect(has(opened, 'paywall-premium-presentation-restore')).toBe(false);
    expect(has(opened, 'paywall-premium-presentation-redeem')).toBe(false);
  }

  async function settingsPaywall(world: InstanceType<typeof World>, device: Device) {
    await device.perform('map.settings.open');
    await device.input({ kind: 'animation', finished: true });
    await world.waitFor(device, (value: Observation) => has(value, 'settings-subscribe-banner'), 'actual Settings banner');
    await press(device, 'settings-subscribe-banner');
    expect(has(await device.observe(), 'paywall-premium-presentation-purchase')).toBe(false);
    await device.input({ kind: 'animation', finished: true });
    const opened = await world.waitFor(device, (value: Observation) => has(value, 'paywall-premium-presentation-purchase'), 'Settings dismiss completes before Paywall');
    expect(has(opened, 'settings-subscribe-banner')).toBe(false);
    expect(has(opened, 'paywall-premium-presentation-restore')).toBe(true);
    expect(has(opened, 'paywall-premium-presentation-redeem')).toBe(true);
  }

  async function purchase(world: InstanceType<typeof World>, device: Device, plan: PremiumPlan): Promise<Observation> {
    const product = catalog[plan];
    await world.waitFor(device, (value: Observation) => value.presentation.hosts.some(host => host.text === product.displayPrice), 'localized parent Paywall price');
    await device.perform(`premium.select.${plan}`);
    expect(field(await device.observe(), `paywall-premium-presentation-plan-${plan}`)?.selected).toBe(true);
    world.hold('verify-and-apply-purchase');
    await device.perform('premium.purchase');
    const requested = await world.waitFor(device, (value: Observation) => value.native.receipts.some(receipt => receipt.method === 'iap.requestPurchase'), 'parent Paywall native CTA');
    expect(requested.native.receipts).toEqual(expect.arrayContaining([expect.objectContaining({
      method: 'iap.requestPurchase',
      value: expect.objectContaining({ type: product.type, request: expect.objectContaining(platform === 'ios'
        ? { apple: expect.objectContaining({ sku: product.id }) }
        : { google: expect.objectContaining({ skus: [product.id] }) }) }),
    })]));
    world.backend.verifiedPurchases.set(`parent-${plan}-proof`, {
      user_id: LEADER, product_id: product.id,
      ...(plan === 'trip' ? { group_id: GROUP_ID } : {}),
      expires_at: new Date(world.now + 864000000).toISOString(),
    });
    await device.input({ kind: 'iapPurchase', purchase: {
      productId: product.id, transactionId: `parent-${plan}-transaction`, purchaseToken: `parent-${plan}-proof`, appAccountToken: LEADER,
    } });
    const pending = await world.waitFor(device, (value: Observation) => value.pending.length > 0 && has(value, 'purchase-unlock-loading'), 'parent waits for authoritative purchase');
    expect(has(pending, 'paywall-premium-presentation-purchase')).toBe(true);
    expect(pending.native.receipts.some((receipt: Receipt) => receipt.method === 'iap.finishTransaction')).toBe(false);
    expect(world.backend.purchaseLedger.size).toBe(0);
    await world.release('verify-and-apply-purchase');
    const activated = await world.waitFor(device, (value: Observation) => !has(value, 'paywall-premium-presentation-purchase') && !has(value, 'purchase-unlock-loading'), 'real parent Paywall dismissed after activation');
    expect(activated.native.receipts.filter((receipt: Receipt) => receipt.method === 'iap.finishTransaction')).toEqual([
      expect.objectContaining({ value: expect.objectContaining({
        isConsumable: plan === 'trip', purchase: expect.objectContaining({ transactionId: `parent-${plan}-transaction` }),
      }) }),
    ]);
    expect(world.backend.purchaseLedger.size).toBe(1);
    return activated;
  }

  async function enableParentLiveActivity(world: InstanceType<typeof World>, device: Device) {
    await pane(world, device, 2);
    await device.perform('map.live-activity.toggle', { enabled: true });
    const enabled = await world.waitFor(device, (value: Observation) => field(value, 'tools-live-activity-toggle')?.checked === true, 'actual parent entitlement benefit');
    expect(enabled.presentation.preferences.liveActivityEnabled).toBe(true);
    expect(has(enabled, 'paywall-premium-presentation-purchase')).toBe(false);
  }

  it('MAP-STORE-01 W04 W17 opens the actual Account registration from anonymous Map Store', async () => {
    const world = new World();
    world.backend.configureAuth({ accounts: [{ id: LEADER, is_anonymous: true }] });
    try {
      const device = await map(world);
      await pane(world, device, 3);
      const anonymous = await world.waitFor(device, (value: Observation) => has(value, 'store-register'), 'anonymous parent Store');
      expect(anonymous.presentation.session.isAnonymous).toBe(true);
      expect(has(anonymous, 'store-ad-cta')).toBe(false);
      await device.perform('map.store.register');
      await device.input({ kind: 'animation', finished: true });
      const account = await world.waitFor(device, (value: Observation) => has(value, 'account-email') && has(value, 'account-upgrade'), 'actual parent Account form');
      expect(account.presentation.route.route).toBe('Map');
      expect(account.presentation.session.user.id).toBe(LEADER);
      expect(world.backend.rewardSessions.size).toBe(0);
      expect(account.native.receipts.some((receipt: Receipt) => receipt.method === 'iap.requestPurchase')).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-STORE-01 W17 B01 B03 B04 B05 buys monthly through Map Store and refreshes parent Tools before dismissing', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await device.input({ kind: 'iapConfigure', patch: { products: [catalog.monthly] } });
      await storePaywall(world, device);
      const activated = await purchase(world, device, 'monthly');
      expect(activated.presentation.session.premiumProjection).toMatchObject({ personalPremiumActive: true, teamPremiumActive: true });
      expect(world.backend.teamPremium).toBeUndefined();
      expect(has(activated, 'store-open-subscribe')).toBe(false);
      await enableParentLiveActivity(world, device);
    } finally { await world.close(); }
  });

  it('MAP-TOOLS-01 B01 B03 B04 B05 buys annual from the locked Map Tools control and unlocks the same parent', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await device.input({ kind: 'iapConfigure', patch: { products: [catalog.annual] } });
      await pane(world, device, 2);
      await device.perform('map.live-activity.toggle', { enabled: true });
      const locked = await world.waitFor(device, (value: Observation) => has(value, 'paywall-premium-presentation-purchase'), 'Tools gate actual Paywall');
      expect(locked.presentation.preferences.liveActivityEnabled).toBe(false);
      expect(field(locked, 'tools-live-activity-toggle')?.checked).toBe(false);
      const activated = await purchase(world, device, 'annual');
      expect(activated.presentation.session.premiumProjection.personalPremiumActive).toBe(true);
      await enableParentLiveActivity(world, device);
    } finally { await world.close(); }
  });

  it('MAP-STORE-01 W17 B03 B04 B11 buys a consumable trip pass for the parent group without personal Premium', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await device.input({ kind: 'iapConfigure', patch: { products: [catalog.trip] } });
      await storePaywall(world, device);
      const activated = await purchase(world, device, 'trip');
      expect(activated.presentation.session.premiumProjection).toMatchObject({ personalPremiumActive: false, teamPremiumActive: true });
      expect(world.backend.premium.has(LEADER)).toBe(false);
      expect([...world.backend.teamPremium.keys()]).toEqual([GROUP_ID]);
      expect(world.backend.teamPremium.get(GROUP_ID)).toMatchObject({ product_id: catalog.trip.id, user_id: LEADER, status: 'active' });
      expect(world.backend.trace).toEqual(expect.arrayContaining([expect.objectContaining({
        name: 'verify-and-apply-purchase', args: expect.objectContaining({ body: expect.objectContaining({ group_id: GROUP_ID, product_id: catalog.trip.id }) }),
      })]));
      await enableParentLiveActivity(world, device);
    } finally { await world.close(); }
  });

  it('MAP-SETTINGS-01 B08 retains an invalid Settings promo then activates the real Map parent with a valid code', async () => {
    const world = new World();
    world.backend.promoCodes.set('PARENT', { plan_name: 'Parent Premium', plan_code: 'lifetime_premium', remaining_uses: 1 });
    try {
      const device = await map(world);
      await settingsPaywall(world, device);
      await device.perform('premium.promo.open');
      await device.perform('premium.promo.edit', { value: ' INVALID ' });
      await device.perform('premium.promo.submit');
      const rejected = await world.waitFor(device, (value: Observation) => value.external.alerts > 0 && field(value, 'paywall-redeem-submit')?.disabled === false, 'invalid Settings promo settled');
      expect(field(rejected, 'paywall-redeem-input')?.value).toBe(' INVALID ');
      expect(rejected.presentation.session.premiumProjection.personalPremiumActive).toBe(false);
      expect(has(rejected, 'paywall-premium-presentation-purchase')).toBe(true);
      await device.input({ kind: 'alert', index: 0 });
      await device.perform('premium.promo.edit', { value: ' PARENT ' });
      await device.perform('premium.promo.submit');
      const activated = await world.waitFor(device, (value: Observation) => value.presentation.session.premiumProjection.personalPremiumActive && !has(value, 'paywall-redeem-input'), 'Settings promo activates parent and closes form');
      expect(has(activated, 'paywall-premium-presentation-purchase')).toBe(true);
      expect(world.backend.promoCodes.get('PARENT').remaining_uses).toBe(0);
      expect(world.backend.trace).toEqual(expect.arrayContaining([expect.objectContaining({
        name: 'redeem_promo_code', args: { p_code: 'PARENT', p_group_id: GROUP_ID },
      })]));
      expect(activated.native.receipts.some((receipt: Receipt) => receipt.method === 'iap.requestPurchase')).toBe(false);
      await device.input({ kind: 'alert', index: 0 });
      await device.host.call({ kind: 'press', label: '取消' });
      await enableParentLiveActivity(world, device);
    } finally { await world.close(); }
  });

  it('MAP-SETTINGS-01 B06 restores from the actual Settings Paywall and dismisses after the parent benefit refresh', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await settingsPaywall(world, device);
      world.backend.verifiedPurchases.set('parent-restore-proof', {
        user_id: LEADER, product_id: catalog.monthly.id, expires_at: new Date(world.now + 864000000).toISOString(),
      });
      await device.input({ kind: 'iapConfigure', patch: { availablePurchases: [{
        productId: catalog.monthly.id, transactionId: 'parent-restore-transaction', purchaseToken: 'parent-restore-proof',
      }] } });
      await device.perform('premium.restore');
      const restored = await world.waitFor(device, (value: Observation) => value.presentation.session.premiumProjection.personalPremiumActive && !has(value, 'paywall-premium-presentation-purchase'), 'actual Restore dismisses Paywall');
      expect(restored.native.receipts.filter((receipt: Receipt) => receipt.method === 'iap.finishTransaction')).toEqual([
        expect.objectContaining({ value: expect.objectContaining({ isConsumable: false,
          purchase: expect.objectContaining({ transactionId: 'parent-restore-transaction' }) }) }),
      ]);
      expect(restored.native.receipts.some((receipt: Receipt) => receipt.method === 'iap.restorePurchases')).toBe(true);
      expect(world.backend.purchaseLedger.size).toBe(1);
      await enableParentLiveActivity(world, device);
    } finally { await world.close(); }
  });
});
