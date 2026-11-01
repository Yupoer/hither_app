const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Observation = { presentation: { hosts: { testId?: string; disabled?: boolean }[] } };
const field = (value: Observation, id: string) => value.presentation.hosts.find(host => host.testId === id);

describe.each(['ios', 'android'])('actual contextual tours on %s', platform => {
  jest.setTimeout(120_000);

  it('completes the actual group tour without creating journey data and suppresses replay after restart', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'group-tour', userId: LEADER, platform, mode: 'app' });
      const enter = async (first: boolean) => {
        for (const testId of [...(first ? ['onboarding-skip'] : []), 'role-my-teams', `team-card-${GROUP_ID}`, 'team-enter']) {
          await world.settle();
          expect(await device.host.call({ kind: 'press', testId })).toEqual({ invoked: true });
        }
      };
      await enter(true);
      await world.advance(1500);
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: Observation) => Boolean(field(value, 'tour-next')) && !field(value, 'tour-next')?.disabled, 'group tour first measured target');
      expect(field(await device.observe(), 'tour-prev')).toBeUndefined();
      expect(world.backend.profiles.get(LEADER).preferences.groupFeatureTourCompleted).not.toBe(true);
      for (let step = 0; step < 20 && field(await device.observe(), 'tour-next'); step++) {
        expect(await device.host.call({ kind: 'press', testId: 'tour-next' })).toEqual({ invoked: true });
        await world.advance(1500);
        await device.input({ kind: 'animation', finished: true });
        await world.settle();
        if (field(await device.observe(), 'tour-next')) await world.waitFor(device, (value: Observation) => !field(value, 'tour-next')?.disabled, 'next group tour target measured');
      }
      expect(field(await device.observe(), 'tour-next')).toBeUndefined();
      expect(world.backend.profiles.get(LEADER).preferences.groupFeatureTourCompleted).toBe(true);
      expect(world.backend.sessions.size).toBe(0);
      expect(world.backend.itinerary).toHaveLength(1);
      expect(world.backend.itinerary[0].id).toBe(DESTINATION);
      await device.restart();
      await enter(false);
      await world.advance(1500);
      expect(field(await device.observe(), 'tour-next')).toBeUndefined();
    } finally { await world.close(); }
  });

  it('navigates the actual add-place tour independently and persists completion without adding the draft', async () => {
    const world = new World();
    world.backend.profiles.get(LEADER).preferences = { groupFeatureTourCompleted: true };
    try {
      const device = await world.device({ id: 'place-tour', userId: LEADER, platform, screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      await world.waitFor(device, (value: Observation) => Boolean(field(value, `gather-card-${DESTINATION}`)), 'Map ready');
      const open = async () => {
        await device.perform('map.pin.drop', { latitude: 35.7148, longitude: 139.7967 });
        await world.advance(0);
        await device.input({ kind: 'animation', finished: true });
        await world.advance(1500);
      };
      await open();
      await world.waitFor(device, (value: Observation) => Boolean(field(value, 'tour-next')) && !field(value, 'tour-next')?.disabled, 'add-place first target');
      expect(world.backend.profiles.get(LEADER).preferences.addPlaceTourCompleted).not.toBe(true);
      expect(await device.host.call({ kind: 'press', testId: 'tour-next' })).toEqual({ invoked: true });
      await world.advance(1500);
      expect(field(await device.observe(), 'tour-prev')).toBeDefined();
      expect(await device.host.call({ kind: 'press', testId: 'tour-prev' })).toEqual({ invoked: true });
      await world.advance(1500);
      expect(field(await device.observe(), 'tour-prev')).toBeUndefined();
      for (let step = 0; step < 2; step++) {
        expect(await device.host.call({ kind: 'press', testId: 'tour-next' })).toEqual({ invoked: true });
        await world.advance(1500);
      }
      expect(world.backend.profiles.get(LEADER).preferences).toMatchObject({ groupFeatureTourCompleted: true, addPlaceTourCompleted: true });
      expect(field(await device.observe(), 'tour-next')).toBeUndefined();
      expect(world.backend.itinerary).toHaveLength(1);
      await device.perform('map.place.cancel');
      await device.restart();
      await open();
      expect(field(await device.observe(), 'tour-next')).toBeUndefined();
      expect(world.backend.itinerary).toHaveLength(1);
    } finally { await world.close(); }
  });
});
