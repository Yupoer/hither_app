const mockStore = new Map<string, string>();
const mockExchange = jest.fn();
const mockRevoke = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => 'random-state' }));
jest.mock('../api/authStorage', () => ({ supabaseAuthStorage: {
  getItem: async (key: string) => mockStore.get(key) ?? null,
  setItem: async (key: string, value: string) => { mockStore.set(key, value); },
  removeItem: async (key: string) => { mockStore.delete(key); },
} }));
jest.mock('../api/supabase', () => ({ supabase: { auth: { exchangeCodeForSession: (...args: unknown[]) => mockExchange(...args) } } }));
jest.mock('../api/installationCapabilities', () => ({
  changeAuthSession: async (operation: () => Promise<unknown>, revoke: boolean) => {
    if (revoke) await mockRevoke();
    return operation();
  }, resumeInstallationCapabilities: jest.fn(),
}));
import { beginAuthCallback, cancelAuthCallback, consumeAuthCallback, validateAuthCallback } from '../auth/callbacks';

describe('HTTPS PKCE auth callbacks', () => {
  beforeEach(async () => {
    process.env.EXPO_PUBLIC_AUTH_CALLBACK_ORIGIN = 'https://auth.example.test';
    await cancelAuthCallback();
    jest.clearAllMocks();
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
  it.each(['oauth', 'link', 'signup'] as const)('preserves normal %s callback behavior', async kind => {
    const callback = await beginAuthCallback(kind);
    const result = await consumeAuthCallback(callback + '&code=code');
    expect(result?.user.id).toBe('user');
    expect(result?.recovery).toBe(false);
    expect(mockRevoke).toHaveBeenCalledTimes(kind === 'link' ? 0 : 1);
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
