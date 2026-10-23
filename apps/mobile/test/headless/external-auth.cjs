const assert = require('node:assert/strict');
const crypto = require('node:crypto');

exports.createExternalAuth = ({ strict, request, spec = {} }) => {
  const listeners = new Set();
  const receipts = [];
  const native = structuredClone(spec.authFixtures ?? {});
  let storage;
  let authKey = 'sb-headless-auth-token';
  let session = null;
  let ready = Promise.resolve();
  let restored = false;
  let autoRefresh = false;
  let write = Promise.resolve();
  const snapshot = value => value == null ? value : structuredClone(value);
  const call = (name, args) => request({ kind: 'auth', name, args, steps: [], userId: session?.user.id ?? null });
  const persist = next => {
    session = snapshot(next);
    const captured = snapshot(next);
    write = write.then(async () => {
      if (captured) await storage.setItem(authKey, JSON.stringify(captured));
      else await storage.removeItem(authKey);
      await storage.setItem(`${authKey}.initialized`, 'true');
    });
    return write;
  };
  async function emit(event, next) {
    await persist(next);
    for (const listener of [...listeners]) listener(event, snapshot(session));
  }
  async function invoke(name, args, event) {
    await ready;
    const actor = session?.user.id;
    const refreshToken = session?.refresh_token;
    const result = await call(name, args);
    if (['refreshSession', 'getUser', 'updateUser', 'linkIdentity'].includes(name)
      && (session?.user.id !== actor || (name === 'refreshSession' && session?.refresh_token !== refreshToken))) return result;
    if (!result.error && result.data) {
      if (name === 'signOut') {
        if (args[0]?.scope !== 'others') await emit('SIGNED_OUT', null);
      } else if (result.data.session) {
        await emit(result.data.redirectType === 'recovery' ? 'PASSWORD_RECOVERY' : event, result.data.session);
      } else if (result.data.user && session?.user.id === result.data.user.id && ['getUser', 'updateUser', 'linkIdentity'].includes(name)) {
        const next = { ...session, user: result.data.user };
        if (name === 'getUser') await persist(next);
        else await emit('USER_UPDATED', next);
      }
    }
    return result;
  }
  function createAuth(options) {
    assert(!storage, 'One auth SDK client per device');
    storage = options.auth.storage;
    assert(storage && ['getItem', 'setItem', 'removeItem'].every(key => typeof storage[key] === 'function'), 'SDK requires actual configured auth storage');
    authKey = options.auth.storageKey ?? authKey;
    const auth = {
      getSession: async () => {
        await ready;
        if (session && session.expires_at <= Math.floor(Date.now() / 1000) + 10) return invoke('refreshSession', [{ refresh_token: session.refresh_token }], 'TOKEN_REFRESHED');
        return { data: { session: snapshot(session) }, error: null };
      },
      getUser: (...args) => invoke('getUser', args),
      refreshSession: async (...args) => { await ready; return invoke('refreshSession', [args[0] ?? { refresh_token: session?.refresh_token }], 'TOKEN_REFRESHED'); },
      onAuthStateChange: callback => {
        assert.equal(typeof callback, 'function'); listeners.add(callback);
        void ready.then(() => { if (listeners.has(callback)) callback('INITIAL_SESSION', snapshot(session)); });
        return { data: { subscription: strict('auth.subscription', { unsubscribe: () => listeners.delete(callback) }) } };
      },
      startAutoRefresh: () => { autoRefresh = true; }, stopAutoRefresh: () => { autoRefresh = false; },
    };
    for (const method of ['signInWithPassword', 'signUp', 'signInAnonymously', 'signInWithIdToken', 'signInWithOAuth',
      'linkIdentity', 'updateUser', 'resetPasswordForEmail', 'resend', 'signOut', 'exchangeCodeForSession']) {
      auth[method] = (...args) => invoke(method, args, 'SIGNED_IN');
    }
    return strict('Supabase.auth', auth);
  }
  async function authenticate(userId) {
    assert(storage, 'createAuth must run before authentication');
    if (userId == null) return persist(null);
    const result = await call('fixtureSession', [userId]);
    assert(!result.error && result.data?.session, `Unknown fixture session ${userId}`);
    await persist(result.data.session);
  }
  function restore(userId) {
    assert(storage, 'createAuth must run before restore');
    assert(!restored, 'Restore is a device boot operation'); restored = true;
    ready = (async () => {
      const stored = await storage.getItem(authKey);
      if (stored) {
        session = JSON.parse(stored);
        assert(typeof session.user?.id === 'string' && typeof session.refresh_token === 'string', 'Invalid persisted auth session');
      } else if (!await storage.getItem(`${authKey}.initialized`)) await authenticate(userId);
    })();
    return ready;
  }
  function configureNative(patch) {
    for (const key of Object.keys(patch)) assert(['google', 'apple', 'browser'].includes(key), `Unknown native auth fixture ${key}`);
    for (const [key, value] of Object.entries(patch)) native[key] = structuredClone(value);
  }
  function nativeResult(kind, args, fallback) {
    receipts.push({ kind, args: snapshot(args) });
    const fixture = native[kind] ?? {};
    if (fixture.error) throw Object.assign(new Error(fixture.error.message ?? `${kind} failed`), fixture.error);
    return snapshot(Object.hasOwn(fixture, 'result') ? fixture.result : fallback);
  }
  function install(jest) {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'headless-web-client';
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'headless-ios-client';
    jest.doMock('expo-crypto', () => strict('expo-crypto', { __esModule: true,
      randomUUID: crypto.randomUUID, CryptoDigestAlgorithm: strict('CryptoDigestAlgorithm', { SHA256: 'SHA-256' }),
      digestStringAsync: async (algorithm, value) => { assert.equal(algorithm, 'SHA-256'); return crypto.createHash('sha256').update(value).digest('hex'); },
    }));
    jest.doMock('@react-native-google-signin/google-signin', () => strict('GoogleSignIn', { __esModule: true,
      statusCodes: strict('GoogleSignIn.statusCodes', { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' }),
      GoogleSignin: strict('GoogleSignin', {
        configure: options => { assert(options.webClientId && options.iosClientId); receipts.push({ kind: 'google.configure', args: snapshot(options) }); },
        signIn: async options => { assert(/^[a-f0-9]{64}$/.test(options?.nonce), 'Google receives SHA256 nonce'); return nativeResult('google', options, { type: 'cancelled' }); },
      }),
    }));
    jest.doMock('expo-apple-authentication', () => strict('AppleAuthentication', { __esModule: true,
      AppleAuthenticationScope: strict('AppleAuthenticationScope', { FULL_NAME: 0, EMAIL: 1 }),
      isAvailableAsync: async () => native.apple?.available !== false,
      signInAsync: async options => {
        assert(/^[a-f0-9]{64}$/.test(options?.nonce), 'Apple receives SHA256 nonce');
        assert.deepEqual(options.requestedScopes, [0, 1]);
        if (!native.apple?.result && !native.apple?.error) throw Object.assign(new Error('User cancelled Apple Sign-In'), { code: 'ERR_REQUEST_CANCELED' });
        return nativeResult('apple', options, null);
      },
    }));
    jest.doMock('expo-web-browser', () => strict('WebBrowser', { __esModule: true,
      maybeCompleteAuthSession: () => ({ type: 'success' }),
      openAuthSessionAsync: async (url, redirectTo, options) => {
        assert.equal(new URL(url).origin, 'https://headless.supabase.co');
        assert.equal(new URL(redirectTo).protocol, 'https:');
        if (native.browser?.code) {
          receipts.push({ kind: 'browser', args: { url, redirectTo, options } });
          const callback = new URL(redirectTo); callback.searchParams.set('code', native.browser.code);
          return { type: 'success', url: callback.href };
        }
        return nativeResult('browser', { url, redirectTo, options }, { type: 'cancel' });
      },
    }));
    jest.doMock('expo-auth-session', () => strict('AuthSession', { __esModule: true,
      makeRedirectUri: options => { assert(options?.scheme === 'hither'); return `hither://${options.path ?? ''}`; },
    }));
  }
  return { createAuth, restore, authenticate, currentSession: () => session, configureNative, install, emit, listeners, receipts,
    inspection: () => ({ session: snapshot(session), autoRefresh, listenerCount: listeners.size }) };
};
