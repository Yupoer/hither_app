const assert = require('node:assert/strict');
const backendAuth = require('./backend-auth.cjs');
const { createExternalAuth } = require('./external-auth.cjs');

async function main() {
  const LEADER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const PEER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const backend = { now: Date.parse('2026-10-22T00:00:00Z') };
  backendAuth.initialize(backend, { LEADER, PEER });
  const fatals = [];
  const strict = (name, value) => new Proxy(value, { get(target, key) {
    if (typeof key !== 'symbol' && !['then', '__esModule', 'toJSON', '$$typeof'].includes(key) && !Reflect.has(target, key)) {
      const message = `Unsupported external ${name}.${key}`; fatals.push(message); throw new Error(message);
    }
    return target[key];
  } });
  const request = operation => Promise.resolve(backendAuth.execute(backend, operation));
  const values = new Map();
  const storage = { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => values.set(key, value), removeItem: async key => values.delete(key) };
  const create = () => {
    const fixture = createExternalAuth({ strict, request });
    const auth = fixture.createAuth({ auth: { storage } });
    return { fixture, auth };
  };
  const { fixture, auth } = create();
  await fixture.restore(null);
  assert.equal((await auth.getSession()).data.session, null);
  const events = [];
  const subscription = auth.onAuthStateChange((event, session) => events.push([event, session?.user.id]));
  await Promise.resolve();
  assert.equal((await auth.signInWithPassword({ email: 'leader@headless.test', password: 'wrong' })).error.code, 'invalid_credentials');
  assert.equal((await auth.getSession()).data.session, null);
  assert.equal((await auth.signInWithPassword({ email: 'leader@headless.test', password: 'Headless123!' })).data.user.id, LEADER);
  assert(events.some(([event, id]) => event === 'SIGNED_IN' && id === LEADER));
  const previous = (await auth.getSession()).data.session;
  const rotated = await auth.refreshSession();
  assert.notEqual(rotated.data.session.refresh_token, previous.refresh_token);
  assert.equal((await auth.refreshSession({ refresh_token: previous.refresh_token })).error.code, 'refresh_token_not_found');
  const restored = create(); await restored.fixture.restore(PEER);
  assert.equal((await restored.auth.getSession()).data.session.user.id, LEADER);
  await restored.auth.signOut({ scope: 'local' });
  const signedOut = create(); await signedOut.fixture.restore(LEADER);
  assert.equal((await signedOut.auth.getSession()).data.session, null, 'Explicit signout survives named fixture restart');
  const signup = await auth.signUp({ email: 'new@headless.test', password: 'Headless123!' });
  assert.equal(signup.data.session, null); assert.equal(signup.data.user.identities.length, 1);
  assert.equal((await auth.signUp({ email: 'new@headless.test', password: 'Headless123!' })).data.user.identities.length, 0);
  const anonymous = await auth.signInAnonymously();
  assert.equal(anonymous.data.user.is_anonymous, true);
  const anonId = anonymous.data.user.id;
  await auth.updateUser({ email: 'upgrade@headless.test', password: 'Upgraded123!' });
  assert.equal((await auth.getUser()).data.user.is_anonymous, true, 'Pending confirmation retains anonymous state');
  backendAuth.configure(backend, { emailConfirmation: true });
  await auth.updateUser({ email: 'upgrade@headless.test' });
  assert.equal((await auth.getUser()).data.user.is_anonymous, false);
  backendAuth.configure(backend, { idTokens: [{ token: 'google-token', userId: anonId, provider: 'google' }],
    codes: [{ code: 'recovery-code', userId: anonId, type: 'recovery' }] });
  assert.equal((await auth.linkIdentity({ provider: 'google', token: 'google-token' })).data.user.id, anonId);
  assert.equal((await auth.signInWithIdToken({ provider: 'google', token: 'unknown' })).error.code, 'bad_jwt');
  await auth.exchangeCodeForSession('recovery-code');
  assert(events.some(([event]) => event === 'PASSWORD_RECOVERY'));
  assert.equal((await auth.exchangeCodeForSession('recovery-code')).error.code, 'flow_state_not_found');
  await auth.updateUser({ password: 'Recovered123!' });
  await auth.signOut();
  assert.equal((await auth.signInWithPassword({ email: 'upgrade@headless.test', password: 'Recovered123!' })).data.user.id, anonId);
  assert.equal((await auth.resetPasswordForEmail('upgrade@headless.test', { redirectTo: 'https://hither-legal.pages.dev/auth/recovery' })).error, null);
  assert.equal((await auth.resend({ type: 'signup', email: 'new@headless.test' })).error, null);
  assert((await auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'https://hither-legal.pages.dev/auth/callback' } })).data.url);
  const modules = new Map(); fixture.install({ doMock: (name, factory) => modules.set(name, factory()) });
  const digest = await modules.get('expo-crypto').digestStringAsync('SHA-256', 'raw-nonce');
  assert.equal(digest.length, 64);
  const google = modules.get('@react-native-google-signin/google-signin');
  assert.equal((await google.GoogleSignin.signIn({ nonce: digest })).type, 'cancelled');
  fixture.configureNative({ google: { result: { type: 'success', data: { idToken: 'google-token' } } }, browser: { code: 'fixture-code' },
    apple: { result: { identityToken: 'apple-token' } } });
  assert.equal((await google.GoogleSignin.signIn({ nonce: digest })).data.idToken, 'google-token');
  assert.equal((await modules.get('expo-apple-authentication').signInAsync({ nonce: digest, requestedScopes: [0, 1] })).identityToken, 'apple-token');
  const callback = await modules.get('expo-web-browser').openAuthSessionAsync('https://headless.supabase.co/auth/v1/authorize', 'https://hither-legal.pages.dev/auth/callback?state=original', {});
  assert.equal(new URL(callback.url).searchParams.get('state'), 'original');
  assert.equal(new URL(callback.url).searchParams.get('code'), 'fixture-code');
  fixture.configureNative({ apple: { error: { code: 'ERR_REQUEST_CANCELED', message: 'cancelled' } } });
  await assert.rejects(modules.get('expo-apple-authentication').signInAsync({ nonce: digest, requestedScopes: [0, 1] }), { code: 'ERR_REQUEST_CANCELED' });
  subscription.data.subscription.unsubscribe();
  assert.equal(fixture.inspection().listenerCount, 0);
  backendAuth.removeUser(backend, anonId);
  assert.equal((await auth.getUser()).error.code, 'session_not_found');
  assert.throws(() => auth.unsupportedMethod(), /Unsupported external/);
  assert.equal(fatals.length, 1, 'Unknown SDK access is sticky even if application catches it');
  assert.throws(() => backendAuth.execute(backend, { kind: 'auth', name: 'unknown', args: [], steps: [] }), /Unsupported backend auth/);
  console.log('Auth external boundary selfcheck passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
