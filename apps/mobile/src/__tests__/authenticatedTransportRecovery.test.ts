import { createClient } from '@supabase/supabase-js';
import { createAuthRecovery } from '../api/authRecovery';
import { withAuthenticatedTransport } from '../api/authenticatedTransport';

describe('real PostgREST builder authentication recovery', () => {
  it.each(['read', 'rpc', 'write'])('refreshes %s once with new Authorization while preserving request modifiers', async kind => {
    const requests: { url: string; token: string | null }[] = [];
    const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const token = new Headers(init?.headers).get('Authorization');
      requests.push({ url: String(input), token });
      return new Response(JSON.stringify(token === 'Bearer old'
        ? { code: 'PGRST301', message: 'JWT expired' } : [{ id: 'same' }]), {
        status: token === 'Bearer old' ? 401 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const old = { access_token: 'old', refresh_token: 'refresh-old', user: { id: 'same' } };
    const fresh = { ...old, access_token: 'fresh', refresh_token: 'refresh-fresh' };
    const refresh = jest.fn(async () => ({ data: { session: fresh } }));
    const recovery = createAuthRecovery({ getSession: () => ({ data: { session: old } }), refreshSession: refresh });
    const raw = createClient('https://example.supabase.co', 'publishable-test', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher },
    });
    const client = withAuthenticatedTransport(raw, { authRecovery: recovery });
    const signal = new AbortController().signal;
    const builder = kind === 'rpc' ? client.rpc('get_store_snapshot')
      : kind === 'write' ? client.from('profiles').update({ nickname: 'fresh' }).select('*')
      : client.from('profiles').select('*');
    const result = await builder.eq('id', 'same').order('id').limit(1).abortSignal(signal);
    expect(result.error).toBeNull(); expect(result.data).toEqual([{ id: 'same' }]);
    expect(requests.map(request => request.token)).toEqual(['Bearer old', 'Bearer fresh']);
    expect(requests[0].url).toBe(requests[1].url);
    expect(requests[1].url).toContain('id=eq.same');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[1][1]?.signal).toBe(signal);
  });
  it('does not retry an authorization or business error as token expiry', async () => {
    const refresh = jest.fn();
    const controller = createAuthRecovery({ getSession: () => ({ data: { session: { access_token: 'good', user: { id: 'same' } } } }), refreshSession: refresh });
    const result = await controller.withAuthenticatedOperation(() => ({ error: { status: 403, code: '42501' } }));
    expect(result.error.status).toBe(403); expect(refresh).not.toHaveBeenCalled();
  });
});
