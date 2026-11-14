import type { CoreGroupSnapshot, CoreOperation } from '../types/coreData';

const { World } = require('../../test/headless/world.cjs');
const { GROUP_ID, LEADER, PEER, DESTINATION } = require('../../test/headless/backend.cjs');

type Membership = { user_id: string; subgroup_id: string | null; solo: boolean };
type SyncCommand = { args: { p_core_operations: { operation_type: string }[] } };
type Device = Awaited<ReturnType<InstanceType<typeof World>['device']>>;
type Observation = {
  presentation: {
    hosts: { testId?: string; text?: string; label?: string; disabled?: boolean; checked?: boolean; selected?: boolean }[];
    receipts: { host: string; method: string; args?: unknown[]; value?: unknown }[];
    preferences: { sharingEnabled: boolean };
  };
  external: { alerts: number };
  durable: { operations: CoreOperation[]; snapshot: CoreGroupSnapshot };
};

const field = (value: Observation, id: string) => value.presentation.hosts.find(host => host.testId === id);
const has = (value: Observation, id: string) => Boolean(field(value, id));
const text = (value: Observation, label: string) => value.presentation.hosts.some(host => host.text === label);
const press = (device: Device, testId: string) => device.host.call({ kind: 'press', testId });
const select = (device: Device, testId: string, id: string) => testId === 'map-presence'
  ? press(device, `map-presence-option-${id}`)
  : device.host.call({
  kind: 'nativeEvent', testId, value: { event: 'onSelect', nativeEvent: { id } },
});

async function map(world: InstanceType<typeof World>, id: string, userId = LEADER) {
  const device = await world.device({ id, userId, platform: 'ios', screen: { name: 'Map', params: { groupId: GROUP_ID } } });
  await world.waitFor(device, (value: Observation) => has(value, 'home-team-toggle'), 'D6 floating island');
  return device;
}

async function openTeam(world: InstanceType<typeof World>, device: Device) {
  expect(await press(device, 'home-team-toggle')).toEqual({ invoked: true });
  return world.waitFor(device, (value: Observation) => has(value, 'd6-members-pane') && has(value, 'map-presence'), 'D6 team pane');
}

describe('D6 iOS team and commands through Map', () => {
  jest.setTimeout(120000);

  it('MAP-MEMBER-01 MAP-LOC-06 drives Solo, Stealth and permission-checked sharing from the native status menu', async () => {
    const world = new World();
    try {
      const device = await map(world, 'd6-presence');
      await openTeam(world, device);
      await select(device, 'map-presence', 'solo');
      await world.waitFor(device, () => world.backend.memberships.find((row: Membership) => row.user_id === LEADER).solo, 'durable solo state');
      await select(device, 'map-presence', 'follow');
      await world.waitFor(device, () => !world.backend.memberships.find((row: Membership) => row.user_id === LEADER).solo, 'durable follow state');

      await select(device, 'map-presence', 'stealth');
      await world.waitFor(device, (value: Observation) => value.external.alerts > 0, 'stealth confirmation');
      await device.input({ kind: 'alert', index: 0 });
      await world.settle();
      expect((await device.observe()).presentation.preferences.sharingEnabled).toBe(true);

      await select(device, 'map-presence', 'stealth');
      await world.waitFor(device, (value: Observation) => value.external.alerts > 0, 'second stealth confirmation');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => value.presentation.preferences.sharingEnabled === false, 'local privacy off');
      expect(world.backend.tables.notification_preferences[0]).toMatchObject({ user_id: LEADER, journey: false, arrival: false });
      expect(world.backend.tables.member_privacy_settings[0]).toMatchObject({ user_id: LEADER, sharing_enabled: false });

      await device.input({ kind: 'permission', status: 'denied' });
      await select(device, 'map-presence', 'follow');
      await world.settle();
      expect((await device.observe()).presentation.preferences.sharingEnabled).toBe(false);
      while ((await device.observe()).external.alerts) await device.input({ kind: 'alert', index: 0 });

      await device.input({ kind: 'permission', status: 'granted' });
      await select(device, 'map-presence', 'follow');
      await world.waitFor(device, (value: Observation) => value.presentation.preferences.sharingEnabled, 'restored local position consent');
      expect(world.backend.tables.member_privacy_settings[0]).toMatchObject({ user_id: LEADER, sharing_enabled: true });
    } finally { await world.close(); }
  });

  it('MAP-MEMBER-02 creates a subgroup with the selected teammate invited, then accepts and leaves on their devices', async () => {
    const world = new World();
    try {
      const leader = await map(world, 'd6-split-leader');
      const peer = await map(world, 'd6-split-peer', PEER);
      await openTeam(world, leader);
      await openTeam(world, peer);
      await press(leader, 'map-subgroup-split');
      expect(field(await leader.observe(), `d6-subgroup-select-${LEADER}`)?.checked).toBe(true);
      await press(leader, `d6-subgroup-select-${PEER}`);
      expect(field(await leader.observe(), `d6-subgroup-select-${PEER}`)?.checked).toBe(true);
      await press(leader, 'd6-team-split-cancel');
      expect(world.backend.tables.subgroups).toEqual([]);

      await press(leader, 'map-subgroup-split');
      await press(leader, `d6-subgroup-select-${PEER}`);
      await press(leader, 'd6-team-split-create');
      await world.waitFor(leader, (value: Observation) => value.external.alerts > 0, 'subgroup warning');
      expect(world.backend.tables.subgroups).toEqual([]);
      await leader.input({ kind: 'alert', index: 1 });
      await world.waitFor(leader, () => world.backend.tables.subgroup_invites.length === 1, 'persisted invitation');
      const [subgroup] = world.backend.tables.subgroups;
      const [invite] = world.backend.tables.subgroup_invites;
      const subgroupOf = (id: string) => world.backend.memberships.find((row: Membership) => row.user_id === id).subgroup_id;
      expect(subgroupOf(LEADER)).toBe(subgroup.id);
      expect(subgroupOf(PEER)).toBeNull();
      expect(invite).toMatchObject({ inviter_id: LEADER, invitee_id: PEER, subgroup_id: subgroup.id, status: 'pending' });

      await world.advance(350);
      await world.waitFor(peer, (value: Observation) => has(value, `subgroup-invite-accept-${invite.id}`), 'incoming subgroup invite');
      await press(peer, `subgroup-invite-accept-${invite.id}`);
      await world.waitFor(peer, (value: Observation) => value.external.alerts > 0, 'invite scope warning');
      expect(invite.status).toBe('pending');
      await peer.input({ kind: 'alert', index: 1 });
      await world.waitFor(peer, (value: Observation) => has(value, `d6-subgroup-options-${subgroup.id}`), 'accepted subgroup');
      expect(invite.status).toBe('accepted');
      expect(subgroupOf(PEER)).toBe(subgroup.id);

      await select(peer, `d6-subgroup-options-${subgroup.id}`, 'leave');
      await world.waitFor(peer, (value: Observation) => has(value, 'map-subgroup-split'), 'main-team membership restored');
      expect(subgroupOf(PEER)).toBeNull();
      expect(subgroupOf(LEADER)).toBe(subgroup.id);
    } finally { await world.close(); }
  });

  it('MAP-MEMBER-03 confirms kick before removing only the selected member', async () => {
    const world = new World();
    try {
      const device = await map(world, 'd6-kick');
      await openTeam(world, device);
      await select(device, `d6-team-member-${PEER}`, 'kick');
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.memberships).toHaveLength(2);
      await select(device, `d6-team-member-${PEER}`, 'kick');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => !has(value, `d6-team-member-${PEER}`), 'kicked row removed');
      expect(world.backend.memberships.map((row: Membership) => row.user_id)).toEqual([LEADER]);
    } finally { await world.close(); }
  });

  it('MAP-GROUP-01 opens the original invitation sheet and copies the real team code', async () => {
    const world = new World();
    try {
      const device = await map(world, 'd6-invite-code');
      await openTeam(world, device);
      await press(device, 'map-invite-members');
      await world.waitFor(device, (value: Observation) => has(value, 'map-share-code') && has(value, 'map-copy-code'), 'existing invitation UI');
      await device.perform('map.group.copy-code');
      await device.perform('map.group.share-code');
      await device.input({ kind: 'animation', finished: true });
      expect((await device.observe()).presentation.receipts).toEqual(expect.arrayContaining([
        expect.objectContaining({ host: 'Clipboard', method: 'setStringAsync', value: 'TEST42' }),
        expect.objectContaining({ host: 'Share', method: 'share', value: { message: expect.stringContaining('TEST42') } }),
      ]));
      expect(world.backend.memberships).toHaveLength(2);
    } finally { await world.close(); }
  });

  it('MAP-COORD-02 MAP-COORD-03 creates a keep-or-change vote and persists the member’s new selection', async () => {
    const world = new World();
    try {
      const leader = await map(world, 'd6-vote-leader');
      const follower = await map(world, 'd6-vote-follower', PEER);
      await openTeam(world, leader);
      await press(leader, 'd6-team-settings');
      await leader.input({ kind: 'animation', finished: true });
      await world.waitFor(leader, (value: Observation) => has(value, 'settings-team-coordination'), 'team settings coordination');
      await press(leader, 'settings-team-coordination');
      await world.waitFor(leader, (value: Observation) => has(value, 'coordination-subject-input'), 'coordination draft');
      expect(field(await leader.observe(), 'coordination-create-submit')?.disabled).toBe(true);
      await leader.host.call({ kind: 'changeText', testId: 'coordination-subject-input', value: '  Change the meeting stop?  ' });
      await press(leader, 'coordination-create-submit');
      await world.waitFor(leader, (value: Observation) => has(value, 'coordination-response-opt_a'), 'new vote on the team panel');
      const [request] = world.backend.tables.coordination_requests;
      expect(request).toMatchObject({ subject: 'Change the meeting stop?', default_outcome: 'opt_a', policy: 'majority' });
      expect(request.options).toEqual([
        { id: 'opt_a', label: 'Keep current', kind: 'keep_current' },
        { id: 'opt_b', label: 'Accept change', kind: 'itinerary' },
      ]);

      await openTeam(world, follower);
      await world.advance(1500);
      await world.waitFor(follower, (value: Observation) => field(value, 'coordination-response-opt_b')?.label === 'Change, 0 votes', 'published member poll');
      await press(follower, 'coordination-response-opt_b');
      await world.waitFor(follower, (value: Observation) => field(value, 'coordination-response-opt_b')?.selected === true, 'selected change vote');
      expect(world.backend.tables.coordination_responses).toEqual([
        expect.objectContaining({ request_id: request.id, user_id: PEER, option_id: 'opt_b' }),
      ]);
      await press(follower, 'coordination-response-opt_a');
      await world.waitFor(follower, (value: Observation) => field(value, 'coordination-response-opt_a')?.selected === true, 'changed selection');
      expect(world.backend.tables.coordination_responses).toEqual([
        expect.objectContaining({ request_id: request.id, user_id: PEER, option_id: 'opt_a' }),
      ]);
    } finally { await world.close(); }
  });

  it('MAP-GATHER-07 queues an offline start request and starts only after the leader approves it in the member inbox', async () => {
    const world = new World();
    try {
      world.backend.tables.notification_preferences.push({ user_id: LEADER, follower_requests: false });
      const follower = await map(world, 'd6-request-follower', PEER);
      const leader = await map(world, 'd6-request-leader');
      await openTeam(world, leader);
      expect(has(await leader.observe(), `member-inbox-badge-${PEER}`)).toBe(false);

      follower.online = false;
      await press(follower, 'home-commands');
      await press(follower, 'quick-command-request_start');
      const offline: Observation = await world.waitFor(follower, (value: Observation) =>
        value.durable.operations.some(row => row.operationType === 'send_command'), 'offline start request saved');
      expect(offline.durable.operations[0].payload).toMatchObject({ type: 'request_start', destinationId: DESTINATION });
      expect(world.backend.tables.commands).toEqual([]);
      follower.online = true;
      await world.advance(30000);
      await world.waitFor(leader, (value: Observation) => has(value, `member-inbox-badge-${PEER}`), 'leader sees pending request');
      const [request] = world.backend.tables.commands;
      expect(request).toMatchObject({ sender_id: PEER, target_user_id: LEADER, destination_id: DESTINATION, request_status: 'pending' });
      expect(world.backend.sessions.size).toBe(0);

      await select(leader, `d6-team-member-${PEER}`, 'inbox');
      await world.waitFor(leader, (value: Observation) => has(value, `start-request-approve-${request.id}`), 'existing member inbox approval');
      await press(leader, `start-request-approve-${request.id}`);
      await world.waitFor(leader, (value: Observation) => !has(value, `member-inbox-badge-${PEER}`), 'approval clears the badge');
      expect(request.request_status).toBe('approved');
      expect(world.backend.sessions.get(request.id)).toMatchObject({ started_by: LEADER, destination_id: DESTINATION, status: 'active' });
      await world.advance(2500);
      await world.waitFor(follower, (value: Observation) => field(value, 'home-journey-action')?.label === 'On the way', 'follower sees accepted navigation');
    } finally { await world.close(); }
  });

  it('sends the member shortcut through the durable outbox and dismisses the map bubble on time', async () => {
    const world = new World();
    try {
      const peer = await map(world, 'd6-send-command', PEER);
      await peer.gps(25.031, 121.53, { accuracy: 4 });
      world.hold('sync_group', { deviceId: 'd6-send-command', matches: (operation: SyncCommand) =>
        operation.args.p_core_operations.some(row => row.operation_type === 'send_command'),
      });
      await press(peer, 'home-commands');
      await world.waitFor(peer, (value: Observation) => has(value, 'quick-command-need_help'), 'member quick command');
      await press(peer, 'quick-command-need_help');
      const sending: Observation = await world.waitFor(peer, (value: Observation) =>
        value.durable.operations.some(row => row.operationType === 'send_command'), 'durable command before delivery ACK');
      expect(sending.durable.operations.find(row => row.operationType === 'send_command')?.payload).toMatchObject({ type: 'need_help' });
      expect(world.backend.tables.commands).toEqual([]);
      await world.advance(380);
      const bubble: Observation = await world.waitFor(peer, (value: Observation) =>
        !has(value, 'd6-quick-commands') && text(value, 'Need help'), 'quick-command bubble on map');
      expect(bubble.durable.operations).toHaveLength(1);
      await world.advance(3200);
      expect(text(await peer.observe(), 'Need help')).toBe(false);
      await world.release('sync_group');
      await world.waitFor(peer, (value: Observation) => value.durable.operations.length === 0, 'command ACK');
      expect(world.backend.tables.commands).toEqual([expect.objectContaining({ type: 'need_help', sender_id: PEER })]);
    } finally { await world.close(); }
  });
});
