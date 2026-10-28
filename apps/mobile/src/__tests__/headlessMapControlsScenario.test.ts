const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');
const { creditReward } = require('../../test/headless/backend-store.cjs');

type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type Observation = { presentation: { hosts: { testId?: string; text?: string; value?: unknown; checked?: boolean; disabled?: boolean }[];
  preferences: Record<string, unknown>; session: any; route: { route: string }; receipts: any[] }; native: any; external: { alerts: number; watches: number; backgroundTasks: { name: string; options: unknown }[] }; durable: any };
const field = (value: Observation, id: string) => value.presentation.hosts.find(host => host.testId === id);
const has = (value: Observation, id: string) => Boolean(field(value, id));
const press = (device: Device, testId: string) => device.host.call({ kind: 'press', testId });

describe.each(['ios', 'android'])('actual Map controls on %s', platform => {
  jest.setTimeout(120000);
  async function map(world: InstanceType<typeof World>, userId = LEADER, capabilities = {}) {
    const device = await world.device({ id: 'map-controls', userId, platform, capabilities, screen: { name: 'Map', params: { groupId: GROUP_ID } } });
    await world.waitFor(device, (value: Observation) => has(value, `gather-card-${DESTINATION}`), 'actual Map destination');
    await device.perform('map.card.toggle', { destinationId: DESTINATION });
    return device;
  }
  async function expand(world: InstanceType<typeof World>, device: Device) {
    for (const phase of ['onBegin', 'onUpdate', 'onEnd']) await device.host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase,
      value: phase === 'onBegin' ? {} : { translationY: -250, velocityY: 0 }, success: true });
    await world.settle();
  }
  async function pane(world: InstanceType<typeof World>, device: Device, index: number) {
    await expand(world, device);
    await device.perform('map.tab', { index });
    await world.settle();
  }
  async function settings(world: InstanceType<typeof World>, device: Device) {
    await device.perform('map.settings.open');
    await device.input({ kind: 'animation', finished: true });
    await world.waitFor(device, (value: Observation) => has(value, 'settings-go-home'), 'Map settings parent');
  }
  async function presence(world: InstanceType<typeof World>, device: Device, value: string) {
    await device.perform('map.presence.select', { value });
    if (platform === 'android') await device.input({ kind: 'alert', index: ['follow', 'solo', 'stealth'].indexOf(value) });
    await world.settle();
  }

  it('MAP-MEMBER-01 actual presence persists solo and notification macros while stealth cancellation preserves consent', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await expand(world, device);
      await presence(world, device, 'solo');
      expect(world.backend.memberships.find((row: any) => row.user_id === LEADER).solo).toBe(true);
      await presence(world, device, 'follow');
      expect(world.backend.memberships.find((row: any) => row.user_id === LEADER).solo).toBe(false);
      await presence(world, device, 'stealth');
      await device.input({ kind: 'alert', index: 0 });
      expect((await device.observe()).presentation.preferences.sharingEnabled).toBe(true);
      await presence(world, device, 'stealth');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => value.presentation.preferences.sharingEnabled === false, 'accepted stealth privacy');
      expect(world.backend.tables.notification_preferences[0]).toMatchObject({ user_id: LEADER, journey: false, arrival: false });
      await presence(world, device, 'follow');
      expect((await device.observe()).presentation.preferences.sharingEnabled).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-MEMBER-02 actual split warning precedes membership change and merge restores the main scope', async () => {
    const world = new World();
    try {
      const device = await map(world, PEER);
      await expand(world, device);
      await device.perform('map.subgroup.split');
      await world.settle();
      expect(world.backend.tables.subgroups).toEqual([]);
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => has(value, 'map-subgroup-merge'), 'actual split projection');
      expect(world.backend.tables.subgroups).toHaveLength(1);
      expect(world.backend.memberships.find((row: any) => row.user_id === PEER).subgroup_id).toBe(world.backend.tables.subgroups[0].id);
      await device.perform('map.subgroup.merge');
      await world.waitFor(device, (value: Observation) => has(value, 'map-subgroup-split'), 'actual merge projection');
      expect(world.backend.memberships.find((row: any) => row.user_id === PEER).subgroup_id).toBeNull();
      expect(world.backend.tables.subgroups).toEqual([]);
    } finally { await world.close(); }
  });

  it('MAP-MEMBER-03 actual leader kick confirmation cancels safely then removes only the selected peer', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await expand(world, device);
      expect(has(await device.observe(), `map-kick-${LEADER}`)).toBe(false);
      await device.perform('map.member.kick', { userId: PEER });
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.memberships).toHaveLength(2);
      await device.perform('map.member.kick', { userId: PEER });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => !has(value, `map-kick-${PEER}`), 'kicked member removed');
      expect(world.backend.memberships.map((row: any) => row.user_id)).toEqual([LEADER]);
    } finally { await world.close(); }
  });

  it('MAP-MEMBER-02 actual pending invitation decline removes only that invitation and accept joins its scope', async () => {
    const world = new World();
    const subgroupId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    world.backend.tables.subgroups.push({ id: subgroupId, group_id: GROUP_ID, name: 'Leader subgroup', mode: 'led', leader_id: LEADER, parent_subgroup_id: null });
    world.backend.memberships.find((row: any) => row.user_id === LEADER).subgroup_id = subgroupId;
    for (const id of ['decline-invite', 'accept-invite']) world.backend.tables.subgroup_invites.push({ id, group_id: GROUP_ID, subgroup_id: subgroupId,
      inviter_id: LEADER, invitee_id: PEER, status: 'pending', created_at: new Date(world.now).toISOString() });
    try {
      const device = await map(world, PEER);
      await expand(world, device);
      await world.waitFor(device, (value: Observation) => has(value, 'subgroup-invite-decline-decline-invite'), 'actual pending invitations');
      await device.perform('map.subgroup.invite.decline', { inviteId: 'decline-invite' });
      await world.waitFor(device, (value: Observation) => !has(value, 'subgroup-invite-decline-decline-invite'), 'declined invitation removed');
      expect(world.backend.tables.subgroup_invites[0].status).toBe('declined');
      expect(world.backend.memberships.find((row: any) => row.user_id === PEER).subgroup_id).toBeNull();
      await device.perform('map.subgroup.invite.accept', { inviteId: 'accept-invite' });
      await world.settle();
      expect(world.backend.tables.subgroup_invites[1].status).toBe('pending');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => has(value, 'map-subgroup-merge'), 'accepted invitation projection');
      expect(world.backend.tables.subgroup_invites[1].status).toBe('accepted');
      expect(world.backend.memberships.find((row: any) => row.user_id === PEER).subgroup_id).toBe(subgroupId);
    } finally { await world.close(); }
  });

  it('MAP-GROUP-01 actual invitation copies and shares the current group code without changing membership', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await expand(world, device);
      await device.perform('map.group.invite');
      await device.perform('map.group.copy-code');
      await device.perform('map.group.share-code');
      await device.input({ kind: 'animation', finished: true });
      const value = await device.observe();
      expect(value.presentation.receipts).toEqual(expect.arrayContaining([
        expect.objectContaining({ host: 'Clipboard', method: 'setStringAsync', value: 'TEST42' }),
        expect.objectContaining({ host: 'Share', method: 'share', value: { message: expect.stringContaining('TEST42') } }),
      ]));
      expect(world.backend.memberships).toHaveLength(2);
      await world.advance(1500);
    } finally { await world.close(); }
  });

  it('MAP-PROFILE-01 actual Map profile saves trimmed identity and refreshes the member projection', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await device.perform('map.profile.open');
      await device.input({ kind: 'animation', finished: true });
      await device.perform('profile.name', { value: '  Map traveler  ' });
      const refreshes = world.backend.trace.filter((call: any) => call.name === 'get_group_public_recovery_snapshot').length;
      await device.perform('profile.save');
      await world.waitFor(device, (value: Observation) => value.presentation.session.user.name === 'Map traveler', 'actual saved profile');
      expect(world.backend.profiles.get(LEADER).nickname).toBe('Map traveler');
      expect(world.backend.trace.filter((call: any) => call.name === 'get_group_public_recovery_snapshot').length).toBeGreaterThan(refreshes);
      await device.input({ kind: 'animation', finished: true });
      expect(has(await device.observe(), 'profile-name')).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-SETTINGS-01 actual Map group avatar save refreshes persisted group and followers have no editor', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await settings(world, device);
      await device.perform('settings.groupAvatar');
      await device.input({ kind: 'animation', finished: true });
      const emoji = (await device.observe()).presentation.hosts.find((host: any) => host.testId?.startsWith('settings-group-avatar-') && host.testId !== 'settings-group-avatar-save').testId.slice('settings-group-avatar-'.length);
      await press(device, `settings-group-avatar-${emoji}`);
      await device.perform('map.settings.group-avatar.save');
      await world.waitFor(device, () => world.backend.groups.get(GROUP_ID).avatar === emoji, 'actual saved group avatar');
      await world.waitFor(device, (value: Observation) => value.durable.snapshot.group.avatar === emoji, 'refreshed group avatar projection');
    } finally { await world.close(); }
    const followerWorld = new World();
    try {
      const follower = await map(followerWorld, PEER);
      await settings(followerWorld, follower);
      expect(has(await follower.observe(), 'settings-page-groupAvatar')).toBe(false);
    } finally { await followerWorld.close(); }
  });

  it('MAP-GROUP-02 actual Map home preserves membership and leave cancellation precedes committed departure', async () => {
    const world = new World();
    try {
      const device = await map(world, PEER);
      await settings(world, device);
      await device.perform('map.group.leave');
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.memberships).toHaveLength(2);
      await device.perform('map.group.home');
      await world.waitFor(device, (value: Observation) => value.presentation.route.route === 'RoleSelect', 'Map home navigation');
      expect(world.backend.memberships).toHaveLength(2);
      await device.host.mount({ name: 'Map', params: { groupId: GROUP_ID } });
      await world.waitFor(device, (value: Observation) => has(value, 'map-settings'), 'Map reentry');
      await settings(world, device);
      await device.perform('map.group.leave');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => value.presentation.route.route === 'RoleSelect', 'confirmed Map leave');
      expect(world.backend.memberships.map((row: any) => row.user_id)).toEqual([LEADER]);
    } finally { await world.close(); }
  });

  it('MAP-GROUP-02 actual Map signout cancellation retains identity and confirmation resets Login', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await settings(world, device);
      await device.perform('map.group.signout');
      await device.input({ kind: 'alert', index: 0 });
      expect((await device.observe()).presentation.session.user.id).toBe(LEADER);
      await device.perform('map.group.signout');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => value.presentation.route.route === 'Login' && value.presentation.session.user === null, 'actual Map signout');
      expect(world.backend.authUsers.has(LEADER)).toBe(true);
    } finally { await world.close(); }
  });

  it('MAP-TOOLS-01 actual tools entitlement gate keeps Live Activity disabled and passive mode survives restart', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await pane(world, device, 2);
      await device.perform('map.live-activity.toggle', { enabled: true });
      expect((await device.observe()).presentation.preferences.liveActivityEnabled).toBe(false);
      await device.input({ kind: 'animation', finished: true });
      expect(has(await device.observe(), 'paywall-premium-presentation-purchase')).toBe(true);
      await device.host.call({ kind: 'press', label: '取消' });
      await device.input({ kind: 'animation', finished: true });
      await device.perform('map.passive.enter');
      await world.waitFor(device, (value: Observation) => value.presentation.preferences.passiveCompanionMode === true && has(value, 'passive-switch-back'), 'real passive panel');
      expect((await device.observe()).presentation.preferences.sharingEnabled).toBe(true);
      await device.restart();
      await world.waitFor(device, (value: Observation) => has(value, 'passive-switch-back'), 'durable passive mode');
      await device.perform('map.passive.exit');
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: Observation) => value.presentation.preferences.passiveCompanionMode === false && has(value, 'group-map-native'), 'actual passive exit');
    } finally { await world.close(); }
  });

  it('MAP-STORE-01 actual Map Store waits for SSV and redemption refresh unlocks the parent tools control', async () => {
    const world = new World();
    world.backend.wallets.set(LEADER, 9);
    try {
      const device = await map(world);
      await pane(world, device, 3);
      await world.waitFor(device, (value: Observation) => has(value, 'store-ad-cta') && !has(value, 'store-loading'), 'Map Store loaded');
      await device.perform('store.watch-ad');
      const ad = await world.waitFor(device, (value: Observation) => value.native.ads.length === 1, 'Map rewarded ad');
      const reference = ad.native.ads[0].options.serverSideVerificationOptions.customData;
      await device.input({ kind: 'adEvent', event: 'loaded' });
      await device.input({ kind: 'adEvent', event: 'earned', value: { amount: 999 } });
      await device.input({ kind: 'adEvent', event: 'closed' });
      await world.waitFor(device, () => world.backend.rewardSessions.get(reference).status === 'verifying', 'Map SSV pending');
      expect(world.backend.wallets.get(LEADER)).toBe(9);
      creditReward(world.backend, reference);
      await world.advance(8000);
      await world.waitFor(device, (value: Observation) => value.presentation.hosts.some(host => host.text === '10'), 'Map server wallet');
      await device.perform('store.redeem', { productCode: 'personal_live_activity_lifetime' });
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, () => world.backend.liveUnlocks?.has(LEADER), 'actual lifetime redemption');
      await world.settle();
      await device.perform('map.tab', { index: 2 });
      await device.perform('map.live-activity.toggle', { enabled: true });
      await world.waitFor(device, (value: Observation) => field(value, 'tools-live-activity-toggle')?.checked === true, 'parent entitlement refresh');
      expect((await device.observe()).presentation.preferences.liveActivityEnabled).toBe(true);
      expect(world.backend.wallets.get(LEADER)).toBe(0);
    } finally { await world.close(); }
  });

  it('MAP-LOC-01 MAP-LOC-02 MAP-LOC-03 MAP-LOC-04 actual fresh samples drive location upload and camera controls', async () => {
    const world = new World();
    try {
      const device = await map(world);
      const before = await device.observe();
      if (platform === 'ios') await device.perform('map.location.native-sample', { latitude: 25.031, longitude: 121.521, accuracy: 4, timestamp: world.now });
      else await device.gps(25.031, 121.521, { accuracy: 4 });
      await world.settle();
      expect(world.backend.locations.get(`${GROUP_ID}:${LEADER}`)).toMatchObject({ latitude: 25.031, longitude: 121.521 });
      const stale = { latitude: 25.4, longitude: 121.9, accuracy: 4, timestamp: world.now - 120000 };
      if (platform === 'ios') await device.perform('map.location.native-sample', stale);
      else await device.gps(stale.latitude, stale.longitude, stale);
      await world.settle();
      expect(world.backend.locations.get(`${GROUP_ID}:${LEADER}`)).toMatchObject({ latitude: 25.031, longitude: 121.521 });
      const cameraBefore = (await device.observe()).presentation.receipts.length;
      await device.perform('map.location.locate');
      await world.settle();
      await world.advance(1);
      await device.gps(25.032, 121.522, { accuracy: 4 });
      await world.settle();
      await device.perform('map.location.fit');
      const camera = (await device.observe()).presentation.receipts.slice(cameraBefore);
      expect(camera.some((receipt: any) => ['animateCamera', 'animateToRegion'].includes(receipt.method))).toBe(true);
      expect(camera.some((receipt: any) => receipt.method === 'fitToCoordinates')).toBe(true);
      expect(before.external.watches).toBeGreaterThan(0);
      await expand(world, device);
      await device.perform('map.location.refresh');
      await world.settle();
      expect(world.backend.locationRefreshes).toHaveLength(1);
      expect(world.backend.locationRefreshes[0].recipient_ids).toEqual([PEER]);
      await world.advance(1);
      await device.gps(25.033, 121.523, { accuracy: 4 });
      await world.advance(20000);
      await world.waitFor(device, (value: Observation) => value.external.alerts > 0, 'refresh result');
      await device.input({ kind: 'alert', index: 0 });
      await device.perform('map.location.refresh');
      await world.settle();
      expect(world.backend.locationRefreshes).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('MAP-LOC-06 actual sharing reenable refuses denied permission then resumes permitted tracking', async () => {
    const world = new World();
    try {
      const device = await map(world);
      await expand(world, device);
      await device.perform('map.sharing.toggle');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => value.presentation.preferences.sharingEnabled === false, 'sharing disabled');
      await device.input({ kind: 'permission', status: 'denied' });
      await device.perform('map.sharing.toggle');
      await device.input({ kind: 'alert', index: 1 });
      await world.settle();
      expect((await device.observe()).presentation.preferences.sharingEnabled).toBe(false);
      while ((await device.observe()).external.alerts) await device.input({ kind: 'alert', index: 0 });
      await device.input({ kind: 'permission', status: 'granted' });
      await device.perform('map.sharing.toggle');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => value.presentation.preferences.sharingEnabled === true, 'sharing reenabled');
      expect(world.backend.tables.member_privacy_settings.find((row: any) => row.user_id === LEADER).sharing_enabled).toBe(true);
    } finally { await world.close(); }
  });

  it('MAP-LOC-07 actual Map hands active navigation to the platform background owner and consent stops it', async () => {
    const world = new World();
    try {
      const device = await map(world, LEADER, { nativeLocation: true });
      const previousWatches = (await device.observe()).external.watches;
      await device.perform('map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(device, (value: Observation) => value.external.watches > previousWatches, 'fresh Start location request');
      await world.advance(1000);
      await device.gps(25.03, 121.53, { accuracy: 5, timestamp: world.now });
      await world.waitFor(device, () => [...world.backend.sessions.values()].some((session: any) => session.status === 'active'), 'actual Map navigation start');
      await world.settle();
      await device.input({ kind: 'appState', value: 'background' });
      const running = await world.waitFor(device, (value: Observation) => platform === 'ios' ? value.native.location.running : value.external.backgroundTasks.length === 1, 'Map background owner');
      await world.advance(1000);
      const sample = { timestamp: world.now, coords: { latitude: 25.021, longitude: 121.511, accuracy: 5 }, stationary: false };
      if (platform === 'ios') await device.input({ kind: 'nativeLocation', sample });
      else await device.input({ kind: 'task', name: running.external.backgroundTasks[0].name, value: { data: { locations: [sample] }, error: null } });
      await world.waitFor(device, () => world.backend.locations.get(`${GROUP_ID}:${LEADER}`)?.latitude === sample.coords.latitude, 'actual background owner upload');
      const session = [...world.backend.sessions.values()].find((row: any) => row.status === 'active');
      expect(world.backend.locations.get(`${GROUP_ID}:${LEADER}`)).toMatchObject({ source: 'background_task', navigation_session_id: session.id });
      await device.input({ kind: 'appState', value: 'active' });
      await expand(world, device);
      await device.perform('map.sharing.toggle');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => value.presentation.preferences.sharingEnabled === false && !value.native.location.running && !value.native.location.prepared && value.external.backgroundTasks.length === 0, 'Map consent stops owner');
      expect(session.status).toBe('active');
    } finally { await world.close(); }
  });

  it('MAP-SHELL-01 MAP-SHELL-02 MAP-SHELL-03 MAP-SHELL-04 MAP-SHELL-05 actual pane guards carousel and card inactivity retain coherent controls', async () => {
    const world = new World();
    world.backend.itinerary.push({ ...world.backend.itinerary[0], id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', title: 'Second stop', position: 1, latitude: 25.2, longitude: 121.7 });
    try {
      const device = await map(world);
      await expand(world, device);
      expect(has(await device.observe(), 'map-presence')).toBe(true);
      await device.perform('map.tab', { index: 99 });
      expect(has(await device.observe(), 'map-presence')).toBe(true);
      await device.perform('map.tab', { index: 2 });
      expect(has(await device.observe(), 'tools-enter-passive')).toBe(true);
      await device.perform('map.tab', { index: 2 });
      expect(has(await device.observe(), 'tools-enter-passive')).toBe(true);
      await world.advance(300);
      await device.perform('map.card.toggle', { destinationId: DESTINATION });
      await world.advance(5000);
      await device.perform('map.travel-mode', { destinationId: DESTINATION });
      await world.advance(9999);
      expect(has(await device.observe(), `gather-meet-time-${DESTINATION}`)).toBe(true);
      await world.advance(1);
      expect(has(await device.observe(), `gather-meet-time-${DESTINATION}`)).toBe(false);
      const cameraStart = (await device.observe()).presentation.receipts.length;
      await device.perform('map.carousel.begin');
      await device.perform('map.carousel.end', { x: 100000 });
      await world.settle();
      expect((await device.observe()).presentation.receipts.slice(cameraStart).some((receipt: any) => ['animateCamera', 'animateToRegion'].includes(receipt.method))).toBe(true);
      await device.perform('map.pin.drop', { latitude: 25.1, longitude: 121.6 });
      await world.advance(0);
      expect(has(await device.observe(), 'confirm-place-name')).toBe(true);
      await device.perform('map.place.cancel');
      expect(has(await device.observe(), 'confirm-place-name')).toBe(false);
      expect(world.backend.itinerary).toHaveLength(2);
    } finally { await world.close(); }
  });

  it('MAP-OPS-01 actual exception actions persist locally through restart without changing peer or journey', async () => {
    const world = new World();
    world.backend.tables.commands.push({ id: 'help-signal', group_id: GROUP_ID, sender_id: PEER, type: 'need_help', message: 'Help', created_at: new Date(world.now).toISOString() });
    try {
      const device = await map(world);
      await pane(world, device, 1);
      await device.perform('map.ops.open');
      const open = await world.waitFor(device, (value: Observation) => value.presentation.hosts.some(host => host.testId?.startsWith('map-exception-acknowledge-')), 'actual help exception');
      const key = open.presentation.hosts.find((host: { testId?: string }) => host.testId?.startsWith('map-exception-acknowledge-'))!.testId!.slice('map-exception-acknowledge-'.length);
      await device.perform('map.exception.acknowledge', { rootCauseKey: key });
      await device.perform('map.exception.resolve', { rootCauseKey: key });
      await world.waitFor(device, (value: Observation) => has(value, `map-exception-reopen-${key}`), 'resolved actual exception');
      await device.restart();
      await world.waitFor(device, (value: Observation) => has(value, `gather-card-${DESTINATION}`), 'Map restart');
      await pane(world, device, 1);
      await device.perform('map.ops.open');
      expect(has(await device.observe(), `map-exception-reopen-${key}`)).toBe(true);
      await device.perform('map.exception.reopen', { rootCauseKey: key });
      expect(has(await device.observe(), `map-exception-acknowledge-${key}`)).toBe(true);
      expect(world.backend.groups.get(GROUP_ID).journey_status).toBe('paused');
      expect(world.backend.memberships.find((row: any) => row.user_id === PEER).solo).toBe(false);
    } finally { await world.close(); }
  });

  it('MAP-SETTINGS-02 actual reset cancellation preserves tours and confirmation persists replay without navigating', async () => {
    const world = new World();
    world.backend.profiles.get(LEADER).preferences = { groupFeatureTourCompleted: true, addPlaceTourCompleted: true, routeReorderTourCompleted: true };
    try {
      const device = await map(world);
      await settings(world, device);
      expect(has(await device.observe(), 'settings-archive')).toBe(false);
      await device.perform('map.settings.reset');
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.profiles.get(LEADER).preferences.routeReorderTourCompleted).toBe(true);
      expect(await device.perform('onboarding.readOnboardingReplayIntent')).toBe(false);
      await device.perform('map.settings.reset');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, () => world.backend.profiles.get(LEADER).preferences.routeReorderTourCompleted === false, 'actual tour reset');
      expect(world.backend.profiles.get(LEADER).preferences).toMatchObject({ groupFeatureTourCompleted: false, addPlaceTourCompleted: false, routeReorderTourCompleted: false });
      expect(await device.perform('onboarding.readOnboardingReplayIntent')).toBe(true);
      expect((await device.observe()).presentation.route.route).toBe('Map');
    } finally { await world.close(); }
  });

  it('MAP-TOUR-01 actual route tour previous next and completion persist account state and suppress replay', async () => {
    const world = new World();
    world.backend.profiles.get(LEADER).preferences = { groupFeatureTourCompleted: true, addPlaceTourCompleted: true };
    try {
      const device = await map(world);
      await pane(world, device, 1);
      await device.perform('map.route.open');
      await device.input({ kind: 'animation', finished: true });
      await world.advance(1500);
      await world.waitFor(device, (value: Observation) => has(value, 'tour-next') && !field(value, 'tour-next')?.disabled, 'actual measured route tour');
      expect(has(await device.observe(), 'tour-prev')).toBe(false);
      await press(device, 'tour-next');
      await world.advance(1500);
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: Observation) => has(value, 'tour-prev') && !field(value, 'tour-next')?.disabled, 'route tour second step');
      await press(device, 'tour-prev');
      await world.advance(1500);
      await world.waitFor(device, (value: Observation) => !has(value, 'tour-prev') && !field(value, 'tour-next')?.disabled, 'route tour previous step');
      for (let step = 0; step < 6; step++) {
        await press(device, 'tour-next');
        await world.advance(1500);
        await world.settle();
      }
      await world.waitFor(device, () => world.backend.profiles.get(LEADER).preferences.routeReorderTourCompleted === true, 'actual route tour completion');
      expect(has(await device.observe(), 'tour-next')).toBe(false);
      await device.restart();
      await world.waitFor(device, (value: Observation) => has(value, `gather-card-${DESTINATION}`), 'Map tour restart');
      await pane(world, device, 1);
      await device.perform('map.route.open');
      await device.input({ kind: 'animation', finished: true });
      await world.advance(32);
      expect(has(await device.observe(), 'tour-next')).toBe(false);
    } finally { await world.close(); }
  });
});
