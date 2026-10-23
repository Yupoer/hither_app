export {};

const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID } = require('../../test/headless/backend.cjs');

describe.each(['ios', 'android'])('headless authentication operations on %s', platform => {
  jest.setTimeout(120000);

  const control = (value: any, id: string) => value.presentation.hosts.find((host: any) => host.testId === id && host.value !== undefined);
  const texts = (value: any) => value.presentation.hosts.map((host: any) => host.text).filter(Boolean).join('\n');
  const calls = (world: any, name: string) => world.backend.trace.filter((call: any) => call.name === name);
  async function login(world: any, id = 'login', authFixtures?: any) {
    const device = await world.device({ id, userId: null, platform, screen: { name: 'Login' }, authFixtures });
    await world.waitFor(device, (value: any) => value.presentation.preferences.ready && !value.presentation.session.initializing, 'signed out Login');
    await device.perform('preferences.setLanguage', { args: ['en'] });
    return device;
  }
  async function credentials(device: any, email = 'leader@headless.test', password = 'Headless123!') {
    await device.perform('auth.email.edit', { value: email });
    await device.perform('auth.password.edit', { value: password });
  }

  it('validates credentials locally, preserves drafts and blocks duplicate email sign in', async () => {
    const world = new World();
    try {
      const device = await login(world);
      await credentials(device, 'wrong', '   ');
      await device.host.call({ kind: 'nativeEvent', testId: 'login-email', value: { event: 'onBlur' } });
      await device.host.call({ kind: 'nativeEvent', testId: 'login-password', value: { event: 'onBlur' } });
      expect(texts(await device.observe())).toContain('Enter a valid email');
      expect(texts(await device.observe())).toContain('6 non-space characters');
      expect(await device.perform('auth.email.submit')).toEqual({ invoked: false, reason: 'disabled' });
      expect(calls(world, 'signInWithPassword')).toEqual([]);
      await device.perform('auth.signup.select');
      expect(control(await device.observe(), 'login-email').value).toBe('wrong');
      await device.perform('auth.signin.select');
      await device.perform('auth.password.reveal');
      expect(control(await device.observe(), 'login-password').secureTextEntry).toBe(false);
      await device.perform('auth.password.reveal');
      expect(control(await device.observe(), 'login-password').secureTextEntry).toBe(true);
      await credentials(device, '  leader@headless.test  ', 'badpass');
      await device.perform('auth.email.submit');
      await world.settle();
      expect((await device.observe()).presentation.session.user).toBeNull();
      expect(texts(await device.observe())).toContain('Email or password is incorrect');
      expect(control(await device.observe(), 'login-email').value).toBe('  leader@headless.test  ');
      await device.perform('auth.password.edit', { value: 'Headless123!' });
      expect(texts(await device.observe())).not.toContain('Email or password is incorrect');
      world.hold('signInWithPassword');
      await device.perform('auth.email.submit');
      expect(await device.perform('auth.email.submit')).toEqual({ invoked: false, reason: 'disabled' });
      expect(await device.perform('auth.password.reveal')).toEqual({ invoked: false, reason: 'disabled' });
      await world.release('signInWithPassword');
      const signedIn = await world.waitFor(device, (value: any) => value.presentation.session.user?.id === LEADER && value.presentation.route.route === 'RoleSelect', 'successful sign in');
      expect(signedIn.presentation.session.user.name).toBe('Leader');
      expect(calls(world, 'signInWithPassword').map((call: any) => call.args[0].email)).toEqual(['leader@headless.test', 'leader@headless.test']);
    } finally { await world.close(); }
  });

  it('separates signup confirmation, resend cooldown, reset failure and back controls', async () => {
    const world = new World();
    try {
      const device = await login(world);
      await device.perform('auth.signup.select');
      await credentials(device, '  new@headless.test  ', 'Newpass123!');
      await device.perform('auth.confirm.edit', { value: 'mismatch' });
      expect(await device.perform('auth.email.submit')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('auth.confirm.reveal');
      expect(control(await device.observe(), 'login-confirm-password').secureTextEntry).toBe(false);
      await device.perform('auth.confirm.edit', { value: 'Newpass123!' });
      await device.perform('auth.email.submit');
      await world.settle();
      expect((await device.observe()).presentation.session.user).toBeNull();
      expect((await device.observe()).presentation.route.route).not.toBe('RoleSelect');
      expect(calls(world, 'profiles').filter((call: any) => call.steps.some((step: any) => ['insert', 'upsert'].includes(step[0])))).toEqual([]);
      world.backend.configureAuth({ errors: { resend: { message: 'offline', code: 'NETWORK_ERROR' } } });
      await device.perform('auth.confirmation.resend');
      await world.settle();
      world.backend.configureAuth({ errors: {} });
      expect(await device.perform('auth.confirmation.resend')).toEqual({ invoked: true });
      await world.settle();
      expect(await device.perform('auth.confirmation.resend')).toEqual({ invoked: false, reason: 'disabled' });
      await world.advance(59999);
      expect(await device.perform('auth.confirmation.resend')).toEqual({ invoked: false, reason: 'disabled' });
      await world.advance(1);
      await device.perform('auth.confirmation.resend');
      await world.settle();
      expect(calls(world, 'resend')).toHaveLength(3);
      expect(calls(world, 'resend')[1].args[0]).toMatchObject({ type: 'signup', email: 'new@headless.test' });
      await device.perform('auth.pending.back');
      await device.perform('auth.reset.open');
      await device.perform('auth.reset.edit', { value: 'bad' });
      expect(await device.perform('auth.reset.send')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('auth.reset.edit', { value: '  leader@headless.test  ' });
      world.backend.configureAuth({ errors: { resetPasswordForEmail: { message: 'offline', code: 'NETWORK_ERROR' } } });
      await device.perform('auth.reset.send');
      await world.settle();
      expect(texts(await device.observe())).not.toContain('we sent a reset email');
      world.backend.configureAuth({ errors: {} });
      await device.perform('auth.reset.send');
      await world.settle();
      expect(texts(await device.observe())).toContain('we sent a reset email');
      expect(await device.perform('auth.reset.send')).toEqual({ invoked: false, reason: 'disabled' });
      await world.advance(60000);
      await device.perform('auth.reset.send');
      await world.settle();
      expect(calls(world, 'resetPasswordForEmail')).toHaveLength(3);
      expect(calls(world, 'resetPasswordForEmail')[1].args[0]).toBe('leader@headless.test');
      expect(new URL(calls(world, 'resetPasswordForEmail')[1].args[1].redirectTo).pathname).toBe('/auth/recovery');
      await device.perform('auth.reset.back');
      expect(control(await device.observe(), 'login-password').value).toBe('Newpass123!');
    } finally { await world.close(); }
  });

  it('rejects duplicate and missing signup identities then accepts an immediately signed in registration', async () => {
    const world = new World();
    try {
      const device = await login(world);
      await device.perform('auth.signup.select');
      await credentials(device);
      await device.perform('auth.confirm.edit', { value: 'Headless123!' });
      await device.perform('auth.email.submit');
      await world.settle();
      expect(texts(await device.observe())).toContain('This email already has an account');
      expect((await device.observe()).presentation.session.user).toBeNull();
      world.backend.configureAuth({ responses: { signUp: { data: { user: null, session: null }, error: null } } });
      await device.perform('auth.email.edit', { value: 'missing@headless.test' });
      await device.perform('auth.email.submit');
      await world.settle();
      expect(texts(await device.observe())).toContain('Could not complete authentication');
      expect((await device.observe()).presentation.session.user).toBeNull();
      world.backend.configureAuth({ responses: {}, signUpConfirmation: true });
      await device.perform('auth.email.edit', { value: 'signedup@headless.test' });
      await device.perform('auth.email.submit');
      const result = await world.waitFor(device, (value: any) => value.presentation.session.user?.email === 'signedup@headless.test' && value.presentation.route.route === 'RoleSelect', 'immediate registration');
      expect(result.presentation.session.user.name).toBe('');
      expect(world.backend.profiles.has(result.presentation.session.user.id)).toBe(false);
    } finally { await world.close(); }
  });

  it('opens and cancels guest warning before delayed guest navigation without creating an account', async () => {
    const world = new World();
    try {
      const device = await login(world);
      await device.perform('auth.guest.open');
      expect((await device.observe()).presentation.hosts.some((host: any) => host.testId === 'guest-confirm-button')).toBe(true);
      await device.perform('auth.guest.cancel');
      expect((await device.observe()).presentation.hosts.some((host: any) => host.testId === 'guest-confirm-button')).toBe(false);
      expect((await device.observe()).presentation.session.user).toBeNull();
      await device.perform('auth.guest.open');
      await device.perform('auth.guest.confirm');
      await world.advance(99);
      expect((await device.observe()).presentation.route.route).not.toBe('RoleSelect');
      await world.advance(1);
      expect((await device.observe()).presentation.route.route).toBe('RoleSelect');
      expect((await device.observe()).presentation.session.user).toBeNull();
      expect(calls(world, 'signInAnonymously')).toEqual([]);
    } finally { await world.close(); }
  });

  it('opens only configured HTTPS legal URLs through the real legal handlers', async () => {
    const previous = [process.env.EXPO_PUBLIC_PRIVACY_URL, process.env.EXPO_PUBLIC_TERMS_URL];
    const world = new World();
    try {
      delete process.env.EXPO_PUBLIC_PRIVACY_URL;
      delete process.env.EXPO_PUBLIC_TERMS_URL;
      const absent = await login(world, 'absent');
      await absent.perform('auth.signup.select');
      await absent.perform('auth.privacy');
      await absent.perform('auth.terms');
      expect((await absent.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'openURL')).toEqual([]);
      process.env.EXPO_PUBLIC_PRIVACY_URL = 'https://legal.headless.test/privacy';
      process.env.EXPO_PUBLIC_TERMS_URL = 'https://legal.headless.test/terms';
      const configured = await login(world, 'configured');
      await configured.perform('auth.signup.select');
      await configured.perform('auth.privacy');
      await configured.perform('auth.terms');
      expect((await configured.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'openURL').map((receipt: any) => receipt.url)).toEqual(['https://legal.headless.test/privacy', 'https://legal.headless.test/terms']);
    } finally {
      await world.close();
      for (const [index, key] of ['EXPO_PUBLIC_PRIVACY_URL', 'EXPO_PUBLIC_TERMS_URL'].entries()) {
        if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
      }
    }
  });

  it('cancels social sign in, rejects incomplete credentials and completes the platform Google path', async () => {
    const world = new World();
    try {
      const device = await login(world);
      expect((await device.observe()).presentation.nativeGoogle).toBe(platform === 'ios');
      await device.perform('auth.google');
      await world.settle();
      expect((await device.observe()).presentation.session.user).toBeNull();
      expect(calls(world, 'signInWithIdToken')).toEqual([]);
      expect(calls(world, 'exchangeCodeForSession')).toEqual([]);
      if (platform === 'ios') {
        await device.input({ kind: 'auth.configureNative', value: { google: { result: { type: 'success', data: {} } } } });
        await device.perform('auth.google');
        await world.settle();
        expect(texts(await device.observe())).toContain('Google');
        expect(calls(world, 'signInWithIdToken')).toEqual([]);
        world.backend.configureAuth({ idTokens: [{ provider: 'google', token: 'google-leader', userId: LEADER }], errors: { signInWithIdToken: { code: 'NETWORK_ERROR', message: 'Network request failed' } } });
        await device.input({ kind: 'auth.configureNative', value: { google: { result: { type: 'success', data: { idToken: 'google-leader' } } } } });
        await device.perform('auth.google');
        await world.settle();
        expect(texts(await device.observe())).toContain('connection');
        world.backend.configureAuth({ errors: {} });
      } else {
        world.backend.configureAuth({ codes: [{ code: 'google-code', type: 'signin', userId: LEADER }] });
        await device.input({ kind: 'auth.configureNative', value: { browser: { code: 'google-code' } } });
      }
      await device.perform('auth.google');
      await world.waitFor(device, (value: any) => value.presentation.session.user?.id === LEADER && value.presentation.route.route === 'RoleSelect', 'Google sign in');
      expect(world.backend.profiles.get(LEADER).nickname).toBe('Leader');
      expect(calls(world, 'signInWithOAuth').length > 0).toBe(platform === 'android');
      if (platform === 'ios') {
        const exchange = calls(world, 'signInWithIdToken').at(-1).args[0];
        expect(exchange).toMatchObject({ provider: 'google', token: 'google-leader' });
        expect(exchange.nonce).toMatch(/^[a-f0-9-]{36}$/);
      } else expect(calls(world, 'exchangeCodeForSession').at(-1).args).toEqual(['google-code']);
    } finally { await world.close(); }
  });

  it('cancels Apple, rejects a missing token and preserves the Apple full name on success', async () => {
    const world = new World();
    try {
      const device = await login(world);
      await device.perform('auth.apple');
      await world.settle();
      expect((await device.observe()).presentation.session.user).toBeNull();
      await device.input({ kind: 'auth.configureNative', value: { apple: { result: {} } } });
      await device.perform('auth.apple');
      await world.settle();
      expect(calls(world, 'signInWithIdToken')).toEqual([]);
      expect((await device.observe()).presentation.session.user).toBeNull();
      world.backend.configureAuth({ idTokens: [{ provider: 'apple', token: 'apple-leader', userId: LEADER }] });
      await device.input({ kind: 'auth.configureNative', value: { apple: { result: { identityToken: 'apple-leader', fullName: { givenName: 'Apple', familyName: 'Traveler' } } } } });
      await device.perform('auth.apple');
      await world.waitFor(device, (value: any) => value.presentation.session.user?.name === 'Apple Traveler' && value.presentation.route.route === 'RoleSelect', 'Apple full-name sign in');
      expect(world.backend.profiles.get(LEADER).nickname).toBe('Apple Traveler');
      expect(world.backend.authUsers.get(LEADER).user_metadata.full_name).toBe('Apple Traveler');
      expect(calls(world, 'signInWithIdToken')[0].args[0]).toMatchObject({ provider: 'apple', token: 'apple-leader', nonce: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    } finally { await world.close(); }
  });

  it('validates callback boundaries, consumes one recovery code and submits the recovered password', async () => {
    const world = new World();
    try {
      const device = await login(world);
      const redirect = await device.perform('auth.callback.beginAuthCallback', { args: ['recovery'] });
      const parsed = new URL(redirect);
      const pending = { state: parsed.searchParams.get('state'), kind: 'recovery', expiresAt: world.now + 60000 };
      const callback = `${redirect}&code=recover-leader`;
      for (const invalid of [callback.replace('https:', 'http:'), callback.replace(parsed.host, 'evil.test'), callback.replace('/auth/recovery', '/auth/callback'), `${callback}&state=duplicate`, `${callback}&code=duplicate`, `${callback}#token`, `${callback}&access_token=x`, `${callback}&refresh_token=x`, `${callback}&error=denied`, callback.replace(pending.state!, 'wrong')]) {
        expect(await device.perform('auth.callback.validateAuthCallback', { args: [invalid, pending, parsed.origin] })).toBeNull();
        expect(await device.perform('auth.callback.consumeAuthCallback', { args: [invalid] })).toBeNull();
      }
      expect(await device.perform('auth.callback.validateAuthCallback', { args: [callback, { ...pending, expiresAt: world.now }, parsed.origin] })).toBeNull();
      expect(calls(world, 'exchangeCodeForSession')).toEqual([]);
      world.backend.configureAuth({ codes: [{ code: 'recover-leader', type: 'recovery', userId: LEADER }] });
      await device.perform('auth.callback.consumeAuthCallback', { args: [callback] });
      await world.waitFor(device, (value: any) => value.presentation.session.isPasswordRecovery, 'accepted recovery callback');
      expect(await device.perform('auth.callback.consumeAuthCallback', { args: [callback] })).toBeNull();
      expect(calls(world, 'exchangeCodeForSession')).toHaveLength(1);
      await device.host.mount({ name: 'PasswordRecovery' });
      await device.perform('auth.recovery.password', { value: '  a   b ' });
      await device.perform('auth.recovery.confirm', { value: '  a   b ' });
      expect(await device.perform('auth.recovery.submit')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('auth.recovery.password', { value: 'Changed123!' });
      await device.perform('auth.recovery.confirm', { value: 'mismatch' });
      expect(await device.perform('auth.recovery.submit')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('auth.recovery.confirm', { value: 'Changed123!' });
      await device.perform('auth.recovery.reveal');
      expect(control(await device.observe(), 'recovery-password').secureTextEntry).toBe(false);
      world.backend.configureAuth({ errors: { updateUser: { code: 'NETWORK_ERROR', message: 'offline' } } });
      await device.perform('auth.recovery.submit');
      await world.settle();
      expect((await device.observe()).presentation.session.isPasswordRecovery).toBe(true);
      expect(control(await device.observe(), 'recovery-password').value).toBe('Changed123!');
      world.backend.configureAuth({ errors: {} });
      await device.perform('auth.recovery.submit');
      await world.waitFor(device, (value: any) => value.presentation.session.passwordRecoverySuccess, 'password update success');
      expect(world.backend.authAccounts.get(LEADER).password).toBe('Changed123!');
      await world.advance(1199);
      expect((await device.observe()).presentation.session.passwordRecoverySuccess).toBe(true);
      await world.advance(1);
      expect((await device.observe()).presentation.session.passwordRecoverySuccess).toBe(false);
    } finally { await world.close(); }
  });

  it('handles deep-link callbacks once and consumes a rejected exchange before another delivery', async () => {
    const world = new World();
    try {
      const device = await login(world);
      const redirect = await device.perform('auth.callback.beginAuthCallback', { args: ['recovery'] });
      world.backend.configureAuth({ codes: [{ code: 'link-recovery', type: 'recovery', userId: LEADER }] });
      world.hold('exchangeCodeForSession');
      const callback = `${redirect}&code=link-recovery`;
      await device.input({ kind: 'linking', url: callback });
      await device.input({ kind: 'linking', url: callback });
      await device.input({ kind: 'linking', url: `${redirect}&code=other-code` });
      await world.settle();
      expect((await device.observe()).presentation.session.isPasswordRecovery).toBe(false);
      expect(world.held.filter((item: any) => item.operation.name === 'exchangeCodeForSession')).toHaveLength(1);
      await world.release('exchangeCodeForSession');
      await world.waitFor(device, (value: any) => value.presentation.session.isPasswordRecovery, 'actual SessionProvider deep-link recovery');
      await device.input({ kind: 'linking', url: callback });
      await world.settle();
      expect(calls(world, 'exchangeCodeForSession')).toHaveLength(1);
      const failedRedirect = await device.perform('auth.callback.beginAuthCallback', { args: ['signup'] });
      await device.input({ kind: 'linking', url: `${failedRedirect}&code=unknown-code` });
      await world.settle();
      world.backend.configureAuth({ codes: [{ code: 'unknown-code', type: 'signup', userId: LEADER }] });
      await device.input({ kind: 'linking', url: `${failedRedirect}&code=unknown-code` });
      await world.settle();
      expect(calls(world, 'exchangeCodeForSession')).toHaveLength(2);
      expect(world.backend.authCodes.has('unknown-code')).toBe(true);
    } finally { await world.close(); }
  });

  it('reports Google profile failures and stage timeouts without navigating to home', async () => {
    const world = new World();
    try {
      const device = await login(world);
      async function prepare(code: string) {
        if (platform === 'ios') {
          world.backend.configureAuth({ idTokens: [{ provider: 'google', token: code, userId: LEADER }] });
          await device.input({ kind: 'auth.configureNative', value: { google: { result: { type: 'success', data: { idToken: code } } } } });
        } else {
          world.backend.configureAuth({ codes: [{ code, type: 'signin', userId: LEADER }] });
          await device.input({ kind: 'auth.configureNative', value: { browser: { code } } });
        }
      }
      await prepare('profile-failure');
      world.backend.failNext({ kind: 'table', name: 'profiles', mode: 'select' }, { code: 'NETWORK_ERROR', message: 'Network request failed' });
      await device.perform('auth.google');
      await world.settle();
      expect(texts(await device.observe())).toContain('profile could not sync');
      expect((await device.observe()).presentation.route.route).not.toBe('RoleSelect');
      await prepare('profile-timeout');
      world.hold('profiles');
      await device.perform('auth.google');
      await world.settle();
      expect((await device.observe()).presentation.route.route).not.toBe('RoleSelect');
      await world.advance(12000);
      expect(texts(await device.observe())).toContain('profile setup timed out');
      expect((await device.observe()).presentation.route.route).not.toBe('RoleSelect');
      await world.release('profiles');
      expect((await device.observe()).presentation.route.route).not.toBe('RoleSelect');
      if (platform === 'ios') {
        await prepare('exchange-timeout');
        world.hold('signInWithIdToken');
        await device.perform('auth.google');
        await world.advance(12000);
        expect(texts(await device.observe())).toContain('Google verification timed out');
        expect((await device.observe()).presentation.route.route).not.toBe('RoleSelect');
        await world.release('signInWithIdToken');
        expect((await device.observe()).presentation.route.route).not.toBe('RoleSelect');
      }
    } finally { await world.close(); }
  });
  it('creates and joins through lazy anonymous auth while rejecting empty and invalid group submissions', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'guest-team', userId: null, platform, screen: { name: 'Auth', params: { role: 'leader' } } });
      await world.waitFor(device, (value: any) => !value.presentation.session.initializing, 'guest create form');
      expect(await device.perform('team.create')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('team.name', { value: '  Guest Leader  ' });
      expect(await device.perform('team.create')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('team.group-name', { value: '  Guest team  ' });
      world.backend.configureAuth({ errors: { signInAnonymously: { code: 'NETWORK_ERROR', message: 'offline' } } });
      await device.perform('team.create');
      await world.settle();
      expect((await device.observe()).presentation.session.membership).toBeNull();
      expect(calls(world, 'create_group')).toEqual([]);
      await device.input({ kind: 'alert', index: 0 });
      world.backend.configureAuth({ errors: {} });
      world.hold('create_group');
      await device.perform('team.create');
      await world.waitFor(device, (value: any) => value.presentation.session.isAnonymous, 'lazy anonymous identity');
      expect(await device.perform('team.create')).toEqual({ invoked: false, reason: 'disabled' });
      await world.release('create_group');
      const created = await world.waitFor(device, (value: any) => value.presentation.session.membership?.group.name === 'Guest team' && value.presentation.route.route === 'Map', 'created guest team');
      const actor = created.presentation.session.user.id;
      expect(created.presentation.session.membership.role).toBe('leader');
      expect(world.backend.profiles.get(actor).nickname).toBe('Guest Leader');
      expect(calls(world, 'create_group').at(-1).args.p_name).toBe('Guest team');
      expect(world.backend.memberships.some((row: any) => row.user_id === actor && row.group_id === created.presentation.session.membership.group.id)).toBe(true);
      await device.host.mount({ name: 'Auth', params: { role: 'follower' } });
      await device.perform('team.code', { value: 'bad-??' });
      expect(control(await device.observe(), 'auth-code').value).toBe('BAD');
      expect(await device.perform('team.join')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('team.code', { value: 'BAD000' });
      await device.perform('team.join');
      await world.settle();
      expect((await device.observe()).presentation.session.membership.group.name).toBe('Guest team');
      await device.input({ kind: 'alert', index: 0 });
      await device.perform('team.name', { value: '  Renamed Guest  ' });
      await device.perform('team.code', { value: 'te-st42!' });
      expect(control(await device.observe(), 'auth-code').value).toBe('TEST42');
      await device.perform('team.join');
      const joined = await world.waitFor(device, (value: any) => value.presentation.session.membership?.group.id === GROUP_ID && value.presentation.route.route === 'Map', 'guest joined existing team');
      expect(joined.presentation.session.membership.role).toBe('follower');
      expect(world.backend.profiles.get(actor).nickname).toBe('Renamed Guest');
      expect(calls(world, 'signInAnonymously')).toHaveLength(2);
      expect(calls(world, 'join_group').at(-1).args).toEqual({ p_code: 'TEST42' });
    } finally { await world.close(); }
  });

  it('restores durable identity, retries transient foreground refresh and clears only terminal sessions', async () => {
    const world = new World();
    try {
      world.hold('profiles');
      const device = await world.device({ id: 'restore', userId: LEADER, platform, screen: { name: 'RoleSelect' } });
      const local = await world.waitFor(device, (value: any) => value.presentation.session.user?.id === LEADER && !value.presentation.session.initializing, 'local identity before profile enrichment');
      expect(local.presentation.session.user.name).toBe('');
      await world.release('profiles');
      await world.advance(0);
      await world.waitFor(device, (value: any) => value.presentation.session.user?.name === 'Leader', 'restored enriched identity');
      const initialRefreshes = calls(world, 'refreshSession').length;
      await world.advance(0);
      expect(calls(world, 'refreshSession')).toHaveLength(initialRefreshes);
      world.backend.configureAuth({ errors: { refreshSession: { code: 'NETWORK_ERROR', message: 'Network request failed' } } });
      await device.input({ kind: 'appState', value: 'background' });
      await device.input({ kind: 'appState', value: 'active' });
      await world.advance(0);
      expect((await device.observe()).presentation.session.user.id).toBe(LEADER);
      const firstFailure = calls(world, 'refreshSession').length;
      await world.advance(1999);
      expect(calls(world, 'refreshSession')).toHaveLength(firstFailure);
      await world.advance(1);
      expect(calls(world, 'refreshSession')).toHaveLength(firstFailure + 1);
      await world.advance(3999);
      expect(calls(world, 'refreshSession')).toHaveLength(firstFailure + 1);
      world.backend.configureAuth({ errors: {} });
      await world.advance(1);
      expect(calls(world, 'refreshSession')).toHaveLength(firstFailure + 2);
      const before = await device.observe();
      await device.restart();
      const restored = await world.waitFor(device, (value: any) => value.presentation.session.user?.id === LEADER && !value.presentation.session.initializing, 'durable auth restore');
      expect(restored.pid).not.toBe(before.pid);
      expect(calls(world, 'signInWithPassword')).toEqual([]);
      expect(calls(world, 'signInAnonymously')).toEqual([]);
      world.backend.configureAuth({ errors: { refreshSession: { code: 'refresh_token_not_found', message: 'Invalid refresh token' } } });
      await device.input({ kind: 'appState', value: 'background' });
      await device.input({ kind: 'appState', value: 'active' });
      await world.advance(0);
      await world.waitFor(device, (value: any) => value.presentation.session.user === null && value.actorId === null, 'terminal auth invalidation');
      const afterTerminal = calls(world, 'refreshSession').length;
      await world.advance(30000);
      expect(calls(world, 'refreshSession')).toHaveLength(afterTerminal);
    } finally { await world.close(); }
  });

  it('cancels registered signout, keeps identity on auth failure and clears state after successful retry', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'signout', userId: LEADER, platform, screen: { name: 'RoleSelect' } });
      await world.waitFor(device, (value: any) => value.presentation.session.user?.id === LEADER, 'registered account');
      await device.input({ kind: 'liveExisting', activities: [{ activityId: 'signed-in-activity' }] });
      await device.perform('home.signout');
      await device.input({ kind: 'alert', index: 0 });
      expect((await device.observe()).presentation.session.user.id).toBe(LEADER);
      expect(calls(world, 'signOut')).toEqual([]);
      world.backend.configureAuth({ errors: { signOut: { code: 'NETWORK_ERROR', message: 'offline' } } });
      await device.perform('home.signout');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: any) => value.external.alerts > 0, 'signout failure alert');
      expect((await device.observe()).presentation.session.user.id).toBe(LEADER);
      expect(world.backend.authUsers.has(LEADER)).toBe(true);
      world.backend.configureAuth({ errors: {} });
      await device.input({ kind: 'alert', index: 1 });
      const result = await world.waitFor(device, (value: any) => value.presentation.session.user === null && value.presentation.route.route === 'Login', 'signout retry');
      expect(result.presentation.session.membership).toBeNull();
      expect(result.presentation.session.premiumProjection.personalPremiumActive).toBe(false);
      expect(result.durable.locations).toEqual([]);
      expect(result.native.activities).toEqual([]);
      expect(calls(world, 'delete_anonymous_account')).toEqual([]);
      expect(calls(world, 'signOut').at(-1).args).toEqual([{ scope: 'local' }]);
      expect(world.backend.authUsers.has(LEADER)).toBe(true);
    } finally { await world.close(); }
  });

  it('boots the real navigator from durable login state and removes protected routes after signout', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'app-auth', userId: null, platform, screen: { name: 'Onboarding' } });
      await world.waitFor(device, (value: any) => value.presentation.preferences.ready && !value.presentation.session.initializing, 'onboarding pre-session app');
      await device.perform('onboarding.continue');
      await device.perform('onboarding.back');
      await device.perform('onboarding.skip');
      await world.settle();
      expect(await device.perform('onboarding.readOnboardingState')).toMatchObject({ completed: true });
      device.spec.mode = 'app';
      delete device.spec.screen;
      await device.restart();
      await world.waitFor(device, (value: any) => value.presentation.route.route === 'Login' && value.presentation.session.user === null, 'real logged-out initial route');
      await credentials(device);
      await device.perform('auth.email.submit');
      await world.waitFor(device, (value: any) => value.presentation.route.route === 'RoleSelect' && value.presentation.session.user?.id === LEADER, 'real authenticated root route');
      await device.restart();
      await world.waitFor(device, (value: any) => value.presentation.route.route === 'RoleSelect' && value.presentation.session.user?.id === LEADER, 'real authenticated cold launch');
      await device.perform('home.teams');
      expect((await device.observe()).presentation.route.route).toBe('MyTeams');
      await device.perform('session.signout');
      const signedOut = await world.waitFor(device, (value: any) => value.presentation.route.route === 'Login' && value.presentation.session.user === null, 'protected navigator remounted after signout');
      expect(signedOut.presentation.route.routes.map((route: any) => route.name)).toEqual(['Login']);
      expect(signedOut.presentation.hosts.some((host: any) => host.testId === 'role-my-teams')).toBe(false);
    } finally { await world.close(); }
  });

  it('deletes an anonymous identity during signout and deletes an account only after confirmation and server success', async () => {
    const world = new World();
    try {
      world.backend.configureAuth({ accounts: [{ id: PEER, is_anonymous: true }] });
      const anon = await world.device({ id: 'anonymous-signout', userId: PEER, platform, screen: { name: 'RoleSelect' } });
      await world.waitFor(anon, (value: any) => value.presentation.session.isAnonymous, 'anonymous session');
      await anon.perform('home.signout');
      await anon.input({ kind: 'alert', index: 1 });
      await world.waitFor(anon, (value: any) => value.presentation.session.user === null && value.presentation.route.route === 'Login', 'anonymous deletion signout');
      expect(world.backend.authUsers.has(PEER)).toBe(false);
      expect(world.backend.profiles.has(PEER)).toBe(false);
      const device = await world.device({ id: 'delete', userId: LEADER, platform, screen: { name: 'AccountSheetContent' } });
      await world.waitFor(device, (value: any) => value.presentation.session.user?.id === LEADER, 'account sheet identity');
      await device.input({ kind: 'liveExisting', activities: [{ activityId: 'delete-account-activity' }] });
      await device.perform('account.delete');
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.profiles.has(LEADER)).toBe(true);
      expect(calls(world, 'delete_anonymous_account').filter((call: any) => call.userId === LEADER)).toEqual([]);
      world.backend.failNext({ kind: 'rpc', name: 'delete_anonymous_account' }, { code: 'NETWORK_ERROR', message: 'offline' });
      await device.perform('account.delete');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: any) => value.external.alerts > 0, 'deletion failure alert');
      expect(world.backend.profiles.has(LEADER)).toBe(true);
      expect((await device.observe()).presentation.session.user.id).toBe(LEADER);
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onAccountDeleted')).toEqual([]);
      await device.input({ kind: 'alert', index: 0 });
      await device.perform('account.delete');
      await device.input({ kind: 'alert', index: 1 });
      const deleted = await world.waitFor(device, (value: any) => value.presentation.session.user === null, 'verified account deletion');
      expect(world.backend.profiles.has(LEADER)).toBe(false);
      expect(world.backend.authUsers.has(LEADER)).toBe(false);
      expect(world.backend.memberships.some((row: any) => row.user_id === LEADER)).toBe(false);
      expect(deleted.presentation.receipts.filter((receipt: any) => receipt.method === 'onAccountDeleted')).toHaveLength(1);
      expect(deleted.presentation.receipts.filter((receipt: any) => receipt.method === 'onClose')).toHaveLength(1);
      expect(deleted.durable.locations).toEqual([]);
      expect(deleted.native.activities).toEqual([]);
    } finally { await world.close(); }
  });

  it('drops team Premium on leave while retaining authoritative personal Premium when refresh fails', async () => {
    const world = new World();
    try {
      world.backend.premium.set(LEADER, { status: 'active', product_id: 'app.hither.premium.annual', expires_at: new Date(world.now + 86400000).toISOString() });
      const device = await world.device({ id: 'leave', userId: LEADER, platform, screen: { name: 'RoleSelect' } });
      await world.waitFor(device, (value: any) => value.presentation.session.user?.id === LEADER, 'leave account');
      await device.perform('session.membership', { args: [{ group: { id: GROUP_ID, name: 'Headless team' }, role: 'leader' }] });
      await world.waitFor(device, (value: any) => value.presentation.session.premiumProjection.personalPremiumActive && value.presentation.session.premiumProjection.teamPremiumActive, 'authoritative personal and team Premium');
      world.backend.failNext({ kind: 'rpc', name: 'get_premium_projection' }, { code: 'NETWORK_ERROR', message: 'offline' });
      await device.perform('session.leave');
      const left = await world.waitFor(device, (value: any) => value.presentation.session.membership === null && !value.presentation.session.premiumProjection.teamPremiumActive, 'leave clears team access despite failed refresh');
      expect(left.presentation.session.premiumProjection.personalPremiumActive).toBe(true);
      expect(left.presentation.session.user.id).toBe(LEADER);
      expect(left.presentation.session.tripEntitlement).toBeNull();
      expect(world.backend.memberships.some((row: any) => row.group_id === GROUP_ID && row.user_id === LEADER)).toBe(true);
    } finally { await world.close(); }
  });
});
