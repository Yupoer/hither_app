const mockStore = new Map<string, string>();
const mockExchange = jest.fn();
const mockRevoke = jest.fn();
let mockActor: string | null;
jest.mock('expo-crypto', () => ({ randomUUID: () => 'random-state' }));
jest.mock('../api/authStorage', () => ({ supabaseAuthStorage: {
  getItem: async (key: string) => mockStore.get(key) ?? null,
  setItem: async (key: string, value: string) => { mockStore.set(key, value); },
  removeItem: async (key: string) => { mockStore.delete(key); },
} }));
jest.mock('../api/supabase', () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: mockActor ? { user: { id: mockActor } } : null }, error: null }),
  exchangeCodeForSession: (...args: unknown[]) => mockExchange(...args),
} } }));
jest.mock('../api/installationCapabilities', () => {
  const actual = jest.requireActual('../api/installationCapabilities');
  return {
    ...actual,
    changeAuthSession: (operation: () => Promise<unknown>, revoke = true) => actual.changeAuthSession(async () => {
      if (revoke) await mockRevoke();
      return operation();
    }, false),
  };
});
import { changeAuthSession } from '../api/installationCapabilities';
import { beginAuthCallback, cancelAuthCallback, consumeAuthCallback, validateAuthCallback } from '../auth/callbacks';

describe('HTTPS PKCE auth callbacks', () => {
  beforeEach(async () => {
    process.env.EXPO_PUBLIC_AUTH_CALLBACK_ORIGIN = 'https://auth.example.test';
    await cancelAuthCallback();
    jest.clearAllMocks();
    mockActor = 'user';
    mockExchange.mockResolvedValue({ data: { user: { id: 'user' }, session: {} }, error: null });
  });
  it('accepts a locally initiated recovery and exchanges its code only once', async () => {
    const callback = await beginAuthCallback('recovery');
    const result = await consumeAuthCallback(callback + '&code=pkce-code');
    expect(result?.recovery).toBe(true);
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockExchange).toHaveBeenCalledWith('pkce-code');
    expect(await consumeAuthCallback(callback + '&code=pkce-code')).toBeNull();
    expect(mockExchange).toHaveBeenCalledTimes(1);
  });
  it.each(['oauth', 'signup'] as const)('preserves normal %s callback behavior', async kind => {
    const callback = await beginAuthCallback(kind);
    const result = await consumeAuthCallback(callback + '&code=code');
    expect(result?.user.id).toBe('user');
    expect(result?.recovery).toBe(false);
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });
  it('exchanges a link for the initiating actor without revoking its installation', async () => {
    const callback = await beginAuthCallback('link', 'user');
    const result = await consumeAuthCallback(callback + '&code=code');
    expect(result?.user.id).toBe('user');
    expect(result?.recovery).toBe(false);
    expect(mockRevoke).not.toHaveBeenCalled();
  });
  it('rejects a link after a queued actor switch before the SDK exchanges the code', async () => {
    const callback = await beginAuthCallback('link', 'user');
    let releaseSwitch!: () => void;
    const switchReady = new Promise<void>(resolve => { releaseSwitch = resolve; });
    const switching = changeAuthSession(async () => {
      await switchReady;
      mockActor = 'replacement';
    }, false);

    const url = callback + '&code=code';
    const delivery = consumeAuthCallback(url);
    expect(consumeAuthCallback(url)).toBe(delivery);
    const rejected = expect(delivery).rejects.toMatchObject({ code: 'auth_actor_changed' });
    await new Promise<void>(resolve => setImmediate(resolve));
    const exchangedBeforeSwitch = mockExchange.mock.calls.length;
    releaseSwitch();
    await switching;
    await rejected;

    expect(exchangedBeforeSwitch).toBe(0);
    expect(mockExchange).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    mockActor = 'user';
    await expect(consumeAuthCallback(url)).resolves.toBeNull();
  });
  it('rejects an unbound stored link from an earlier app version', async () => {
    mockStore.set('hither.auth-pending-transaction', JSON.stringify({
      kind: 'link', state: 'legacy', expiresAt: Date.now() + 1000,
    }));
    await expect(consumeAuthCallback('https://auth.example.test/auth/callback?state=legacy&code=code')).resolves.toBeNull();
    expect(mockExchange).not.toHaveBeenCalled();
  });
  it('rejects unsolicited links and arbitrary bearer injection without an exchange', async () => {
    expect(await consumeAuthCallback('hither://auth/callback#access_token=attacker&refresh_token=attacker')).toBeNull();
    const callback = await beginAuthCallback('recovery');
    for (const url of [callback + '#access_token=attacker', callback + '&code=a&access_token=b',
      callback.replace('/recovery', '/callback') + '&code=a', callback.replace('random-state', 'foreign') + '&code=a',
      callback.replace('auth.example.test', 'evil.test') + '&code=a', callback + '&state=second&code=a']) {
      expect(await consumeAuthCallback(url)).toBeNull();
    }
    expect(mockExchange).not.toHaveBeenCalled();
    expect((await consumeAuthCallback(callback + '&code=legitimate'))?.recovery).toBe(true);
  });
  it('rejects expired state, lookalike paths, userinfo and duplicate codes', () => {
    const pending = { state: 's', kind: 'oauth' as const, expiresAt: Date.now() + 1000 };
    for (const url of ['https://auth.example.test/auth/callback/extra?state=s&code=c',
      'https://evil@auth.example.test/auth/callback?state=s&code=c',
      'https://auth.example.test/auth/callback?state=s&code=c&code=d']) {
      expect(validateAuthCallback(url, pending, 'https://auth.example.test')).toBeNull();
    }
    expect(validateAuthCallback('https://auth.example.test/auth/callback?state=s&code=c',
      { ...pending, expiresAt: 0 }, 'https://auth.example.test')).toBeNull();
  });
  it('deduplicates simultaneous browser and Linking delivery', async () => {
    const callback = await beginAuthCallback('oauth');
    const first = consumeAuthCallback(callback + '&code=code');
    const second = consumeAuthCallback(callback + '&code=code');
    expect(first).toBe(second);
    await first;
    expect(mockExchange).toHaveBeenCalledTimes(1);
  });
});
