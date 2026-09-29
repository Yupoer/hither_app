import { createClient } from '@supabase/supabase-js';
import { withAuthenticatedTransport } from '../api/authenticatedTransport';
import { withSupabasePerformanceTracing } from '../api/instrumentedSupabase';
import { createAuthRecovery } from '../api/authRecovery';

jest.mock('../state/performance', () => ({ traceApi: (_name: string, work: () => unknown) => work() }));

function setup() {
  const fetch = jest.fn(async () => new Response('[{"id":"g-1"}]', {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  const session = { access_token: 'test-token', user: { id: 'user-1' } };
  const refresh = jest.fn(async () => ({ data: { session }, error: null }));
  const authRecovery = createAuthRecovery({ getSession: async () => ({ data: { session } }), refreshSession: refresh });
  const base = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return { client: withSupabasePerformanceTracing(withAuthenticatedTransport(base, { authRecovery })), fetch, refresh };
}

describe('real PostgREST builders through authenticated + tracing proxies', () => {
  it('awaits reads without proxying native Promises and preserves modifiers', async () => {
    const { client, fetch } = setup();
    const result = await client.from('memberships').select('id').eq('user_id', 'user-1')
      .order('id').limit(1).abortSignal(new AbortController().signal);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: 'g-1' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const single = await client.from('daily_accommodations').select('id').maybeSingle();
    expect(single.error).toBeNull();
    expect(single.data).toEqual({ id: 'g-1' });
  });

  it('preserves read RPCs and authenticated writes', async () => {
    const { client, fetch } = setup();
    expect((await client.rpc('get_group_recovery_snapshot', { p_group_id: 'g-1' })).error).toBeNull();
    expect((await client.from('groups').update({ name: 'Trip' }).eq('id', 'g-1').select()).error).toBeNull();
    expect((await client.rpc('apply_core_operation_v2', {})).error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('recovers an auth failure once and propagates query failures', async () => {
    const { client, fetch, refresh } = setup();
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }), { status: 401 }));
    expect((await client.from('groups').update({ name: 'Trip' })).error).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), { status: 403 }));
    await expect(client.from('memberships').select().throwOnError()).rejects.toMatchObject({ code: '42501' });
  });
});
