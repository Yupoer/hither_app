const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

describe.each(['ios', 'android'])('public profile notification contract on %s', platform => {
  jest.setTimeout(90000);

  async function mountRecipient(world: any) {
    const device = await world.device({ id: 'recipient', userId: PEER, platform,
      screen: { name: 'NotificationPreferences' } });
    await world.waitFor(device, (value: any) => !value.presentation.session.initializing, 'recipient ready');
    await device.perform('preferences.setLanguage', { args: ['en'] });
    await device.perform('session.membership', { args: [{ group: { id: GROUP_ID, name: 'Headless team',
      inviteCode: 'TEST42' }, role: 'follower' }] });
    await device.command({ kind: 'mount', screen: { name: 'NativeObservers' } });
    await world.waitFor(device, (value: any) => value.native.listeners.notification === 1,
      'real notification hook subscribed');
    return device;
  }

  async function event(world: any, device: any, table: string, row: object, eventType = 'INSERT', old = {}) {
    await device.command({ kind: 'event', event: { table, eventType, new: row, old } });
    await world.settle();
  }

  function profileReads(world: any, start: number) {
    return world.backend.trace.slice(start).filter((call: any) =>
      call.kind === 'table' && ['profiles', 'public_profiles'].includes(call.name));
  }

  it('uses only public nicknames for command, added point, journey leader and member arrival notifications', async () => {
    const world = new World();
    world.backend.profiles.get(LEADER).nickname = '  Captain Ada  ';
    world.backend.profiles.get(LEADER).preferences = { privateSecret: 'never read for notification names' };
    try {
      const device = await mountRecipient(world);
      const start = world.backend.trace.length;
      await event(world, device, 'commands', { id: 'public-command', group_id: GROUP_ID,
        sender_id: LEADER, type: 'gather', message: 'Meet here' });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 1, 'public command name');
      expect((await device.observe()).native.scheduled[0].input.content).toMatchObject({
        title: 'Captain Ada', body: 'Meet here', data: { category: 'leaderCommands' },
      });

      await event(world, device, 'itinerary_items', { id: 'public-added-point', group_id: GROUP_ID,
        created_by: LEADER, title: 'Museum' });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 2, 'public author name');
      expect((await device.observe()).native.scheduled[1].input.content).toMatchObject({
        title: 'Captain Ada New gathering point', data: { category: 'addGathering' },
      });

      await event(world, device, 'groups', { id: GROUP_ID, journey_status: 'going',
        active_destination_id: DESTINATION }, 'UPDATE', { journey_status: 'paused' });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 3, 'public journey leader name');
      expect((await device.observe()).native.scheduled[2].input.content).toMatchObject({
        title: "Let's go", body: expect.stringMatching(/^Captain Ada has started heading to /),
        data: { category: 'journey' },
      });

      world.backend.memberships.find((row: any) => row.user_id === PEER).role = 'leader';
      await device.perform('session.membership', { args: [{ group: { id: GROUP_ID, name: 'Headless team',
        inviteCode: 'TEST42' }, role: 'leader' }] });
      await device.input({ kind: 'appState', value: 'background' });
      await event(world, device, 'destination_arrivals', { id: 'public-arrival', group_id: GROUP_ID,
        user_id: LEADER, destination_id: DESTINATION });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 4, 'public arriver name');
      expect((await device.observe()).native.scheduled[3].input.content).toMatchObject({
        title: 'Captain Ada', body: expect.stringMatching(/^Arrived \(/), data: { category: 'arrival' },
      });
      const reads = profileReads(world, start);
      expect(reads).toHaveLength(4);
      expect(reads.map((call: any) => call.name)).toEqual(Array(4).fill('public_profiles'));
      expect(reads.map((call: any) => call.steps.find((step: any) => step[0] === 'select')[1]))
        .toEqual(Array(4).fill('nickname'));
      expect(reads.every((call: any) => call.steps.some((step: any) =>
        step[0] === 'eq' && step[1] === 'id' && step[2] === LEADER))).toBe(true);
    } finally { await world.close(); }
  });

  it('keeps notification fallbacks after missing, denied, network and missing-table public reads without querying profiles', async () => {
    const world = new World();
    world.backend.profiles.get(LEADER).nickname = 'Private legacy name';
    try {
      const device = await mountRecipient(world);
      const start = world.backend.trace.length;
      await event(world, device, 'commands', { id: 'missing-profile-command', group_id: GROUP_ID,
        sender_id: 'missing-person', type: 'gather', message: 'Missing public record' });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 1, 'missing public record fallback');
      expect((await device.observe()).native.scheduled[0].input.content.title).toBe('Leader: Gather');

      world.backend.failNext({ kind: 'table', name: 'public_profiles', mode: 'select', userId: PEER },
        { message: 'permission denied', code: '42501' });
      await event(world, device, 'itinerary_items', { id: 'denied-public-author', group_id: GROUP_ID,
        created_by: LEADER, title: 'Museum' });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 2, 'denied public author fallback');
      expect((await device.observe()).native.scheduled[1].input.content.title).toBe('New gathering point');

      world.backend.failNext({ kind: 'table', name: 'public_profiles', mode: 'select', userId: PEER },
        { message: 'Network request failed', code: 'NETWORK_ERROR' });
      await event(world, device, 'groups', { id: GROUP_ID, journey_status: 'going',
        active_destination_id: DESTINATION }, 'UPDATE', { journey_status: 'paused' });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 3, 'network failure leader fallback');
      expect((await device.observe()).native.scheduled[2].input.content.body)
        .toMatch(/^Leader has started heading to /);

      world.backend.memberships.find((row: any) => row.user_id === PEER).role = 'leader';
      await device.perform('session.membership', { args: [{ group: { id: GROUP_ID, name: 'Headless team',
        inviteCode: 'TEST42' }, role: 'leader' }] });
      await device.input({ kind: 'appState', value: 'background' });
      world.backend.failNext({ kind: 'table', name: 'public_profiles', mode: 'select', userId: PEER },
        { message: 'public_profiles not found in schema cache', code: 'PGRST205' });
      await event(world, device, 'destination_arrivals', { id: 'unavailable-public-arriver', group_id: GROUP_ID,
        user_id: LEADER, destination_id: DESTINATION });
      await world.waitFor(device, (value: any) => value.native.scheduled.length === 4, 'missing table arrival fallback');
      expect((await device.observe()).native.scheduled[3].input.content.title).toBe('traveler');
      expect(profileReads(world, start).map((call: any) => call.name))
        .toEqual(Array(4).fill('public_profiles'));
    } finally { await world.close(); }
  });
});
