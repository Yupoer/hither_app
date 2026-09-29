import {
  classifyOperationError,
  getOperationErrorMessage,
} from '../utils/operationError';
import {
  createAuthRecovery,
  type AuthSessionLike,
} from '../api/authRecovery';
import { withAuthenticatedTransport } from '../api/authenticatedTransport';

const session = (id: string, expiresAt = Math.floor(Date.now() / 1000) + 3_600): AuthSessionLike => ({
  access_token: `access-${id}`,
  refresh_token: `refresh-${id}`,
  expires_at: expiresAt,
  user: { id },
});

describe('classifyOperationError', () => {
  it.each([
    [{ message: 'Network request failed' }, 'offline_transport'],
    [{ code: 'ETIMEDOUT', message: 'request timed out' }, 'timeout_ambiguous_outcome'],
    [{ status: 504, message: 'gateway timeout' }, 'timeout_ambiguous_outcome'],
    [{ code: '28000', message: 'not authenticated' }, 'session_missing_or_expired'],
    [{ code: '42501', message: 'leader membership required' }, 'leader_role_rejected'],
    [{ code: '42501', message: 'permission denied' }, 'acl_service_access'],
    [{ status: 429, code: 'too_many_requests', message: 'slow down' }, 'rate_limited'],
    [{ status: 503, message: 'upstream unavailable' }, 'service_unavailable'],
    [{ code: '40001', message: 'could not serialize access' }, 'server_busy'],
    [{ code: '40P01', message: 'deadlock detected' }, 'server_busy'],
    ['could not serialize access due to concurrent update', 'server_busy'],
    [{ code: 'stale_version', message: 'stale version' }, 'version_conflict'],
    [{ code: 'invalid_transition', message: 'arrival session is no longer active' }, 'state_conflict'],
    [{ code: 'dependency_missing', message: 'prerequisite was not accepted' }, 'state_conflict'],
    [{ code: 'local_auth_actor_missing', message: 'Local auth actor is unavailable' }, 'session_missing_or_expired'],
    [{ code: '22023', message: 'invalid itinerary coordinates' }, 'validation'],
    [{ status: 429, code: 'quota_exceeded', message: 'quota exceeded' }, 'quota'],
    [{ code: 'ERR_KEY_CHAIN', message: 'keychain entitlement missing' }, 'storage'],
  ] as const)('maps %p to %s', (error, kind) => {
    expect(classifyOperationError(error).kind).toBe(kind);
  });

  it('supports object-shaped errors and preserves status, code, and cause', () => {
    const cause = {
      status: 403,
      code: '42501',
      message: 'permission denied for function apply_core_operation',
      details: 'service access boundary',
    };
    expect(classifyOperationError(cause)).toMatchObject({
      kind: 'acl_service_access',
      status: 403,
      code: '42501',
      cause,
    });
  });

  it('does not infer leader rejection from SQLSTATE 42501 alone', () => {
    expect(classifyOperationError({ code: '42501', message: 'permission denied' }).kind).toBe(
      'acl_service_access',
    );
  });

  it('maps all supported locales without exposing provider error text', () => {
    const error = { code: '42501', message: 'permission denied Bearer secret-token' };
    expect(getOperationErrorMessage(error, 'zh')).toContain('存取');
    expect(getOperationErrorMessage(error, 'en')).toContain('access');
    expect(getOperationErrorMessage({ message: 'leader membership required' }, 'en')).toContain(
      'group leader',
    );
  });
});

describe('auth recovery single-flight and guarded transport', () => {
  it('shares one refresh promise across concurrent expired-session callers', async () => {
    let refreshCalls = 0;
    let release!: (value: AuthSessionLike) => void;
    const refresh = new Promise<AuthSessionLike>((resolve) => { release = resolve; });
    const controller = createAuthRecovery({
      getSession: async () => ({ data: { session: session('old', 1) }, error: null }),
      refreshSession: async () => {
        refreshCalls += 1;
        return { data: { session: await refresh }, error: null };
      },
    }, { now: () => 10_000 });

    const first = controller.getSession();
    const second = controller.getSession();
    await Promise.resolve();
    expect(refreshCalls).toBe(1);
    release(session('new'));
    await expect(Promise.all([first, second])).resolves.toEqual([session('new'), session('new')]);
  });

  it('does not invoke a mutation when the session is missing', async () => {
    const send = jest.fn(async () => ({ data: null, error: null }));
    const builder: any = {
      then: (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => send().then(resolve, reject),
    };
    const rpc = jest.fn(() => builder);
    const controller = createAuthRecovery({
      getSession: async () => ({ data: { session: null }, error: null }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    });
    const client = withAuthenticatedTransport(
      { rpc } as any,
      { authRecovery: controller },
    );

    await expect(client.rpc('apply_core_operation', {})).rejects.toMatchObject({
      code: 'session_missing_or_expired',
    });
    // Calling rpc() only constructs the lazy PostgREST builder; no request
    // reaches the network before the auth gate runs.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('recovers one auth response and retries the operation once', async () => {
    let attempts = 0;
    let refreshCalls = 0;
    const controller = createAuthRecovery({
      getSession: async () => ({ data: { session: session('old') }, error: null }),
      refreshSession: async () => {
        refreshCalls += 1;
        return { data: { session: session('new') }, error: null };
      },
    });

    const result = await controller.withAuthenticatedOperation(
      async () => {
        attempts += 1;
        return attempts === 1
          ? { data: null, error: { status: 401, code: 'PGRST301', message: 'jwt expired' } }
          : { data: 'ok', error: null };
      },
      { operation: 'test.mutation', mutation: true },
    );

    expect(result).toEqual({ data: 'ok', error: null });
    expect(attempts).toBe(2);
    expect(refreshCalls).toBe(1);
  });

  it('keeps an offline refresh failure typed and avoids mutation dispatch', async () => {
    const work = jest.fn();
    const controller = createAuthRecovery({
      getSession: async () => ({ data: { session: session('expired', 1) }, error: null }),
      refreshSession: async () => ({
        data: { session: null },
        error: { status: 0, code: 'network', message: 'Network request failed' },
      }),
    }, { now: () => 10_000 });

    await expect(
      controller.withAuthenticatedOperation(work, { mutation: true }),
    ).rejects.toMatchObject({ code: 'network' });
    expect(work).not.toHaveBeenCalled();
  });

  it('guards table mutations before the builder sends a request', async () => {
    const send = jest.fn(async () => ({ data: null, error: null }));
    const builder: any = {};
    builder.update = jest.fn(() => builder);
    builder.eq = jest.fn(() => builder);
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => send().then(resolve, reject);
    const controller = createAuthRecovery({
      getSession: async () => ({ data: { session: null }, error: null }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    });
    const client = withAuthenticatedTransport(
      { from: jest.fn(() => builder) } as any,
      { authRecovery: controller },
    );

    await expect(client.from('itinerary_items').update({ title: 'x' }).eq('id', 'd1'))
      .rejects.toMatchObject({ code: 'session_missing_or_expired' });
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves lazy RPC chains and retries one auth response after refresh', async () => {
    const outcomes = [
      { data: null, error: { status: 401, code: 'PGRST301', message: 'jwt expired' } },
      { data: { accepted: true }, error: null },
    ];
    const send = jest.fn(() => Promise.resolve(outcomes.shift()));
    const builder: any = {};
    for (const method of ['abortSignal', 'select', 'single', 'maybeSingle', 'throwOnError']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => send().then(resolve, reject);
    const rpc = jest.fn(() => builder);
    let refreshCalls = 0;
    const controller = createAuthRecovery({
      getSession: async () => ({ data: { session: session('current') }, error: null }),
      refreshSession: async () => {
        refreshCalls += 1;
        return { data: { session: session('refreshed') }, error: null };
      },
    });
    const client = withAuthenticatedTransport(
      { rpc } as any,
      { authRecovery: controller },
    );
    const abortSignal = {} as AbortSignal;

    const request = client
      .rpc('ingest_location_batch', { p_events: [] })
      .abortSignal(abortSignal)
      .select('*')
      .maybeSingle()
      .throwOnError();

    expect(rpc).toHaveBeenCalledWith('ingest_location_batch', { p_events: [] });
    expect(send).not.toHaveBeenCalled();
    await expect(request).resolves.toEqual({ data: { accepted: true }, error: null });
    expect(send).toHaveBeenCalledTimes(2);
    expect(refreshCalls).toBe(1);
    expect(builder.abortSignal).toHaveBeenCalledWith(abortSignal);
    expect(builder.select).toHaveBeenCalledWith('*');
    expect(builder.maybeSingle).toHaveBeenCalledTimes(1);
    expect(builder.throwOnError).toHaveBeenCalledTimes(1);
  });
});
