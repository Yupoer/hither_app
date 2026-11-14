const { World } = require('../../test/headless/world.cjs');
const { PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Observation = {
  presentation: {
    hosts: { testId?: string; checked?: boolean; acceptsInput?: boolean }[];
    session: { user: { id: string } };
    route: { route: string };
  };
};
const field = (value: Observation, testId: string) =>
  value.presentation.hosts.find(host => host.testId === testId && host.acceptsInput);

describe.each(['ios', 'android'])('actual member parent entries on %s', platform => {
  jest.setTimeout(120000);

  it('MAP-SETTINGS-02 N01 V18 opens notification settings from Map, persists independent toggles and returns to the parent', async () => {
    const world = new World();
    world.backend.tables.notification_preferences = [{ user_id: PEER, add_gathering: true,
      leader_commands: true, follower_requests: false, journey: true, arrival: true }];
    try {
      const device = await world.device({ id: 'member-settings', userId: PEER, platform,
        screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      const mapEntry = platform === 'ios' ? 'home-profile' : 'map-settings';
      const ready = platform === 'ios' ? mapEntry : `gather-card-${DESTINATION}`;
      await world.waitFor(device, (value: Observation) => Boolean(field(value, ready)), 'member Map loaded');
      expect(await device.host.call({ kind: 'press', testId: mapEntry })).toEqual({ invoked: true });
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: Observation) => Boolean(field(value, 'settings-page-notifications')), 'Map settings notification entry');
      await device.perform('settings.notifications');
      await device.input({ kind: 'animation', finished: true });
      const loaded = await world.waitFor(device, (value: Observation) => field(value, 'notification-preference-followerRequests')?.checked === false,
        'persisted category preferences in Map child');
      expect(loaded.presentation.session.user.id).toBe(PEER);
      for (const category of ['addGathering', 'leaderCommands', 'journey', 'arrival']) {
        expect(field(loaded, `notification-preference-${category}`)?.checked).toBe(true);
      }
      await device.perform('notifications.preference.addGathering', { value: false });
      await world.waitFor(device, () => world.backend.tables.notification_preferences[0].add_gathering === false, 'Map category mute persisted');
      await device.perform('notifications.preference.followerRequests', { value: true });
      await world.waitFor(device, () => world.backend.tables.notification_preferences[0].follower_requests === true, 'Map independent category enabled');
      expect(world.backend.tables.notification_preferences[0]).toMatchObject({ user_id: PEER, add_gathering: false,
        leader_commands: true, follower_requests: true, journey: true, arrival: true });
      expect(await device.host.call({ kind: 'press', testId: 'settings-child-back' })).toEqual({ invoked: true });
      await device.input({ kind: 'animation', finished: true });
      const parent = await world.waitFor(device, (value: Observation) => !field(value, 'notification-preference-addGathering'), 'notification child closed');
      expect(field(parent, 'settings-page-notifications')).toBeDefined();
      expect(parent.presentation.route.route).toBe('Map');
      await device.host.call({ kind: 'press', testId: 'settings-root-close' });
      await device.input({ kind: 'animation', finished: true });
      const returned = await world.waitFor(device, (value: Observation) => !field(value, 'settings-page-notifications'), 'settings returns to member Map');
      expect(field(returned, mapEntry)).toBeDefined();
      expect(world.backend.memberships).toHaveLength(2);
    } finally { await world.close(); }
  });
});
