const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');
const { configure: configureAuth } = require('../../test/headless/backend-auth.cjs');

const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
type Observation = { presentation: { hosts: { testId?: string }[]; receipts: { method: string; args: unknown[] }[];
  session: { initializing: boolean } }; native: { scheduled: { input: { content: { data: Record<string, unknown> } } }[];
    receipts: { method: string; value?: { shouldShowBanner?: boolean } }[]; listeners: { notification: number } } };

function addThirdFollower(world: InstanceType<typeof World>, solo = false) {
  configureAuth(world.backend, { accounts: [{ id: OTHER, email: 'other@headless.test', password: 'Headless123!' }] });
  world.backend.profiles.set(OTHER, { id: OTHER, nickname: 'Other', created_at: new Date(world.now).toISOString(), preferences: {}, pro: false });
  world.backend.memberships.push({ group_id: GROUP_ID, user_id: OTHER, role: 'follower', status: 'active', solo,
    subgroup_id: null, created_at: new Date(world.now).toISOString() });
}

async function observer(world: InstanceType<typeof World>, platform: string, id: string, userId: string, role: 'leader' | 'follower') {
  const device = await world.device({ id, userId, platform, screen: { name: 'NotificationPreferences' } });
  await world.waitFor(device, (value: Observation) => !value.presentation.session.initializing, `${id} session ready`);
  await device.perform('session.membership', { args: [{ group: { id: GROUP_ID, name: 'Headless team', inviteCode: 'TEST42' }, role }] });
  await device.host.mount({ name: 'NativeObservers' });
  await world.waitFor(device, (value: Observation) => value.native.listeners.notification === 1, `${id} subscribed`);
  return device;
}

async function map(world: InstanceType<typeof World>, platform: string, id: string, userId: string) {
  const device = await world.device({ id, userId, platform, screen: { name: 'Map', params: { groupId: GROUP_ID } } });
  await world.waitFor(device, (value: Observation) => value.presentation.hosts.some(host => host.testId === `gather-card-${DESTINATION}`), `${id} gathering card`);
  await device.perform('map.card.toggle', { destinationId: DESTINATION });
  return device;
}

const notices = (value: Observation) => value.presentation.receipts.filter(receipt =>
  receipt.method === 'onAppNotice' && typeof (receipt.args[0] as { id?: string } | null)?.id === 'string');
const presentations = (value: Observation) => value.native.receipts.filter(receipt => receipt.method === 'notifications.presentation');

describe.each(['ios', 'android'])('headless multiuser journey notifications on %s', platform => {
  jest.setTimeout(120000);

  it('actual GPS arrival reaches the leader and arriving member, but not another follower, once', async () => {
    const world = new World();
    addThirdFollower(world);
    try {
      const leader = await observer(world, platform, 'leader-notifications', LEADER, 'leader');
      const other = await observer(world, platform, 'other-notifications', OTHER, 'follower');
      const memberNotice = await observer(world, platform, 'member-notifications', PEER, 'follower');
      const leaderMap = await map(world, platform, 'leader-map', LEADER);
      const watches = (await leaderMap.observe()).external.watches;
      await leaderMap.perform('map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(leaderMap, (value: { external: { watches: number } }) => value.external.watches > watches, 'fresh Start fix requested');
      await world.advance(1000);
      await leaderMap.gps(25.03, 121.53, { accuracy: 5, timestamp: world.now });
      await world.waitFor(leaderMap, () => [...world.backend.sessions.values()].some((row: { status: string }) => row.status === 'active'), 'session committed');
      const memberMap = await map(world, platform, 'member-map', PEER);
      await world.advance(1000);
      if (platform === 'ios') await memberMap.perform('map.location.native-sample', { latitude: 25.04, longitude: 121.53, accuracy: 5, timestamp: world.now });
      else await memberMap.gps(25.04, 121.53, { accuracy: 5, timestamp: world.now });
      await world.waitFor(leader, () => world.backend.tables.destination_arrivals.some((row: { user_id: string }) => row.user_id === PEER), 'member arrival committed');
      const leaderResult = await world.waitFor(leader, (value: Observation) => notices(value).length === 1, 'leader receives member arrival');
      const memberResult = await world.waitFor(memberNotice, (value: Observation) => notices(value).length === 1, 'member receives own arrival');
      expect(notices(leaderResult)[0].args[0]).toMatchObject({ title: 'Peer' });
      expect(notices(memberResult)[0].args[0]).toMatchObject({ title: expect.any(String) });
      expect(notices(await other.observe())).toEqual([]);
      const arrival = world.backend.tables.destination_arrivals.find((row: { user_id: string }) => row.user_id === PEER);
      expect(world.realtimeTrace.some((entry: { deviceId: string; event: { table: string; new: { id: string } } }) =>
        entry.deviceId === 'leader-notifications' && entry.event.table === 'destination_arrivals' && entry.event.new.id === arrival.id)).toBe(true);
      world.backend.publish('destination_arrivals', arrival, 'INSERT');
      world.backend.publish('destination_arrivals', arrival);
      await world.settle();
      expect(notices(await leader.observe())).toHaveLength(1);
      expect(notices(await memberNotice.observe())).toHaveLength(1);
      expect(notices(await other.observe())).toEqual([]);
    } finally { await world.close(); }
  });

  it('leader straggler report reaches the detector and another member through Realtime, but not a solo member', async () => {
    const world = new World();
    addThirdFollower(world, true);
    world.backend.groups.get(GROUP_ID).straggler_alerts = true;
    try {
      const leader = await observer(world, platform, 'leader-notifications', LEADER, 'leader');
      const member = await observer(world, platform, 'member-notifications', PEER, 'follower');
      const solo = await observer(world, platform, 'solo-notifications', OTHER, 'follower');
      await leader.perform('group.reportStraggler', { args: [GROUP_ID, PEER, 800] });
      const result = await world.waitFor(member, (value: Observation) => value.native.scheduled.length === 1, 'member straggler alert');
      const alert = world.backend.tables.group_alerts[0];
      expect(alert).toMatchObject({ group_id: GROUP_ID, sender_id: LEADER, member_id: PEER, kind: 'straggler', distance_m: 800 });
      expect(result.native.scheduled[0].input.content.data).toMatchObject({ category: 'journey', senderId: LEADER, groupId: GROUP_ID });
      await world.waitFor(leader, (value: Observation) => value.native.scheduled.length === 1, 'detector receives straggler alert');
      expect((await solo.observe()).native.scheduled).toEqual([]);
      expect(world.realtimeTrace.some((entry: { deviceId: string; event: { table: string; new: { id: string } } }) =>
        entry.deviceId === 'member-notifications' && entry.event.table === 'group_alerts' && entry.event.new.id === alert.id)).toBe(true);
      world.backend.publish('group_alerts', alert, 'INSERT');
      await world.settle();
      expect((await member.observe()).native.scheduled).toHaveLength(1);
      expect((await solo.observe()).native.scheduled).toEqual([]);
    } finally { await world.close(); }
  });

  it('request-start card targets the leader in outbox and the simulated push is handled once', async () => {
    const world = new World();
    addThirdFollower(world);
    try {
      const leader = await observer(world, platform, 'leader-notifications', LEADER, 'leader');
      const other = await observer(world, platform, 'other-notifications', OTHER, 'follower');
      const member = await map(world, platform, 'member-map', PEER);
      await member.perform('map.journey.command', { destinationId: DESTINATION });
      await world.waitFor(member, () => world.backend.notificationOutbox.length === 1, 'request-start outbox committed');
      const [request] = world.backend.notificationOutbox;
      expect(request).toMatchObject({ group_id: GROUP_ID, sender_id: PEER, target_user_id: LEADER,
        category: 'follower_requests', payload: { type: 'request_start', groupId: GROUP_ID, targetUserId: LEADER } });
      expect(world.backend.sessions.size).toBe(0);
      expect(world.realtimeTrace.filter((entry: { event: { table: string } }) => entry.event.table === 'commands')).toEqual([]);
      expect((await other.observe()).native.scheduled).toEqual([]);
      const content = { title: 'Peer', body: request.payload.message, data: { category: request.category,
        groupId: request.group_id, senderId: request.sender_id, eventId: `request:${request.operation_id}`, type: request.payload.type } };
      await leader.input({ kind: 'notification', id: request.id, content });
      await leader.input({ kind: 'notification', id: request.id, content });
      const received = presentations(await leader.observe());
      expect(received).toHaveLength(2);
      expect(received[0].value?.shouldShowBanner).toBe(true);
      expect(received[1].value?.shouldShowBanner).toBe(false);
      expect(presentations(await other.observe())).toEqual([]);
    } finally { await world.close(); }
  });

  it('leaving the group updates the leader roster and emits no notification', async () => {
    const world = new World();
    try {
      const leaderNotice = await observer(world, platform, 'leader-notifications', LEADER, 'leader');
      const leaderRoster = await world.device({ id: 'leader-roster', userId: LEADER, platform });
      await leaderRoster.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(leaderRoster, (value: { group: { state?: { members: { userId: string }[] } } }) =>
        value.group.state?.members.some(member => member.userId === PEER), 'leader roster includes member');
      const departing = await world.device({ id: 'departing-member', userId: PEER, platform });
      await departing.perform('group.leaveGroups', { args: [[GROUP_ID]] });
      await world.settle();
      await world.advance(300);
      await world.waitFor(leaderRoster, (value: { group: { state?: { members: { userId: string }[] } } }) =>
        value.group.state?.members.every(member => member.userId !== PEER), 'leader roster reflects leave');
      expect(world.backend.memberships.some((row: { group_id: string; user_id: string }) => row.group_id === GROUP_ID && row.user_id === PEER)).toBe(false);
      expect(world.realtimeTrace.some((entry: { deviceId: string; event: { table: string; eventType: string; old: { user_id: string } } }) =>
        entry.deviceId === 'leader-roster' && entry.event.table === 'memberships' && entry.event.eventType === 'DELETE'
        && entry.event.old.user_id === PEER)).toBe(true);
      expect((await leaderNotice.observe()).native.scheduled).toEqual([]);
      expect(notices(await leaderNotice.observe())).toEqual([]);
      expect(world.backend.notificationOutbox).toEqual([]);
    } finally { await world.close(); }
  });
});
