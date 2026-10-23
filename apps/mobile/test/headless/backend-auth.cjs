const assert = require('node:assert/strict');

const clone = value => structuredClone(value);
const ok = data => ({ data: clone(data), error: null });
const fail = (message, code = 'invalid_credentials', status = 400) => ({ data: null, error: { message, code, status } });
const providerIdentity = (id, provider, email) => ({ id: `${id}:${provider}`, user_id: id, provider, identity_data: { sub: id, ...(email ? { email } : {}) } });
const methods = ['fixtureSession', 'getUser', 'refreshSession', 'signInWithPassword', 'signUp', 'signInAnonymously', 'signInWithIdToken',
  'signInWithOAuth', 'linkIdentity', 'updateUser', 'resetPasswordForEmail', 'resend', 'signOut', 'exchangeCodeForSession'];

function putAccount(b, account) {
  assert(typeof account.id === 'string' && account.id, 'Auth fixture id required');
  const provider = account.provider ?? (account.is_anonymous ? 'anonymous' : 'email');
  const user = { id: account.id, email: account.email ?? '', is_anonymous: Boolean(account.is_anonymous),
    app_metadata: { provider, providers: provider === 'anonymous' ? [] : [provider] },
    user_metadata: clone(account.user_metadata ?? {}),
    identities: clone(account.identities ?? (provider === 'anonymous' ? [] : [providerIdentity(account.id, provider, account.email)])),
    created_at: new Date(b.now).toISOString() };
  b.authUsers.set(user.id, user);
  b.authAccounts.set(user.id, { password: account.password ?? null, confirmed: account.confirmed !== false });
  return user;
}

exports.initialize = (b, { LEADER, PEER }) => {
  b.authUsers = new Map(); b.authAccounts = new Map(); b.authCodes = new Map(); b.authTokens = new Map();
  b.authIdTokens = new Map(); b.authErrors = {}; b.authResponses = {}; b.authSequence = 0; b.authSignupConfirmation = false; b.authEmailConfirmation = false;
  putAccount(b, { id: LEADER, email: 'leader@headless.test', password: 'Headless123!' });
  putAccount(b, { id: PEER, email: 'peer@headless.test', password: 'Headless123!' });
};

exports.configure = (b, fixtures) => {
  assert(fixtures && typeof fixtures === 'object');
  for (const key of Object.keys(fixtures)) assert(['accounts', 'codes', 'idTokens', 'errors', 'responses', 'signUpConfirmation', 'emailConfirmation'].includes(key), `Unknown auth fixture ${key}`);
  for (const account of fixtures.accounts ?? []) putAccount(b, account);
  for (const fixture of fixtures.codes ?? []) {
    assert(['signin', 'recovery', 'link', 'signup'].includes(fixture.type));
    assert(b.authUsers.has(fixture.userId), 'Code fixture requires known user');
    b.authCodes.set(fixture.code, clone(fixture));
  }
  for (const fixture of fixtures.idTokens ?? []) {
    assert(['google', 'apple'].includes(fixture.provider));
    assert(b.authUsers.has(fixture.userId), 'ID token fixture requires known user');
    b.authIdTokens.set(fixture.token, clone(fixture));
  }
  for (const key of ['errors', 'responses']) if (fixtures[key]) {
    for (const method of Object.keys(fixtures[key])) assert(methods.includes(method), `Unsupported auth fixture method ${method}`);
    b[key === 'errors' ? 'authErrors' : 'authResponses'] = clone(fixtures[key]);
  }
  if ('signUpConfirmation' in fixtures) b.authSignupConfirmation = fixtures.signUpConfirmation;
  if ('emailConfirmation' in fixtures) b.authEmailConfirmation = fixtures.emailConfirmation;
};

exports.removeUser = (b, userId) => {
  b.authUsers.delete(userId); b.authAccounts.delete(userId);
  for (const [key, value] of b.authTokens) if (value === userId) b.authTokens.delete(key);
  for (const collection of [b.authCodes, b.authIdTokens]) for (const [key, value] of collection) if (value.userId === userId) collection.delete(key);
};

function sessionFor(b, user) {
  const refresh = `refresh-${user.id}-${++b.authSequence}`;
  b.authTokens.set(refresh, user.id);
  return { access_token: `fixture-${user.id}-${b.authSequence}`, refresh_token: refresh, token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(b.now / 1000) + 3600, user: clone(user) };
}
function attachProvider(user, provider) {
  user.is_anonymous = false;
  user.app_metadata.provider = provider;
  if (!user.app_metadata.providers.includes(provider)) user.app_metadata.providers.push(provider);
  if (!user.identities.some(identity => identity.provider === provider)) user.identities.push(providerIdentity(user.id, provider, user.email));
}

exports.execute = (b, operation) => {
  if (operation.kind !== 'auth') return undefined;
  const { name, args = [], userId, steps } = operation;
  assert.deepEqual(steps, [], 'Auth operations cannot use query builder steps');
  assert(Array.isArray(args), 'Auth arguments must be positional');
  assert(methods.includes(name), `Unsupported backend auth.${name}`);
  if (b.authErrors[name]) return { data: null, error: clone(b.authErrors[name]) };
  if (Object.hasOwn(b.authResponses, name)) return clone(b.authResponses[name]);
  const input = args[0];
  const current = b.authUsers.get(userId);
  const accountByEmail = email => [...b.authUsers.values()].find(user => user.email.toLowerCase() === String(email).toLowerCase());
  const signedIn = user => ok({ user, session: sessionFor(b, user) });
  if (name === 'fixtureSession') {
    assert(b.authUsers.has(input), `Unknown seeded auth user ${input}`);
    return signedIn(b.authUsers.get(input));
  }
  if (name === 'getUser') return current ? ok({ user: current }) : fail('Auth session missing!', 'session_not_found', 401);
  if (name === 'signOut') {
    assert(!input || !input.scope || ['local', 'global', 'others'].includes(input.scope));
    return ok({});
  }
  if (name === 'refreshSession') {
    const token = input?.refresh_token;
    const id = b.authTokens.get(token);
    if (!id || !b.authUsers.has(id)) return fail('Invalid Refresh Token: Refresh Token Not Found', 'refresh_token_not_found');
    b.authTokens.delete(token);
    return signedIn(b.authUsers.get(id));
  }
  if (name === 'signInWithPassword') {
    assert(typeof input?.email === 'string' && typeof input.password === 'string');
    const user = accountByEmail(input.email);
    if (!user || b.authAccounts.get(user.id).password !== input.password) return fail('Invalid login credentials');
    if (!b.authAccounts.get(user.id).confirmed) return fail('Email not confirmed', 'email_not_confirmed');
    return signedIn(user);
  }
  if (name === 'signUp') {
    assert(typeof input?.email === 'string' && typeof input.password === 'string');
    const duplicate = accountByEmail(input.email);
    if (duplicate) return ok({ user: { ...duplicate, identities: [] }, session: null });
    const id = `cccccccc-cccc-4ccc-8ccc-${String(++b.authSequence).padStart(12, '0')}`;
    const user = putAccount(b, { id, email: input.email, password: input.password, confirmed: b.authSignupConfirmation });
    return b.authSignupConfirmation ? signedIn(user) : ok({ user, session: null });
  }
  if (name === 'signInAnonymously') {
    const id = `eeeeeeee-eeee-4eee-8eee-${String(++b.authSequence).padStart(12, '0')}`;
    return signedIn(putAccount(b, { id, is_anonymous: true }));
  }
  if (name === 'signInWithOAuth' || (name === 'linkIdentity' && input?.options)) {
    assert(['google', 'apple'].includes(input?.provider), 'Unsupported OAuth provider');
    if (name === 'linkIdentity' && !current) return fail('Auth session missing!', 'session_not_found', 401);
    const redirect = new URL(input.options.redirectTo);
    assert.equal(redirect.protocol, 'https:');
    return ok({ provider: input.provider, url: `https://headless.supabase.co/auth/v1/authorize?provider=${input.provider}&redirect_to=${encodeURIComponent(redirect.href)}` });
  }
  if (name === 'signInWithIdToken' || name === 'linkIdentity') {
    assert(['google', 'apple'].includes(input?.provider), 'Unsupported identity provider');
    const fixture = b.authIdTokens.get(input.token);
    if (!fixture || fixture.provider !== input.provider) return fail('Invalid ID token', 'bad_jwt');
    if (fixture.nonce && fixture.nonce !== input.nonce) return fail('Nonce mismatch', 'bad_jwt');
    if (name === 'linkIdentity') {
      if (!current) return fail('Auth session missing!', 'session_not_found', 401);
      if (fixture.userId !== current.id) return fail('Identity is already linked to another user', 'identity_already_exists');
      attachProvider(current, input.provider);
      return ok({ user: current });
    }
    return signedIn(b.authUsers.get(fixture.userId));
  }
  if (name === 'exchangeCodeForSession') {
    const fixture = b.authCodes.get(input);
    if (!fixture) return fail('Invalid authorization code', 'flow_state_not_found');
    b.authCodes.delete(input);
    const user = b.authUsers.get(fixture.userId);
    if (!user) return fail('User not found', 'user_not_found');
    if (fixture.type === 'link') {
      if (!current || current.id !== user.id) return fail('Identity belongs to another user', 'identity_already_exists');
      attachProvider(user, fixture.provider ?? 'google');
    }
    if (fixture.type === 'signup') b.authAccounts.get(user.id).confirmed = true;
    return ok({ user, session: sessionFor(b, user), redirectType: fixture.type === 'recovery' ? 'recovery' : null });
  }
  if (name === 'updateUser') {
    if (!current) return fail('Auth session missing!', 'session_not_found', 401);
    assert(input && Object.keys(input).every(key => ['email', 'password', 'data'].includes(key)), 'Unknown user update');
    if (input.email) {
      const duplicate = accountByEmail(input.email);
      if (duplicate && duplicate.id !== current.id) return fail('A user with this email address has already been registered', 'email_exists');
      current.email = input.email;
      if (b.authEmailConfirmation) attachProvider(current, 'email');
      b.authAccounts.get(current.id).confirmed = b.authEmailConfirmation;
    }
    if (input.password) b.authAccounts.get(current.id).password = input.password;
    if (input.data) Object.assign(current.user_metadata, clone(input.data));
    return ok({ user: current });
  }
  if (name === 'resetPasswordForEmail') {
    assert(typeof input === 'string' && typeof args[1]?.redirectTo === 'string');
    return ok({});
  }
  assert.equal(name, 'resend');
  assert.equal(input?.type, 'signup'); assert.equal(typeof input.email, 'string');
  return ok({ user: null, session: null });
};
