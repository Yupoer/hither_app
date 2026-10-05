import { createClient } from '@supabase/supabase-js';
import { createSupabaseAuthStorage } from '../api/authStorage';
import { createAuthRecovery } from '../api/authRecovery';
import { withRetryableAuthRefresh } from '../api/authRefreshFetch';
import { createSupabaseAuthRecoveryAdapter } from '../api/supabaseAuthRecoveryAdapter';
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
function credential(actor: string, refresh: string) {
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actor, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-signature`;
  return { access_token: token, token_type: 'bearer', refresh_token: refresh, expires_in: 3600,
    user: { id: actor, aud: 'authenticated', email: `${actor}@example.test`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
}
function harness() {
  const disk = new Map<string, string>();
  const secure = { getItemAsync: async (key: string) => disk.get(key) ?? null,
    setItemAsync: jest.fn(async (key: string, value: string) => { disk.set(key, value); }),
    deleteItemAsync: jest.fn(async (key: string) => { disk.delete(key); }) };
  const { storage } = createSupabaseAuthStorage(secure);
  let release!: (response: Response) => void;
  let pending = false;
  let rotationCount = 0;
  const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('grant_type=password')) {
      const actor = JSON.parse(String(init?.body)).email.startsWith('b@') ? 'actor-b' : 'actor-a';
      return new Response(JSON.stringify(credential(actor, `${actor}-refresh`)), { status: 200 });
    }
    if (url.includes('grant_type=refresh_token')) {
      rotationCount += 1; pending = true;
      return new Promise<Response>(resolve => { release = resolve; });
    }
    if (url.includes('/logout')) return new Response(null, { status: 204 });
    throw new Error('Unexpected auth request');
  });
  const client = createClient('https://example.supabase.co', 'publishable-test', {
    auth: { storage, storageKey: 'auth', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: withRetryableAuthRefresh(fetcher) },
  });
  const recovery = createAuthRecovery(createSupabaseAuthRecoveryAdapter(client.auth, storage, 'auth'));
  return { client, storage, secure, recovery, rotating: () => pending, rotations: () => rotationCount,
    finish: (actor = 'actor-a') => release(new Response(JSON.stringify(credential(actor, 'rotated-refresh')), { status: 200 })),
    fail: () => release(new Response(JSON.stringify({ code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid refresh token' }), { status: 400 })),
  };
}
async function waitUntil(predicate: () => boolean) {
  for (let tick = 0; tick < 100 && !predicate(); tick += 1) await Promise.resolve();
  expect(predicate()).toBe(true);
}
describe('actual Supabase SDK refresh concurrency', () => {
  it('rejects account replacement if the old secure slot cannot be retired, without SIGNED_IN for the new actor', async () => {
    const h = harness(); await h.client.auth.signInWithPassword({ email: 'a@example.test', password: 'local-fixture' });
    const signedInActors: string[] = [];
    const { data } = h.client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) signedInActors.push(session.user.id);
    });
    const failure = new Error('old account deletion failed');
    h.secure.deleteItemAsync.mockRejectedValue(failure);
    await expect(h.client.auth.signInWithPassword({ email: 'b@example.test', password: 'local-fixture' })).rejects.toBe(failure);
    expect(signedInActors).not.toContain('actor-b');
    expect((await h.client.auth.getSession()).data.session?.user.id).toBe('actor-a');
    const cold = createSupabaseAuthStorage(h.secure).storage;
    expect(JSON.parse(await cold.getItem('auth') ?? 'null').user.id).toBe('actor-a');
    data.subscription.unsubscribe();
  });
  it('keeps a newly signed-in account in memory after write failure but never cold-restores the previous actor', async () => {
    const h = harness(); await h.client.auth.signInWithPassword({ email: 'a@example.test', password: 'local-fixture' });
    h.secure.setItemAsync.mockRejectedValue(new Error('new account write failed'));
    const result = await h.client.auth.signInWithPassword({ email: 'b@example.test', password: 'local-fixture' });
    expect(result.error).toBeNull();
    expect(result.data.session?.user.id).toBe('actor-b');
    expect((await h.client.auth.getSession()).data.session?.user.id).toBe('actor-b');
    await expect(createSupabaseAuthStorage(h.secure).storage.getItem('auth')).resolves.toBeNull();
  });
  it('SDK refresh and forced foreground restoration share one token rotation', async () => {
    const h = harness(); await h.client.auth.signInWithPassword({ email: 'a@example.test', password: 'local-fixture' });
    const sdk = h.client.auth.refreshSession();
    const foreground = h.recovery.getSession({ forceRefresh: true });
    await waitUntil(h.rotating); h.finish(); await Promise.all([sdk, foreground]);
    expect(h.rotations()).toBe(1);
    expect(JSON.parse(await h.storage.getItem('auth') ?? 'null').refresh_token).toBe('rotated-refresh');
  });
  it('a refresh response completing after explicit logout cannot resurrect credentials or TOKEN_REFRESHED', async () => {
    const h = harness(); await h.client.auth.signInWithPassword({ email: 'a@example.test', password: 'local-fixture' });
    const events: string[] = [];
    const { data } = h.client.auth.onAuthStateChange(event => { events.push(event); });
    const refresh = h.client.auth.refreshSession(); await waitUntil(h.rotating);
    await h.client.auth.signOut({ scope: 'local' }); h.finish(); await refresh;
    expect(await h.storage.getItem('auth')).toBeNull();
    expect(events.slice(events.indexOf('SIGNED_OUT') + 1)).not.toContain('TOKEN_REFRESHED');
    data.subscription.unsubscribe();
  });
  it('a stale terminal refresh failure cannot erase a newer account', async () => {
    const h = harness(); await h.client.auth.signInWithPassword({ email: 'a@example.test', password: 'local-fixture' });
    const terminal = jest.fn(); h.recovery.subscribeTerminal(terminal);
    const refresh = h.recovery.refreshSessionOnce(); await waitUntil(h.rotating);
    await h.client.auth.signOut({ scope: 'local' });
    await h.client.auth.signInWithPassword({ email: 'b@example.test', password: 'local-fixture' });
    h.fail(); await expect(refresh).resolves.toMatchObject({ user: { id: 'actor-b' } });
    expect(JSON.parse(await h.storage.getItem('auth') ?? 'null').user.id).toBe('actor-b');
    expect(terminal).not.toHaveBeenCalled();
  });
});


describe('actual SDK with expired JWT and temporary Auth responses', () => {
  let spy: jest.SpyInstance;
  beforeEach(() => { const original = console.error; spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (args[0] instanceof Error && args[0].message === 'Authentication temporarily unavailable') return;
    original(...args);
  }); });
  afterEach(() => { spy.mockRestore(); });
  it.each([408, 429, 500, 503, 599])('retains expired credentials on temporary %s and uses SDK retry to recover', async status => {
    const old = { ...credential('actor-a', 'old-refresh'), expires_at: Math.floor(Date.now() / 1000) - 1 };
    const disk = new Map([['auth', JSON.stringify(old)]]);
    const { storage } = createSupabaseAuthStorage({ getItemAsync: async key => disk.get(key) ?? null,
      setItemAsync: async (key, value) => { disk.set(key, value); }, deleteItemAsync: async key => { disk.delete(key); } });
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      if (attempts === 1) return new Response(JSON.stringify({ error_code: 'over_request_rate_limit' }), { status });
      return new Response(JSON.stringify(credential('actor-a', 'new-refresh')), { status: 200 });
    };
    const client = createClient('https://example.supabase.co', 'publishable-test', {
      auth: { storage, storageKey: 'auth', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: withRetryableAuthRefresh(fetcher) },
    });
    const events: string[] = [];
    const { data } = client.auth.onAuthStateChange(event => { events.push(event); });
    const recovery = createAuthRecovery(createSupabaseAuthRecoveryAdapter(client.auth, storage, 'auth'));
    const result = await recovery.refreshSessionOnce();
    expect(result.user?.id).toBe('actor-a'); expect(attempts).toBe(2);
    expect(events).not.toContain('SIGNED_OUT');
    expect(JSON.parse(await storage.getItem('auth') ?? 'null').refresh_token).toBe('new-refresh');
    data.subscription.unsubscribe();
  });
});
