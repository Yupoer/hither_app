const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID } = require('../../test/headless/backend.cjs');
const { creditReward } = require('../../test/headless/backend-store.cjs');

const hosts = (value: { presentation: { hosts: Array<{ testId?: string; text?: string; disabled?: boolean; selected?: boolean }> } }, testId: string) =>
  value.presentation.hosts.filter(host => host.testId === testId);
const press = (device: { command: (input: object) => Promise<unknown> }, testId: string) =>
  device.command({ kind: 'host', input: { kind: 'press', testId } });

describe.each(['ios', 'android'])('mounted Store and Premium scenarios on %s', platform => {
  jest.setTimeout(90000);

  it('W01 W07 W09 W10 W13 W14 W16 W17 executes Store callbacks and waits for external SSV before credit', async () => {
    const world = new World();
    world.backend.wallets.set(LEADER, 12);
    try {
      const device = await world.device({ id: 'store', userId: LEADER, platform, screen: { name: 'Store', params: { groupId: GROUP_ID } } });
      await world.waitFor(device, (value: any) => hosts(value, 'store-ad-cta').length === 1 && !hosts(value, 'store-loading').length, 'real Store loaded');
      expect(world.backend.trace.some((call: any) => call.name === 'get_store_snapshot' && call.args.p_group_id === GROUP_ID)).toBe(true);
      await press(device, 'store-open-subscribe');
      expect((await device.observe()).presentation.receipts).toEqual(expect.arrayContaining([expect.objectContaining({ host: 'Store', method: 'onOpenSubscribe' })]));
      await press(device, 'store-ad-cta');
      const loading = await world.waitFor(device, (value: any) => value.native.ads.length === 1, 'actual ad SDK request');
      const sessionRef = loading.native.ads[0].options.serverSideVerificationOptions.customData;
      expect(world.backend.rewardSessions.get(sessionRef)).toMatchObject({ user_id: LEADER, platform, status: 'active' });
      await device.input({ kind: 'adEvent', event: 'loaded' });
      await world.waitFor(device, (value: any) => value.native.receipts.some((call: any) => call.method === 'ads.show'), 'actual ad showing');
      await device.input({ kind: 'adEvent', event: 'earned', value: { amount: 999 } });
      await device.input({ kind: 'adEvent', event: 'closed' });
      await world.waitFor(device, () => world.backend.rewardSessions.get(sessionRef).status === 'verifying', 'server verification pending');
      expect(world.backend.wallets.get(LEADER)).toBe(12);
      expect(hosts(await device.observe(), 'store-ad-cta')[0].disabled).toBe(true);
      creditReward(world.backend, sessionRef);
      await world.advance(1500);
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.text === '13'), 'authoritative wallet credit');
      expect(world.backend.wallets.get(LEADER)).toBe(13);
      await press(device, 'store-redeem-team_extra_points_3');
      expect(world.backend.pointCredits?.get(GROUP_ID) ?? 0).toBe(0);
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, () => world.backend.pointCredits?.get(GROUP_ID) === 3, 'confirmed redemption');
      const redemption = world.backend.trace.find((call: any) => call.name === 'redeem_store_product');
      expect(redemption.args).toMatchObject({ p_group_id: GROUP_ID, p_product_code: 'team_extra_points_3', p_client_request_key: expect.any(String) });
      expect(world.backend.wallets.get(LEADER)).toBe(9);
      await world.waitFor(device, (value: any) => value.presentation.receipts.some((receipt: any) => receipt.method === 'onEntitlementChanged'), 'Store refresh callback');
    } finally { await world.close(); }
  });

  it('B01 B02 B03 B04 B05 selects the actual plan and never finishes a purchase before server verification', async () => {
    const world = new World();
    const productId = 'app.hither.premium.annual';
    try {
      const device = await world.device({ id: 'premium', userId: LEADER, platform, screen: { name: 'Store' } });
      await world.waitFor(device, (value: any) => hosts(value, 'store-pane').length > 0, 'provider initialization');
      await device.input({ kind: 'iapConfigure', patch: { products: [{ id: productId, type: 'subs', displayName: 'Annual',
        displayPrice: '$20', price: 20, currency: 'USD', subscriptionGroupIdIOS: 'premium' }] } });
      await device.command({ kind: 'mount', screen: { name: 'Premium' } });
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.text === '$20'), 'native localized catalog');
      await press(device, 'premium-presentation-plan-monthly');
      expect(hosts(await device.observe(), 'premium-presentation-plan-monthly')[0].selected).toBe(true);
      await press(device, 'premium-presentation-plan-annual');
      world.hold('verify-and-apply-purchase');
      await press(device, 'premium-presentation-purchase');
      await world.waitFor(device, (value: any) => value.native.receipts.some((call: any) => call.method === 'iap.requestPurchase'), 'native purchase request');
      world.backend.verifiedPurchases.set('fixture-verified-jws', { user_id: LEADER, product_id: productId, expires_at: new Date(world.now + 86400000).toISOString() });
      await device.input({ kind: 'iapPurchase', purchase: { productId, transactionId: 'tx-annual', purchaseToken: 'fixture-verified-jws', appAccountToken: LEADER } });
      await world.waitFor(device, (value: any) => value.pending.length > 0, 'held server verification');
      expect((await device.observe()).native.receipts.some((call: any) => call.method === 'iap.finishTransaction')).toBe(false);
      expect(world.backend.premium.has(LEADER)).toBe(false);
      await world.release('verify-and-apply-purchase');
      const result = await world.waitFor(device, (value: any) => value.presentation.receipts.some((receipt: any) => receipt.method === 'onPurchaseSuccess'), 'authoritative Premium activation');
      expect(result.native.receipts.filter((call: any) => call.method === 'iap.finishTransaction')).toEqual([expect.objectContaining({ value: expect.objectContaining({ isConsumable: false }) })]);
      expect(result.presentation.session.premiumProjection.personalPremiumActive).toBe(true);
      expect(world.backend.purchaseLedger.size).toBe(1);
    } finally { await world.close(); }
  });

  it('N01 N02 loads all five actual preference toggles and rolls back a rejected optimistic change', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'preferences', userId: LEADER, platform, screen: { name: 'NotificationPreferences' } });
      await world.waitFor(device, (value: any) => hosts(value, 'notification-preference-arrival').length === 1, 'actual notification preferences');
      for (const [key, wire] of [['addGathering', 'add_gathering'], ['leaderCommands', 'leader_commands'],
        ['followerRequests', 'follower_requests'], ['journey', 'journey'], ['arrival', 'arrival']]) {
        await device.perform(`notifications.preference.${key}`, { value: false });
        await world.waitFor(device, () => world.backend.tables.notification_preferences[0]?.[wire] === false, `persisted ${key}`);
      }
      expect(world.backend.tables.notification_preferences[0]).toMatchObject({ user_id: LEADER, add_gathering: false,
        leader_commands: false, follower_requests: false, journey: false, arrival: false });
      device.online = false;
      await device.perform('notifications.preference.arrival', { value: true });
      await world.waitFor(device, (value: any) => value.external.alerts > 0, 'actual failed preference alert');
      expect(hosts(await device.observe(), 'notification-preference-arrival')[0]).toMatchObject({ checked: false });
      expect(world.backend.tables.notification_preferences[0].arrival).toBe(false);
    } finally { await world.close(); }
  });

  it('N16 invokes actual QuickCommands role guards and persists an offline custom notification before replay', async () => {
    const world = new World();
    world.backend.profiles.get(LEADER).preferences = { quickCommands: [{ label: 'Meet here', message: ' Please meet here ' }, null, null] };
    try {
      const device = await world.device({ id: 'commands', userId: LEADER, platform, screen: { name: 'QuickCommands', params: { groupId: GROUP_ID } } });
      await world.waitFor(device, (value: any) => hosts(value, 'quick-command-custom-0').length === 1, 'actual command grid');
      expect(hosts(await device.observe(), 'quick-command-gather')).toEqual([]);
      expect(hosts(await device.observe(), 'quick-command-need_help')).toHaveLength(1);
      await device.perform('commands.custom', { slot: 1 });
      expect((await device.observe()).presentation.receipts).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'onConfigureCustom', args: [1] })]));
      expect(world.backend.tables.commands).toEqual([]);
      device.online = false;
      await device.perform('commands.custom', { slot: 0 });
      const pending = await world.waitFor(device, (value: any) => value.durable.operations.some((operation: any) => operation.operationType === 'send_command'), 'durable offline custom command');
      const operation = pending.durable.operations.find((row: any) => row.operationType === 'send_command');
      expect(operation.payload).toMatchObject({ type: 'custom', message: 'Please meet here', expiresAt: new Date(world.now + 300000).toISOString() });
      expect(world.backend.tables.commands).toEqual([]);
      device.online = true;
      await world.advance(30000);
      await world.waitFor(device, () => world.backend.tables.commands.length === 1, 'replayed actual command');
      expect(world.backend.tables.commands[0]).toMatchObject({ group_id: GROUP_ID, sender_id: LEADER, type: 'custom', message: 'Please meet here' });
    } finally { await world.close(); }
  });
});
