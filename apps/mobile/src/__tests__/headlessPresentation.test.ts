const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID } = require('../../test/headless/backend.cjs');

describe.each(['ios', 'android'])('real App native host foundation on %s', platform => {
  jest.setTimeout(90000);
  it('cold mounts real providers and navigates through onboarding and MyTeams into the real Map', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'app', userId: LEADER, platform, mode: 'app' });
      for (const testId of ['onboarding-skip', 'role-my-teams', `team-card-${GROUP_ID}`, 'team-enter']) {
        await world.settle();
        expect(await device.host.call({ kind: 'press', testId })).toEqual({ invoked: true });
      }
      await world.settle();
      const observed = await device.observe();
      expect(observed.presentation.route.route).toBe('Map');
      expect(observed.presentation.session.user.id).toBe(LEADER);
      expect(observed.presentation.session.membership.group.id).toBe(GROUP_ID);
      expect(observed.presentation.hosts.some((node: any) => node.testId === 'group-map-native')).toBe(true);
      expect(observed.presentation.hosts.some((node: any) => node.testId === 'app-error-retry')).toBe(false);
      expect(observed.presentation.nativeGoogle).toBe(platform === 'ios');
      const paths = observed.presentation.resolved.map((file: string) => file.replace(/\\/g, '/'));
      expect(paths.some((file: string) => file.endsWith(platform === 'ios' ? '/state/googleSignIn.ios.ts' : '/state/googleSignIn.ts'))).toBe(true);
      expect(paths.some((file: string) => file.endsWith(platform === 'ios' ? '/components/NativeGlassButton.ios.tsx' : '/components/NativeGlassButton.tsx'))).toBe(true);
      expect(world.backend.trace.filter((call: any) => call.name === 'get_trip_entitlement').length).toBeLessThan(12);
    } finally { await world.close(); }
  });
});
