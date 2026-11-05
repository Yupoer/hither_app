const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID } = require('../../test/headless/backend.cjs');

describe.each(['ios', 'android'])('real App native host foundation on %s', platform => {
  jest.setTimeout(90000);
  it('persists the executing OTA identity at consented launch and foreground resume', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'release-trail', userId: LEADER, platform, mode: 'app',
        updatesFixtures: { isEmbeddedLaunch: false, updateId: 'executing-update', runtimeVersion: '0.1.14' } });
      await world.settle();
      expect(await device.host.call({ kind: 'press', testId: 'onboarding-skip' })).toEqual({ invoked: true });
      await world.waitFor(device, (value: any) => value.presentation.preferences?.ready && value.presentation.session && !value.presentation.session.initializing, 'App preferences and session ready');
      expect(await device.perform('diagnostics.list')).toEqual([]);
      await device.perform('preferences.setDiagnosticUploadEnabled', { args: [true] });
      await world.settle();
      const launches = await device.perform('diagnostics.list');
      const launch = launches.find((record: any) => record.event === 'app_foreground' && record.payload.source === 'launch');
      expect(launch?.payload).toEqual({ source: 'launch', updateId: 'executing-update', runtimeVersion: '0.1.14' });
      await device.input({ kind: 'appState', value: 'inactive' });
      await device.input({ kind: 'appState', value: 'active' });
      await world.settle();
      const resumed = await device.perform('diagnostics.list');
      expect(resumed.some((record: any) => record.event === 'app_foreground' && record.payload.source === 'resume'
        && record.payload.updateId === 'executing-update')).toBe(true);
      await device.restart();
      await world.settle();
      expect((await device.perform('diagnostics.list')).some((record: any) => record.id === launch.id)).toBe(true);
    } finally { await world.close(); }
  });
  it('mounts the map sheet body during a held drag and releases it again at peek', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'sheet', userId: LEADER, platform, screen: { name: 'Map', params: { groupId: GROUP_ID } } });
      await world.settle();
      const nativeMap = (await device.observe()).presentation.hosts.find((node: { testId?: string }) => node.testId === 'group-map-native');
      expect(nativeMap.showsUserLocation).toBe(platform === 'ios');
      const observeSheet = async () => (await device.observe()).presentation.mapSheet;
      const peek = await observeSheet();
      expect(peek).toEqual({ height: expect.any(Number), settledIndex: 0, bodyMounted: false });
      const gesture = (phase: string, translationY = 0) => device.host.call({
        kind: 'gesture', testId: 'map-bottom-sheet', phase, value: { translationY, velocityY: 0 },
      });
      await gesture('onBegin');
      await gesture('onUpdate', -100);
      expect(await observeSheet()).toEqual({ height: peek.height + 100, settledIndex: 0, bodyMounted: true });
      await gesture('onUpdate', -200);
      expect(await observeSheet()).toEqual({ height: peek.height + 200, settledIndex: 0, bodyMounted: true });
      await gesture('onUpdate', 0);
      expect(await observeSheet()).toEqual(peek);
      await gesture('onEnd');
      expect(await observeSheet()).toEqual(peek);
    } finally { await world.close(); }
  });
  it('direct screen mounts update observed route while navigation retains its stack', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'screen', userId: LEADER, platform, screen: { name: 'RoleSelect' } });
      await device.host.call({ kind: 'press', testId: 'role-my-teams' });
      await world.settle();
      expect((await device.observe()).presentation.route.routes.map((route: any) => route.name)).toEqual(['RoleSelect', 'MyTeams']);
      await device.host.mount({ name: 'MyTeams', params: { source: 'direct' } });
      await world.settle();
      const mounted = await device.observe();
      expect(mounted.presentation.route).toEqual({ route: 'MyTeams', params: { source: 'direct' }, routes: [{ name: 'MyTeams', params: { source: 'direct' } }] });
      expect(mounted.presentation.hosts.some((node: any) => node.testId === `team-card-${GROUP_ID}`)).toBe(true);
      await device.host.call({ kind: 'press', testId: `team-card-${GROUP_ID}` });
      await device.host.call({ kind: 'press', testId: 'team-enter' });
      await world.settle();
      const navigated = await device.observe();
      expect(navigated.presentation.route.route).toBe('Map');
      expect(navigated.presentation.route.routes.map((route: any) => route.name)).toEqual(['Map']);
    } finally { await world.close(); }
  });
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
