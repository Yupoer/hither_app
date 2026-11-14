const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID } = require('../../test/headless/backend.cjs');
const { creditReward } = require('../../test/headless/backend-store.cjs');

type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type Observation = {
  presentation: {
    hosts: { testId?: string; text?: string; value?: unknown; selected?: boolean; disabled?: boolean; acceptsInput?: boolean }[];
    preferences: { themeName: string; followSystemTextSize: boolean };
  };
  native: { ads: { options: { serverSideVerificationOptions: { customData: string } } }[] };
  external: { alerts: number };
};

const field = (value: Observation, id: string) => value.presentation.hosts.find(host => host.testId === id);
const press = (device: Device, testId: string) => device.host.call({ kind: 'press', testId });

async function openYou(world: InstanceType<typeof World>, userId = LEADER) {
  const profile = world.backend.profiles.get(userId);
  profile.preferences = { groupFeatureTourCompleted: true, addPlaceTourCompleted: true, routeReorderTourCompleted: true };
  const device = await world.device({ id: 'd6-you', userId, platform: 'ios', screen: { name: 'Map', params: { groupId: GROUP_ID } } });
  await world.waitFor(device, (value: Observation) => !!field(value, 'home-profile'), 'D6 floating avatar');
  expect(await press(device, 'home-profile')).toEqual({ invoked: true });
  await device.input({ kind: 'animation', finished: true });
  await world.waitFor(device, (value: Observation) => !!field(value, 'settings-page-profile'), 'D6 You page');
  return device;
}

describe('D6 You from the real Map screen', () => {
  jest.setTimeout(120000);

  it('autosaves the nickname and avatar color and keeps the parent page live', async () => {
    const world = new World();
    try {
      const device = await openYou(world);
      expect(await press(device, 'settings-page-profile')).toEqual({ invoked: true });
      await world.waitFor(device, (value: Observation) => !!field(value, 'profile-name'), 'profile page');
      await device.host.call({ kind: 'changeText', testId: 'profile-name', value: 'Moon' });
      await world.advance(350);
      await world.waitFor(device, () => world.backend.profiles.get(LEADER).nickname === 'Moon', 'nickname autosave');
      expect(await press(device, 'profile-color-#E0634A')).toEqual({ invoked: true });
      await world.waitFor(device, () => world.backend.profiles.get(LEADER).avatar_color === '#E0634A', 'avatar color autosave');
      expect(await press(device, 'settings-child-back')).toEqual({ invoked: true });
      const root = await world.waitFor(device, (value: Observation) => field(value, 'settings-page-profile')?.acceptsInput
        && value.presentation.hosts.some(host => host.text === 'Moon'), 'back to You with the saved nickname');
      expect(root.presentation.hosts.some((host: { text?: string }) => host.text === 'Moon')).toBe(true);
    } finally { await world.close(); }
  });

  it('saves team identity and opens the existing invitation UI on top of team settings', async () => {
    const world = new World();
    try {
      const device = await openYou(world);
      expect(await press(device, `settings-team-card-${GROUP_ID}`)).toEqual({ invoked: true });
      await world.waitFor(device, (value: Observation) => !!field(value, 'settings-group-name'), 'current team settings');
      expect(await device.host.call({ kind: 'changeText', testId: 'settings-group-name', value: 'Saturday team' }))
        .toEqual({ invoked: true });
      await world.advance(350);
      await world.waitFor(device, () => world.backend.groups.get(GROUP_ID)?.name === 'Saturday team', 'team rename autosave');
      expect(await press(device, 'settings-team-share')).toEqual({ invoked: true });
      await world.waitFor(device, (value: Observation) => !!field(value, 'map-share-code') && !!field(value, 'map-copy-code'),
        'existing InviteMembersOverlay over team settings');
    } finally { await world.close(); }
  });

  it('opens native language settings and persists the ordered notification controls', async () => {
    const world = new World();
    try {
      const device = await openYou(world);
      expect(await press(device, 'settings-page-language')).toEqual({ invoked: true });
      const opened = await device.observe();
      expect(opened.presentation.receipts).toEqual(expect.arrayContaining([expect.objectContaining({ host: 'Linking', method: 'openSettings' })]));
      expect(await press(device, 'settings-page-notifications')).toEqual({ invoked: true });
      const page = await world.waitFor(device, (value: Observation) => !!field(value, 'notification-preference-journey'), 'Notifications');
      const rows = page.presentation.hosts.map((host: { testId?: string }) => host.testId)
        .filter((id: string | undefined) => id?.startsWith('notification-preference-'));
      expect(rows).toEqual(['addGathering', 'leaderCommands', 'followerRequests', 'arrival', 'journey']
        .map(id => `notification-preference-${id}`));
      expect(await device.host.call({ kind: 'toggle', testId: 'notification-preference-arrival', value: false }))
        .toEqual({ invoked: true });
      await world.waitFor(device, () => world.backend.tables.notification_preferences[0]?.arrival === false,
        'persisted Team activity/arrival preference');
    } finally { await world.close(); }
  });

  it('shows verified coin balance from You to Shop and keeps restore and promo entry on the shop', async () => {
    const world = new World();
    world.backend.wallets.set(LEADER, 9);
    try {
      const device = await openYou(world);
      expect(await press(device, 'store-ad-cta')).toEqual({ invoked: true });
      const loading = await world.waitFor(device, (value: Observation) => value.native.ads.length === 1, 'native reward SDK load');
      const sessionRef = loading.native.ads[0].options.serverSideVerificationOptions.customData;
      await device.input({ kind: 'adEvent', event: 'loaded' });
      await device.input({ kind: 'adEvent', event: 'earned', value: { amount: 1 } });
      await device.input({ kind: 'adEvent', event: 'closed' });
      await world.waitFor(device, () => world.backend.rewardSessions.get(sessionRef)?.status === 'verifying', 'reward pending server verification');
      expect(world.backend.wallets.get(LEADER)).toBe(9);
      creditReward(world.backend, sessionRef);
      await world.advance(1500);
      await world.waitFor(device, (value: Observation) => value.presentation.hosts.some(host => host.text === '10'), 'credited balance in You');
      expect(await press(device, 'settings-page-store')).toEqual({ invoked: true });
      const shop = await world.waitFor(device, (value: Observation) => !!field(value, 'store-premium-restore'), 'shop with restore');
      expect(shop.presentation.hosts.some((host: { text?: string }) => host.text === '10')).toBe(true);
      expect(await press(device, 'store-premium-redeem')).toEqual({ invoked: true });
      await world.waitFor(device, (value: Observation) => !!field(value, 'paywall-redeem-input'), 'inline promo code field');
      expect(await press(device, 'store-redeem-personal_live_activity_lifetime')).toEqual({ invoked: true });
      expect(world.backend.liveUnlocks?.has(LEADER) ?? false).toBe(false);
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, () => world.backend.liveUnlocks?.has(LEADER), 'verified lifetime Live Activity redemption');
      const owned = await world.waitFor(device, (value: Observation) =>
        field(value, 'store-redeem-personal_live_activity_lifetime')?.disabled === true, 'owned product replaces the price');
      expect(world.backend.wallets.get(LEADER)).toBe(0);
      expect(owned.presentation.hosts.some((host: { text?: string }) => host.text === '0')).toBe(true);
      expect(world.backend.trace).toEqual(expect.arrayContaining([expect.objectContaining({
        name: 'redeem_store_product',
        args: expect.objectContaining({ p_product_code: 'personal_live_activity_lifetime', p_group_id: null }),
      })]));
    } finally { await world.close(); }
  });
});
