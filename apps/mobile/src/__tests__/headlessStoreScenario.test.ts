const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');
const { creditReward } = require('../../test/headless/backend-store.cjs');
const { configure: configureAuth } = require('../../test/headless/backend-auth.cjs');
const fs = require('node:fs');
const path = require('node:path');

const hosts = (value: { presentation: { hosts: Array<{ testId?: string; text?: string; disabled?: boolean; selected?: boolean }> } }, testId: string) =>
  value.presentation.hosts.filter(host => host.testId === testId);
const press = (device: { command: (input: object) => Promise<unknown> }, testId: string) =>
  device.command({ kind: 'host', input: { kind: 'press', testId } });

describe.each(['ios', 'android'])('mounted Store and Premium scenarios on %s', platform => {
  jest.setTimeout(90000);

  it('W01 W07 W09 W10 W11 W13 W14 W16 W17 executes Store callbacks and waits for external SSV before credit', async () => {
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
      await world.advance(30000);
      expect(world.backend.rewardSessions.get(sessionRef).status).toBe('verifying');
      expect(hosts(await device.observe(), 'store-ad-cta')[0].disabled).toBe(false);
      creditReward(world.backend, sessionRef);
      await world.advance(8000);
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
    world.backend.profiles.get(PEER).preferences = { quickCommands: [{ label: 'Meet here', message: ' Please meet here ' }, null, null] };
    try {
      const device = await world.device({ id: 'commands', userId: PEER, platform, screen: { name: 'QuickCommands', params: { groupId: GROUP_ID } } });
      await world.waitFor(device, (value: any) => hosts(value, 'quick-command-custom-0').length === 1, 'actual command grid');
      await device.perform('session.membership', { args: [{ group: { id: GROUP_ID, name: 'Headless team', inviteCode: 'TEST42' }, role: 'follower' }] });
      expect(hosts(await device.observe(), 'quick-command-gather')).toEqual([]);
      expect(hosts(await device.observe(), 'quick-command-need_help')).toHaveLength(1);
      await device.perform('commands.custom', { slot: 1 });
      expect((await device.observe()).presentation.receipts).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'onConfigureCustom', args: [1] })]));
      expect(world.backend.notificationOutbox).toEqual([]);
      device.online = false;
      await device.perform('commands.custom', { slot: 0 });
      const pending = await world.waitFor(device, (value: any) => value.durable.operations.some((operation: any) => operation.operationType === 'send_command'), 'durable offline custom command');
      const operation = pending.durable.operations.find((row: any) => row.operationType === 'send_command');
      expect(operation.actorId).toBe(PEER);
      expect(operation.payload).toMatchObject({ type: 'custom', message: 'Please meet here', expiresAt: new Date(world.now + 300000).toISOString() });
      expect(world.backend.notificationOutbox).toEqual([]);
      device.online = true;
      await world.advance(1000);
      await device.perform('commands.flush', { args: [] });
      await world.waitFor(device, () => world.backend.notificationOutbox.length === 1, 'replayed actual command');
      expect(world.backend.notificationOutbox[0]).toMatchObject({ group_id: GROUP_ID, sender_id: PEER, target_user_id: LEADER, payload: { type: 'custom', message: 'Please meet here' } });
    } finally { await world.close(); }
  });

  it('W02 W03 restores the owned offline snapshot and consumes a highlighted product once', async () => {
    const world = new World();
    world.backend.wallets.set(LEADER, 8);
    try {
      const device = await world.device({ id: 'store-cache', userId: LEADER, platform, screen: { name: 'Store',
        params: { groupId: GROUP_ID }, props: { highlightProductCode: 'team_extra_points_3' } } });
      await world.waitFor(device, (value: any) => hosts(value, 'store-product-pinned').length === 1, 'pinned product');
      expect(hosts(await device.observe(), 'store-redeem-team_extra_points_3')).toHaveLength(1);
      await world.advance(280);
      const highlighted = await device.observe();
      expect(highlighted.presentation.receipts.filter((receipt: any) => receipt.method === 'onHighlightConsumed')).toHaveLength(1);
      expect(highlighted.presentation.receipts.some((receipt: any) => receipt.method === 'setAccessibilityFocus')).toBe(true);
      device.online = false;
      await device.input({ kind: 'appState', value: 'background' });
      await device.input({ kind: 'appState', value: 'active' });
      await world.waitFor(device, (value: any) => hosts(value, 'store-offline-banner').length === 1, 'offline Store');
      expect(hosts(await device.observe(), 'store-ad-cta')[0].disabled).toBe(true);
      await device.restart();
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.text === '8') && hosts(value, 'store-offline-banner').length === 1, 'persisted owned wallet');
      await device.command({ kind: 'mount', screen: { name: 'Store', params: { groupId: 'other-team' } } });
      await world.waitFor(device, (value: any) => !hosts(value, 'store-loading').length, 'other group load settles');
      expect((await device.observe()).presentation.hosts.some((host: any) => host.text === '8')).toBe(false);
    } finally { await world.close(); }
  });

  it('W04 W17 B02 renders registration guards from the actual anonymous auth session', async () => {
    const world = new World();
    configureAuth(world.backend, { accounts: [{ id: LEADER, is_anonymous: true }] });
    try {
      const device = await world.device({ id: 'anonymous-store', userId: LEADER, platform, screen: { name: 'Store' } });
      await world.waitFor(device, (value: any) => value.presentation.session?.isAnonymous && hosts(value, 'store-register').length === 1, 'real anonymous Store gate');
      expect(hosts(await device.observe(), 'store-ad-cta')).toEqual([]);
      await device.perform('store.register');
      expect((await device.observe()).presentation.receipts.some((receipt: any) => receipt.method === 'onRequireRegistration')).toBe(true);
      expect(world.backend.rewardSessions.size).toBe(0);
      await device.command({ kind: 'mount', screen: { name: 'Premium' } });
      await device.command({ kind: 'host', input: { kind: 'press', testId: 'premium-presentation-purchase' } });
      await world.waitFor(device, (value: any) => value.external.alerts > 0, 'anonymous purchase rejected');
      expect((await device.observe()).native.receipts.some((call: any) => call.method === 'iap.requestPurchase')).toBe(false);
      expect(world.backend.purchaseLedger.size).toBe(0);
    } finally { await world.close(); }
  });

  it('W05 W08 W12 fails an empty ad session and silently probes inventory without showing an ad', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'store-fill', userId: LEADER, platform, screen: { name: 'Store' } });
      await world.waitFor(device, (value: any) => hosts(value, 'store-ad-cta').length === 1 && !hosts(value, 'store-loading').length, 'Store ready');
      await device.perform('store.watch-ad');
      await world.waitFor(device, (value: any) => value.native.ads.length === 1, 'first ad loading');
      await device.input({ kind: 'adEvent', event: 'error', value: { message: 'No fill', code: 'no-fill' } });
      await world.waitFor(device, () => [...world.backend.rewardSessions.values()].every((session: any) => session.status === 'failed'), 'empty session failed');
      expect(hosts(await device.observe(), 'store-ad-cta')[0].disabled).toBe(false);
      await world.advance(12000);
      await world.waitFor(device, (value: any) => value.native.ads.length === 2, 'silent fill probe started');
      await device.input({ kind: 'adEvent', event: 'loaded' });
      await world.waitFor(device, () => [...world.backend.rewardSessions.values()].every((session: any) => session.status === 'failed'), 'probe releases session');
      const result = await device.observe();
      expect(result.native.receipts.some((call: any) => call.method === 'ads.show')).toBe(false);
      expect(result.native.ads.every((ad: any) => ad.listeners === 0)).toBe(true);
      expect(world.backend.wallets.get(LEADER) ?? 0).toBe(0);
      device.online = false;
      await device.input({ kind: 'appState', value: 'background' });
      await device.input({ kind: 'appState', value: 'active' });
      await world.waitFor(device, (value: any) => hosts(value, 'store-offline-banner').length === 1, 'offline preflight');
      expect(await device.perform('store.watch-ad')).toEqual({ invoked: false, reason: 'disabled' });
      expect(world.backend.rewardSessions.size).toBe(2);
    } finally { await world.close(); }
  });

  it('W13 W14 W15 W16 preserves the redemption request key after a lost response and clears business failures', async () => {
    const world = new World();
    world.backend.wallets.set(LEADER, 12);
    try {
      const device = await world.device({ id: 'redeem-retry', userId: LEADER, platform, screen: { name: 'Store', params: { groupId: GROUP_ID } } });
      await world.waitFor(device, (value: any) => !hosts(value, 'store-loading').length && hosts(value, 'store-ad-cta').length === 1, 'wallet ready');
      await device.perform('store.redeem', { productCode: 'team_extra_points_3' });
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.redemptions.size).toBe(0);
      world.hold('redeem_store_product', { phase: 'delivery' });
      await device.perform('store.redeem', { productCode: 'team_extra_points_3' });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, () => world.backend.redemptions.size === 1, 'server accepted held redemption');
      const first = world.backend.trace.find((call: any) => call.name === 'redeem_store_product');
      const pendingKeys = () => Object.entries(JSON.parse(fs.readFileSync(path.join(world.directory, 'redeem-retry', 'async.json'), 'utf8')))
        .filter(([key]) => key.startsWith('hither.store.pending_redeem.v1:'));
      expect(pendingKeys()).toHaveLength(1);
      expect(JSON.parse(String(pendingKeys()[0][1])).clientRequestKey).toBe(first.args.p_client_request_key);
      await device.restart();
      await world.release('redeem_store_product');
      await world.waitFor(device, (value: any) => hosts(value, 'store-redeem-team_extra_points_3').length === 1 && !hosts(value, 'store-loading').length, 'restored Store');
      await device.perform('store.redeem', { productCode: 'team_extra_points_3' });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: any) => value.presentation.receipts.some((receipt: any) => receipt.method === 'onEntitlementChanged'), 'idempotent retry done');
      const retries = world.backend.trace.filter((call: any) => call.name === 'redeem_store_product');
      expect(retries).toHaveLength(2);
      expect(retries[1].args.p_client_request_key).toBe(first.args.p_client_request_key);
      expect(world.backend.pointCredits.get(GROUP_ID)).toBe(3);
      expect(world.backend.wallets.get(LEADER)).toBe(8);
      world.backend.wallets.set(LEADER, 20);
      await device.input({ kind: 'appState', value: 'active' });
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.text === '20'), 'new authoritative wallet');
      await device.perform('store.redeem', { productCode: 'personal_live_activity_lifetime' });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, () => world.backend.liveUnlocks?.has(LEADER), 'personal redemption');
      expect(world.backend.trace.filter((call: any) => call.name === 'redeem_store_product').at(-1).args.p_group_id).toBeNull();
      world.backend.wallets.set(LEADER, 0);
      await device.perform('store.redeem', { productCode: 'team_extra_points_3' });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: any) => value.external.alerts > 0, 'insufficient balance alert');
      expect(world.backend.pointCredits.get(GROUP_ID)).toBe(3);
      expect(pendingKeys()).toEqual([]);
    } finally { await world.close(); }
  });

  it('B06 B08 restores verified subscriptions and rejects an invalid promo through actual presentation callbacks', async () => {
    const world = new World();
    const productId = 'app.hither.premium.monthly';
    try {
      const device = await world.device({ id: 'restore', userId: LEADER, platform, screen: { name: 'NotificationPreferences' } });
      await world.waitFor(device, (value: any) => !value.presentation.session.initializing, 'provider ready');
      await device.input({ kind: 'iapConfigure', patch: { availablePurchases: [
        { productId: 'app.hither.premium.annual', transactionId: 'tx-unverified', purchaseToken: 'invalid-proof' },
        { productId, transactionId: 'tx-restore', purchaseToken: 'restore-proof' },
      ] } });
      await device.command({ kind: 'mount', screen: { name: 'Premium' } });
      await press(device, 'premium-presentation-redeem');
      await device.perform('premium.promo.edit', { value: ' INVALID ' });
      await device.perform('premium.promo.submit');
      await world.waitFor(device, () => world.backend.trace.some((call: any) => call.name === 'redeem_promo_code'), 'promo RPC');
      expect(world.backend.trace.find((call: any) => call.name === 'redeem_promo_code').args.p_code).toBe('INVALID');
      expect((await device.observe()).presentation.receipts.some((receipt: any) => receipt.method === 'onPurchaseSuccess')).toBe(false);
      world.backend.verifiedPurchases.set('restore-proof', { user_id: LEADER, product_id: productId, expires_at: new Date(world.now + 86400000).toISOString() });
      await press(device, 'premium-presentation-restore');
      const restored = await world.waitFor(device, (value: any) => value.presentation.receipts.some((receipt: any) => receipt.method === 'onRestoreSuccess'), 'real restore activation');
      expect(restored.presentation.session.premiumProjection.personalPremiumActive).toBe(true);
      expect(restored.native.receipts.filter((call: any) => call.method === 'iap.finishTransaction')).toHaveLength(1);
      expect(restored.native.receipts.find((call: any) => call.method === 'iap.finishTransaction').value.purchase.transactionId).toBe('tx-restore');
    } finally { await world.close(); }
  });

  it('B07 B10 B11 B12 recovers unfinished purchases and denies personal access after authoritative revocation', async () => {
    const world = new World();
    const productId = 'app.hither.premium.monthly';
    try {
      const device = await world.device({ id: 'recovery', userId: LEADER, platform, screen: { name: 'NotificationPreferences' } });
      await world.waitFor(device, (value: any) => !value.presentation.session.initializing, 'provider ready');
      await device.input({ kind: 'iapConfigure', patch: { availablePurchases: [{ productId, transactionId: 'tx-recovery', purchaseToken: 'recovery-proof' }] } });
      world.hold('verify-and-apply-purchase');
      await device.command({ kind: 'mount', screen: { name: 'NativeObservers', props: { premiumRecovery: true } } });
      await world.waitFor(device, () => world.held.some((request: any) => request.operation.name === 'verify-and-apply-purchase'), 'recovery verification');
      await device.input({ kind: 'appState', value: 'active' });
      await device.input({ kind: 'appState', value: 'active' });
      expect(world.held.filter((request: any) => request.operation.name === 'verify-and-apply-purchase')).toHaveLength(1);
      expect((await device.observe()).native.receipts.some((call: any) => call.method === 'iap.finishTransaction')).toBe(false);
      world.backend.verifiedPurchases.set('recovery-proof', { user_id: LEADER, product_id: productId, expires_at: new Date(world.now + 86400000).toISOString() });
      await world.release('verify-and-apply-purchase');
      await world.waitFor(device, (value: any) => value.presentation.session.premiumProjection.personalPremiumActive, 'recovered entitlement');
      const before = world.backend.trace.filter((call: any) => call.name === 'get_premium_projection').length;
      const cached = await device.perform('premium.flow.ensurePersonalPremiumAccess', { args: [{ userId: LEADER, cacheStale: false, cachedLive: true }] });
      expect(cached.allowed).toBe(true);
      expect(world.backend.trace.filter((call: any) => call.name === 'get_premium_projection')).toHaveLength(before);
      world.backend.premium.delete(LEADER);
      world.backend.teamPremium = new Map([[GROUP_ID, { status: 'active', expires_at: new Date(world.now + 86400000).toISOString() }]]);
      const revoked = await device.perform('premium.flow.ensurePersonalPremiumAccess', { args: [{ userId: LEADER, groupId: GROUP_ID, cacheStale: true, cachedLive: false }] });
      expect(revoked.allowed).toBe(false);
      expect(revoked.projection).toMatchObject({ personalPremiumActive: false, teamPremiumActive: true });
      await expect(device.perform('premium.direct-write-rejected', { args: [LEADER] })).rejects.toThrow('entitlement_write_forbidden');
    } finally { await world.close(); }
  });

  it('N03 N09 N10 N11 N12 N13 N14 dispatches real role-scoped realtime notifications and removes listeners on exit', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'dispatch', userId: PEER, platform, screen: { name: 'NotificationPreferences' } });
      await world.waitFor(device, (value: any) => !value.presentation.session.initializing, 'recipient ready');
      await device.perform('session.membership', { args: [{ group: { id: GROUP_ID, name: 'Headless team', inviteCode: 'TEST42' }, role: 'follower' }] });
      await device.command({ kind: 'mount', screen: { name: 'NativeObservers' } });
      await world.waitFor(device, (value: any) => value.native.listeners.notification === 1, 'real notification hook subscribed');
      await world.waitFor(device, () => world.backend.tables.push_tokens.some((row: any) => row.user_id === PEER && row.platform === platform), 'platform-scoped native token registration');
      expect(world.backend.tables.push_tokens.find((row: any) => row.user_id === PEER)).toMatchObject({ token: `fixture-${platform}-native-push`, device_id: expect.any(String) });
      const event = async (table: string, row: object, eventType = 'INSERT', old = {}) => {
        await device.command({ kind: 'event', event: { table, eventType, new: row, old } });
        await world.settle();
      };
      await event('commands', { id: 'command-1', group_id: GROUP_ID, sender_id: LEADER, type: 'gather', message: 'Gather now' });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 1, 'leader command delivered');
      const first = (await device.observe()).native.scheduled[0].input.content;
      expect(first).toMatchObject({ title: 'Leader', body: 'Gather now', data: { category: 'leaderCommands', senderId: LEADER } });
      await device.input({ kind: 'notification', content: first });
      await event('commands', { id: 'command-1', group_id: GROUP_ID, sender_id: LEADER, type: 'gather', message: 'Gather now' });
      await event('commands', { id: 'own-command', group_id: GROUP_ID, sender_id: PEER, type: 'need_help', message: 'Own' });
      await event('commands', { id: 'request-command', group_id: GROUP_ID, sender_id: LEADER, type: 'request_start', message: 'Leader only' });
      expect((await device.observe()).native.scheduled).toHaveLength(1);
      await event('commands', { id: 'unknown-custom', group_id: GROUP_ID, sender_id: 'unknown-sender', type: 'custom', message: 'Unknown role stays a follower request' });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 2, 'unknown custom role classified');
      expect((await device.observe()).native.scheduled.at(-1).input.content.data.category).toBe('followerRequests');
      await event('itinerary_items', { id: 'added-stop', group_id: GROUP_ID, created_by: LEADER, title: 'New meeting' });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 3, 'gathering addition delivered');
      await event('group_alerts', { id: 'not-straggler', group_id: GROUP_ID, sender_id: LEADER, kind: 'other' });
      expect((await device.observe()).native.scheduled).toHaveLength(3);
      await event('group_alerts', { id: 'straggler-1', group_id: GROUP_ID, sender_id: LEADER, kind: 'straggler', member_name: 'Late peer', distance_m: 500 });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 4, 'straggler alert delivered');
      await event('groups', { id: GROUP_ID, journey_status: 'going', active_destination_id: DESTINATION }, 'UPDATE', { journey_status: 'paused' });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 5, 'follower journey alert delivered');
      world.backend.itinerary[0].closed_at = new Date(world.now).toISOString();
      await event('groups', { id: GROUP_ID, journey_status: 'paused', active_destination_id: DESTINATION }, 'UPDATE', { journey_status: 'going', active_destination_id: DESTINATION });
      expect((await device.observe()).native.scheduled).toHaveLength(5);
      world.backend.itinerary[0].closed_at = null;
      await event('destination_arrivals', { id: 'peer-arrival', group_id: GROUP_ID, destination_id: DESTINATION, user_id: LEADER });
      expect((await device.observe()).native.scheduled).toHaveLength(5);
      world.backend.memberships.find((row: any) => row.user_id === PEER).solo = true;
      await event('itinerary_items', { id: 'solo-stop', group_id: GROUP_ID, created_by: LEADER, title: 'Muted while solo' });
      expect((await device.observe()).native.scheduled).toHaveLength(5);
      await event('destination_arrivals', { id: 'own-arrival', group_id: GROUP_ID, destination_id: DESTINATION, user_id: PEER });
      await world.waitFor(device, (value: any) => value.presentation.receipts.some((receipt: any) => receipt.method === 'onAppNotice' && receipt.args[0]?.id?.startsWith('arrival:')), 'own arrival dispatch state');
      world.backend.memberships.find((row: any) => row.user_id === PEER).solo = false;
      world.backend.tables.notification_preferences = [{ user_id: PEER, add_gathering: false, leader_commands: true, follower_requests: true, journey: true, arrival: true }];
      await event('itinerary_items', { id: 'muted-stop', group_id: GROUP_ID, created_by: LEADER, title: 'Muted' });
      expect((await device.observe()).native.scheduled).toHaveLength(5);
      world.hold('notification_preferences');
      await event('commands', { id: 'old-account-await', group_id: GROUP_ID, sender_id: LEADER, type: 'gather', message: 'Old account' });
      await world.waitFor(device, () => world.held.some((request: any) => request.operation.name === 'notification_preferences'), 'held old actor preference read');
      await device.input({ kind: 'account', userId: LEADER });
      await world.advance(0);
      await world.waitFor(device, (value: any) => value.presentation.session.user?.id === LEADER, 'actual replacement account committed');
      await world.release('notification_preferences');
      expect((await device.observe()).native.scheduled).toHaveLength(5);
      await device.command({ kind: 'mount', screen: { name: 'NotificationPreferences' } });
      const detached = await device.observe();
      expect(detached.native.listeners).toMatchObject({ notification: 0, live: 0 });
      await event('commands', { id: 'after-unmount', group_id: GROUP_ID, sender_id: LEADER, type: 'gather', message: 'No listener' });
      expect((await device.observe()).native.scheduled).toHaveLength(5);
    } finally { await world.close(); }
  });

  it('L01 L02 L03 L04 L05 L06 L07 L08 L09 adopts only its scoped activity and persists throttled native updates', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'live', userId: LEADER, platform, screen: { name: 'NotificationPreferences' } });
      await world.waitFor(device, (value: any) => !value.presentation.session.initializing, 'activity actor ready');
      const activitySession = { groupId: GROUP_ID, destinationId: DESTINATION, navigationSessionId: 'navigation-live', initialDistanceM: 1000, travelMode: 'walk' };
      const state = { groupName: 'Headless team', gatheringTitle: 'Meeting point', distanceMeters: 100, etaSeconds: 90,
        progress: 0.9, accentHex: '#123456', travelMode: 'walk', sampledAtMs: world.now };
      await device.input({ kind: 'liveExisting', activities: [{ activityId: 'existing-activity', destinationId: DESTINATION, navigationSessionId: 'navigation-live', pushToken: 'old-token', state }] });
      await device.command({ kind: 'mount', screen: { name: 'NativeObservers', props: { activityState: state } } });
      expect((await device.observe()).native.activities).toHaveLength(1);
      expect((await device.observe()).native.receipts.some((call: any) => call.method === 'live.endAllGroupActivities')).toBe(false);
      const mount = (activityState: object, activityActive = true) => device.command({ kind: 'mount', screen: { name: 'NativeObservers', props: { activityState, activityActive, activitySession } } });
      await mount(state);
      await world.waitFor(device, () => world.backend.tables.live_activity_sessions.length === 1, 'adopted activity persisted');
      expect((await device.observe()).native.receipts.some((call: any) => call.method === 'live.startGroupActivity')).toBe(false);
      const writes = () => world.backend.trace.filter((call: any) => call.name === 'live_activity_sessions' && call.steps.some((step: any) => step[0] === 'upsert')).length;
      const before = writes();
      await device.input({ kind: 'livePushToken', event: { activityId: 'existing-activity', navigationSessionId: 'wrong-scope', destinationId: DESTINATION, pushToken: 'wrong-token' } });
      await world.settle();
      expect(writes()).toBe(before);
      await device.input({ kind: 'livePushToken', event: { activityId: 'existing-activity', navigationSessionId: 'navigation-live', destinationId: DESTINATION, pushToken: 'new-token' } });
      await world.waitFor(device, () => world.backend.tables.live_activity_sessions[0]?.push_token === 'new-token', 'matching token persisted');
      await device.input({ kind: 'livePushToStart', token: 'push-to-start' });
      await world.waitFor(device, () => world.backend.tables.device_live_activity_tokens.some((row: any) => row.push_to_start_token === 'push-to-start'), 'device token registered');
      expect(world.backend.tables.device_live_activity_tokens.find((row: any) => row.push_to_start_token === 'push-to-start')).toMatchObject({ user_id: LEADER, live_activities_enabled: true, accent_hex: '#123456' });
      const tokenWrites = world.backend.trace.filter((call: any) => call.name === 'device_live_activity_tokens' && call.steps.some((step: any) => step[0] === 'upsert')).length;
      await device.input({ kind: 'livePushToStart', token: 'push-to-start' });
      await world.settle();
      expect(world.backend.trace.filter((call: any) => call.name === 'device_live_activity_tokens' && call.steps.some((step: any) => step[0] === 'upsert'))).toHaveLength(tokenWrites);
      await mount({ ...state, gatheringTitle: 'Semantic update' });
      await world.settle();
      const updates = () => (device.observe()).then((value: any) => value.native.receipts.filter((call: any) => call.method === 'live.updateGroupActivity').length);
      const updatesBefore = await updates();
      await mount({ ...state, gatheringTitle: 'Semantic update', distanceMeters: 80 });
      await world.settle();
      expect(await updates()).toBe(updatesBefore);
      await world.advance(5000);
      expect(await updates()).toBe(updatesBefore + 1);
      await device.perform('live.service.updateLiveActivityProgress', { args: [GROUP_ID, DESTINATION, { distanceMeters: 70, etaSeconds: 42.6, progress: 0.5 }] });
      expect(world.backend.tables.live_activity_sessions[0]).toMatchObject({ current_distance_m: 70, eta_seconds: 43, last_progress_bucket: 10 });
      const progressWrites = world.backend.trace.filter((call: any) => call.name === 'live_activity_sessions').length;
      await device.perform('live.service.updateLiveActivityProgress', { args: [GROUP_ID, DESTINATION, { distanceMeters: null, etaSeconds: null, progress: 0.5 }] });
      expect(world.backend.trace.filter((call: any) => call.name === 'live_activity_sessions')).toHaveLength(progressWrites);
      await device.perform('live.clear', { args: [{ localOnly: true }] });
      expect((await device.observe()).native.activities).toEqual([]);
      expect(world.backend.tables.live_activity_sessions).toHaveLength(1);
      await mount(state, false);
      await world.waitFor(device, (value: any) => value.native.activities.length === 0 && world.backend.tables.live_activity_sessions.length === 0, 'explicit stop clears activity and owned sessions');
      await device.command({ kind: 'mount', screen: { name: 'NotificationPreferences' } });
      expect((await device.observe()).native.listeners).toMatchObject({ live: 0, notification: 0 });
    } finally { await world.close(); }
  });

  it('B03 B04 B11 binds an actual consumable purchase to the selected group and finishes only after its team grant', async () => {
    const world = new World();
    const productId = 'hither.small_trip_pass';
    try {
      const device = await world.device({ id: 'trip-purchase', userId: LEADER, platform, screen: { name: 'NotificationPreferences' } });
      await world.waitFor(device, (value: any) => !value.presentation.session.initializing, 'trip actor ready');
      await device.input({ kind: 'iapConfigure', patch: { products: [{ id: productId, type: 'in-app', displayName: 'Trip', displayPrice: '$2', price: 2, currency: 'USD' }] } });
      await device.perform('session.membership', { args: [{ group: { id: GROUP_ID, name: 'Headless team', inviteCode: 'TEST42' }, role: 'leader' }] });
      await device.command({ kind: 'mount', screen: { name: 'Premium' } });
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.text === '$2'), 'trip price');
      await press(device, 'premium-presentation-plan-trip');
      await press(device, 'premium-presentation-purchase');
      await world.waitFor(device, (value: any) => value.native.receipts.some((call: any) => call.method === 'iap.requestPurchase'), 'actual consumable purchase request');
      world.backend.verifiedPurchases.set('trip-proof', { user_id: LEADER, product_id: productId, group_id: GROUP_ID, expires_at: new Date(world.now + 864000000).toISOString() });
      await device.input({ kind: 'iapPurchase', purchase: { productId, transactionId: 'tx-trip', purchaseToken: 'trip-proof' } });
      const purchased = await world.waitFor(device, (value: any) => value.presentation.receipts.some((receipt: any) => receipt.method === 'onPurchaseSuccess'), 'verified trip activation');
      expect(purchased.presentation.session.premiumProjection).toMatchObject({ personalPremiumActive: false, teamPremiumActive: true });
      expect(purchased.native.receipts.find((call: any) => call.method === 'iap.finishTransaction').value.isConsumable).toBe(true);
      expect(world.backend.trace.find((call: any) => call.name === 'verify-and-apply-purchase').args.body.group_id).toBe(GROUP_ID);
      expect(world.backend.premium.has(LEADER)).toBe(false);
    } finally { await world.close(); }
  });

  it('B08 clears the actual promo form only after the authoritative personal projection activates', async () => {
    const world = new World();
    world.backend.promoCodes.set('HEADLESS', { plan_name: 'Headless Premium', plan_code: 'lifetime_premium', remaining_uses: 1 });
    try {
      const device = await world.device({ id: 'promo-success', userId: LEADER, platform, screen: { name: 'Premium' } });
      await world.waitFor(device, (value: any) => hosts(value, 'premium-presentation-redeem').length === 1, 'actual promo entry');
      await press(device, 'premium-presentation-redeem');
      await device.perform('premium.promo.edit', { value: ' HEADLESS ' });
      await device.perform('premium.promo.submit');
      const redeemed = await world.waitFor(device, (value: any) => value.presentation.receipts.some((receipt: any) => receipt.method === 'onEntitlementActivated'), 'promo projection activated');
      expect(redeemed.presentation.session.premiumProjection.personalPremiumActive).toBe(true);
      expect(hosts(redeemed, 'paywall-redeem-input')).toEqual([]);
      expect(world.backend.promoCodes.get('HEADLESS').remaining_uses).toBe(0);
      expect(world.backend.trace.find((call: any) => call.name === 'redeem_promo_code').args).toEqual({ p_code: 'HEADLESS', p_group_id: null });
      expect(redeemed.native.receipts.some((call: any) => call.method === 'iap.requestPurchase')).toBe(false);
    } finally { await world.close(); }
  });
});
