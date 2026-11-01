export {};

const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

type Observation = {
  presentation: {
    hosts: { testId?: string; text?: string; acceptsInput?: boolean }[];
    route: { route: string };
    session: {
      user: { id: string } | null;
      isAnonymous: boolean;
      membership: { group: { id: string }; role: string } | null;
    } | null;
  };
};

const has = (value: Observation, testId: string) => value.presentation.hosts.some(host => host.testId === testId && host.acceptsInput);

describe.each(['ios', 'android'])('actual App team entry boundaries on %s', platform => {
  jest.setTimeout(120000);

  it('finishes full onboarding through App and opens Login without a restart', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'app-onboarding', userId: null, platform, mode: 'app' });
      await world.waitFor(device, (value: Observation) => has(value, 'onboarding-continue'), 'App first-launch onboarding');
      await device.perform('onboarding.continue');
      await device.perform('onboarding.continue');
      await world.waitFor(device, (value: Observation) => has(value, 'onboarding-theme-forest'), 'permission completion opens theme selection');
      await device.host.call({ kind: 'press', testId: 'onboarding-theme-forest' });
      await device.perform('onboarding.continue');
      for (const label of ['我只是先下載看看', '找人', '家人', '即時定位']) {
        await device.perform('onboarding.option', { label });
        await device.perform('onboarding.continue');
      }
      expect(has(await device.observe(), 'login-email')).toBe(false);
      await device.perform('onboarding.continue');
      const completed = await world.waitFor(device, (value: Observation) => value.presentation.route.route === 'Login' && has(value, 'login-email'), 'App onDone replaces onboarding with Login');
      expect(has(completed, 'onboarding-continue')).toBe(false);
      expect(completed.presentation.session?.user).toBeNull();
      expect(await device.perform('onboarding.readOnboardingState')).toMatchObject({
        completed: true,
        answers: { role: 'browser', theme: 'forest', why: 'findPeople', companions: 'family', wanted: 'liveLocation' },
      });
      expect(await device.perform('onboarding.readOnboardingReplayIntent')).toBe(false);
    } finally { await world.close(); }
  });

  it('presents recovery from an App deep link and returns to authenticated home after completion', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'app-recovery', userId: null, platform, mode: 'app' });
      await world.waitFor(device, (value: Observation) => has(value, 'onboarding-skip'), 'App first-launch gate');
      await device.perform('onboarding.skip');
      await world.waitFor(device, (value: Observation) => has(value, 'login-email'), 'App Login');
      await device.perform('auth.reset.open');
      await device.perform('auth.reset.edit', { value: 'leader@headless.test' });
      await device.perform('auth.reset.send');
      await world.settle();
      const reset = world.backend.trace.find((call: { name: string }) => call.name === 'resetPasswordForEmail');
      expect(reset.args[0]).toBe('leader@headless.test');
      world.backend.configureAuth({ codes: [{ code: 'app-recovery-code', type: 'recovery', userId: LEADER }] });
      await device.input({ kind: 'linking', url: `${reset.args[1].redirectTo}&code=app-recovery-code` });
      const recovery = await world.waitFor(device, (value: Observation) => has(value, 'recovery-password'), 'App replaces navigator with PasswordRecovery');
      expect(has(recovery, 'login-reset-email')).toBe(false);
      expect(has(recovery, 'role-create')).toBe(false);
      await device.perform('auth.recovery.password', { value: 'AppRecovered123!' });
      await device.perform('auth.recovery.confirm', { value: 'AppRecovered123!' });
      await device.perform('auth.recovery.submit');
      const success = await world.waitFor(device, (value: Observation) => value.presentation.hosts.some(host => host.text === '密碼已更新'), 'App recovery success screen');
      expect(world.backend.authAccounts.get(LEADER).password).toBe('AppRecovered123!');
      expect(has(success, 'recovery-password')).toBe(false);
      expect(has(success, 'role-create')).toBe(false);
      await world.advance(1199);
      expect(has(await device.observe(), 'role-create')).toBe(false);
      await world.advance(1);
      const home = await world.waitFor(device, (value: Observation) => value.presentation.route.route === 'RoleSelect' && has(value, 'role-create'), 'App recovery dismissal remounts authenticated navigator');
      expect(home.presentation.session?.user?.id).toBe(LEADER);
      expect(home.presentation.hosts.some((host: { text?: string }) => host.text === '密碼已更新')).toBe(false);
      expect(world.backend.trace.filter((call: { name: string }) => call.name === 'exchangeCodeForSession')).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('upgrades an anonymous leader through Map settings account while preserving identity and team ownership', async () => {
    const world = new World();
    try {
      world.backend.configureAuth({ accounts: [{ id: LEADER, is_anonymous: true }], emailConfirmation: true });
      world.backend.profiles.get(LEADER).anonymous_expires_at = new Date(world.now + 7 * 86400000).toISOString();
      world.backend.profiles.get(LEADER).preferences = { groupFeatureTourCompleted: true };
      const device = await world.device({ id: 'app-map-account', userId: LEADER, platform, mode: 'app' });
      await world.waitFor(device, (value: Observation) => has(value, 'onboarding-skip'), 'App restored anonymous onboarding gate');
      await device.perform('onboarding.skip');
      await world.waitFor(device, (value: Observation) => has(value, 'role-my-teams'), 'App restored anonymous home');
      await device.perform('home.teams');
      await device.perform('teams.expand', { groupId: GROUP_ID });
      await device.perform('teams.enter');
      const map = await world.waitFor(device, (value: Observation) => value.presentation.route.route === 'Map' && has(value, `gather-card-${DESTINATION}`), 'saved anonymous team opens actual Map');
      expect(map.presentation.session).toMatchObject({ user: { id: LEADER }, isAnonymous: true, membership: { group: { id: GROUP_ID }, role: 'leader' } });
      const memberships = structuredClone(world.backend.memberships);
      expect(world.backend.groups.get(GROUP_ID).created_by).toBe(LEADER);
      await device.perform('map.settings.open');
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: Observation) => has(value, 'settings-page-account'), 'Map settings parent');
      await device.perform('settings.account');
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: Observation) => has(value, 'account-email'), 'real settings account child');
      await device.perform('account.email', { value: '  app-upgraded@headless.test  ' });
      await device.perform('account.password', { value: 'AppUpgrade123!' });
      await device.perform('account.upgrade');
      const upgraded = await world.waitFor(device, (value: Observation) => value.presentation.session?.isAnonymous === false && !has(value, 'account-upgrade'), 'Map account reflects registered identity');
      expect(upgraded.presentation.route.route).toBe('Map');
      expect(upgraded.presentation.session).toMatchObject({
        user: { id: LEADER, email: 'app-upgraded@headless.test', provider: 'email' },
        membership: { group: { id: GROUP_ID }, role: 'leader' },
      });
      expect(world.backend.authUsers.get(LEADER)).toMatchObject({ id: LEADER, email: 'app-upgraded@headless.test', is_anonymous: false });
      expect(world.backend.memberships).toEqual(memberships);
      expect(world.backend.groups.get(GROUP_ID).created_by).toBe(LEADER);
      expect(world.backend.profiles.get(LEADER).anonymous_expires_at).toBeNull();
      await device.perform('settings.back');
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: Observation) => has(value, 'settings-page-account') && !has(value, 'settings-child-back'), 'account child closes through its settings parent');
      await device.perform('settings.account');
      await device.input({ kind: 'animation', finished: true });
      expect(has(await device.observe(), 'account-upgrade')).toBe(false);
      expect(world.backend.memberships).toEqual(memberships);
    } finally { await world.close(); }
  });
});
