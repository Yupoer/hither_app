// Behavioral coverage for the shared recovery controller.
import {
  __resetDefaultAuthRecoveryForTests,
  configureDefaultAuthRecovery,
  createAuthRecovery,
  getDefaultAuthRecovery,
  type AuthAdapterResult,
  type AuthSessionLike,
} from '../api/authRecovery';

const makeSession = (id = 'user-1', expiresAt?: number): AuthSessionLike => ({
  access_token: `access-${id}`,
  refresh_token: `refresh-${id}`,
  expires_at: expiresAt,
  user: { id },
});

const adapterFor = (getSession: () => AuthAdapterResult | Promise<AuthAdapterResult>, refreshSession = getSession) => ({
  getSession,
  refreshSession,
});

afterEach(() => {
  __resetDefaultAuthRecoveryForTests();
});

describe('auth recovery controller behavior', () => {
  it('returns a healthy local session without refreshing and force-refreshes on request', async () => {
    const getSession = jest.fn(() => ({ data: { session: makeSession() }, error: null }));
    const refreshSession = jest.fn(() => ({ data: { session: makeSession('refreshed') }, error: null }));
    const controller = createAuthRecovery(adapterFor(getSession, refreshSession), { now: () => 1_000_000 });

    await expect(controller.getSession()).resolves.toEqual(makeSession());
    await expect(controller.getSession({ forceRefresh: true })).resolves.toEqual(makeSession('refreshed'));
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('refreshes expiring sessions and returns null for a signed-out session', async () => {
    const refreshSession = jest.fn(() => ({ data: { session: makeSession('new') }, error: null }));
    const expiring = createAuthRecovery(adapterFor(
      () => ({ data: { session: makeSession('old', 1_000_025) }, error: null }),
      refreshSession,
    ), { now: () => 1_000_000_000 });
    await expect(expiring.refreshIfExpiring()).resolves.toEqual(makeSession('new'));
    expect(refreshSession).toHaveBeenCalledTimes(1);

    const signedOut = createAuthRecovery(adapterFor(() => ({ data: { session: null }, error: null })));
    await expect(signedOut.refreshIfExpiring()).resolves.toBeNull();
  });

  it('propagates storage/network read errors but refreshes typed auth-missing errors', async () => {
    const storageFailure = Object.assign(new Error('keychain unavailable'), { code: 'ERR_KEY_CHAIN' });
    const storage = createAuthRecovery(adapterFor(() => { throw storageFailure; }, () => ({ data: { session: makeSession('new') }, error: null })));
    await expect(storage.getSession()).rejects.toBe(storageFailure);

    const authFailure = Object.assign(new Error('jwt expired'), { code: 'PGRST301', status: 401 });
    const refresh = jest.fn(() => ({ data: { session: makeSession('new') }, error: null }));
    const expired = createAuthRecovery(adapterFor(() => { throw authFailure; }, refresh));
    await expect(expired.getSession()).resolves.toEqual(makeSession('new'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('rejects non-auth adapter results and refreshes unknown/session-missing results', async () => {
    const serviceError = { status: 503, code: 'upstream', message: 'unavailable' };
    const service = createAuthRecovery(adapterFor(
      () => ({ data: { session: null }, error: serviceError }),
      () => ({ data: { session: makeSession('unexpected') }, error: null }),
    ));
    await expect(service.getSession()).rejects.toBe(serviceError);

    const refresh = jest.fn(() => ({ data: { session: makeSession('recovered') }, error: null }));
    const unknown = createAuthRecovery(adapterFor(
      () => ({ data: { session: null }, error: { message: 'unclassified auth response' } }),
      refresh,
    ));
    await expect(unknown.getSession()).resolves.toEqual(makeSession('recovered'));

    const empty = createAuthRecovery(adapterFor(
      () => ({ data: null, error: null }),
      refresh,
    ));
    await expect(empty.getSession()).resolves.toEqual(makeSession('recovered'));
  });

  it('treats a missing local actor as recoverable session state, not as an anon mutation path', async () => {
    const refresh = jest.fn(() => ({ data: { session: makeSession('recovered') }, error: null }));
    const controller = createAuthRecovery(adapterFor(
      () => ({ data: { session: null }, error: { code: 'local_auth_actor_missing', message: 'Local auth actor is unavailable' } }),
      refresh,
    ));

    await expect(controller.getSession()).resolves.toEqual(makeSession('recovered'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('preserves refresh errors, missing refreshed sessions, and adapter result errors', async () => {
    const thrown = { code: 'network', message: 'Network request failed' };
    const failedRefresh = createAuthRecovery(adapterFor(
      () => ({ data: { session: makeSession('expired', 1) }, error: null }),
      () => { throw thrown; },
    ), { now: () => 100 });
    await expect(failedRefresh.getSession()).rejects.toBe(thrown);

    const noSession = createAuthRecovery(adapterFor(
      () => ({ data: { session: null }, error: null }),
      () => ({ data: { session: null }, error: null }),
    ));
    await expect(noSession.refreshSessionOnce()).rejects.toMatchObject({ code: 'session_missing_or_expired', status: 401 });

    const refreshResultError = { code: 'PGRST301', message: 'refresh token invalid' };
    const resultFailure = createAuthRecovery(adapterFor(
      () => ({ data: { session: null }, error: null }),
      () => ({ data: { session: null }, error: refreshResultError }),
    ));
    await expect(resultFailure.refreshSessionOnce()).rejects.toBe(refreshResultError);

    const getError = { status: 500, message: 'read failed' };
    const refreshIfError = createAuthRecovery(adapterFor(() => ({ data: null, error: getError })));
    await expect(refreshIfError.refreshIfExpiring()).rejects.toBe(getError);
  });

  it('recovers thrown auth failures once and honors recoverOnce false', async () => {
    let refreshCalls = 0;
    let attempts = 0;
    const controller = createAuthRecovery(adapterFor(
      () => ({ data: { session: makeSession('old') }, error: null }),
      () => {
        refreshCalls += 1;
        return { data: { session: { ...makeSession('old'), access_token: 'access-new' } }, error: null };
      },
    ));
    const authFailure = Object.assign(new Error('expired'), { code: 'PGRST301', status: 401 });
    await expect(controller.withAuthenticatedOperation(async (current) => {
      attempts += 1;
      if (attempts === 1) throw authFailure;
      return current.user?.id;
    })).resolves.toBe('old');
    expect(attempts).toBe(2);
    expect(refreshCalls).toBe(1);

    const noRecovery = createAuthRecovery(adapterFor(() => ({ data: { session: makeSession() }, error: null })));
    const operationFailure = Object.assign(new Error('invalid transition'), { code: 'stale_version' });
    await expect(noRecovery.withAuthenticatedOperation(() => { throw operationFailure; }, { recoverOnce: false }))
      .rejects.toBe(operationFailure);
  });

  it('returns non-auth operation errors as results and retries auth-shaped result errors once', async () => {
    const controller = createAuthRecovery(adapterFor(
      () => ({ data: { session: makeSession('old') }, error: null }),
      () => ({ data: { session: { ...makeSession('old'), access_token: 'access-new' } }, error: null }),
    ));
    const result = await controller.withAuthenticatedOperation(() => ({
      data: null,
      error: { status: 503, code: 'upstream', message: 'down' },
    }));
    expect(result).toMatchObject({ error: { code: 'upstream' } });

    let calls = 0;
    await expect(controller.withAuthenticatedOperation(() => {
      calls += 1;
      return calls === 1
        ? { data: null, error: { status: 401, code: 'PGRST301', message: 'expired' } }
        : { data: 'ok', error: null };
    })).resolves.toEqual({ data: 'ok', error: null });
    expect(calls).toBe(2);
  });
});

describe('default auth recovery registration', () => {
  it('configures, returns, and resets the singleton controller', async () => {
    expect(() => getDefaultAuthRecovery()).toThrow('not been configured');
    const controller = configureDefaultAuthRecovery(adapterFor(() => ({ data: { session: makeSession() }, error: null })));
    expect(getDefaultAuthRecovery()).toBe(controller);
    await expect(getDefaultAuthRecovery().getSession()).resolves.toMatchObject({ access_token: 'access-user-1' });
    __resetDefaultAuthRecoveryForTests();
    expect(() => getDefaultAuthRecovery()).toThrow('not been configured');
  });
});


describe('foreground and terminal session policy', () => {
  it('coalesces forced foreground updates without first triggering SDK implicit refresh', async () => {
    const old = makeSession('same', 9999999999); const fresh = { ...old, access_token: 'rotated' };
    let release!: () => void;
    const refresh = jest.fn(async () => { await new Promise<void>(resolve => { release = resolve; }); return { data: { session: fresh } }; });
    const get = jest.fn(() => ({ data: { session: old } }));
    const controller = createAuthRecovery({ getSession: get, getLocalSession: get, refreshSession: refresh });
    const first = controller.getSession({ forceRefresh: true });
    const second = controller.getSession({ forceRefresh: true });
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    release(); await expect(Promise.all([first, second])).resolves.toEqual([fresh, fresh]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it.each(['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired'])('only confirmed %s rejection invalidates and notifies the foreground', async code => {
    const invalidate = jest.fn(); const listener = jest.fn(); const session = makeSession('same');
    const controller = createAuthRecovery({ getSession: () => ({ data: { session } }),
      getLocalSession: () => ({ data: { session } }),
      refreshSession: () => ({ error: { code, status: 400 }, data: { session: null } }), invalidateSession: invalidate });
    controller.subscribeTerminal(listener);
    await expect(controller.refreshSessionOnce()).rejects.toMatchObject({ code });
    expect(invalidate).toHaveBeenCalledTimes(1); expect(listener).toHaveBeenCalledTimes(1);
  });
  it.each([0, 429, 503])('preserves identity and credentials through a temporary %s failure', async status => {
    const invalidate = jest.fn(); const listener = jest.fn(); const session = makeSession('same');
    const controller = createAuthRecovery({ getSession: () => ({ data: { session } }),
      getLocalSession: () => ({ data: { session } }), refreshSession: () => ({ error: { status, message: 'temporary outage' } }), invalidateSession: invalidate });
    controller.subscribeTerminal(listener);
    await expect(controller.refreshSessionOnce()).rejects.toMatchObject({ status });
    await expect(controller.getLocalSession()).resolves.toEqual(session);
    expect(invalidate).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled();
  });
  it('ignores a stale refresh rejection after a newer account took over', async () => {
    let local = makeSession('old'); let reject!: (error: unknown) => void;
    const invalidate = jest.fn();
    const controller = createAuthRecovery({ getSession: () => ({ data: { session: local } }),
      getLocalSession: () => ({ data: { session: local } }), refreshSession: () => new Promise((_resolve, fail) => { reject = fail; }), invalidateSession: invalidate });
    const pending = controller.refreshSessionOnce();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    local = makeSession('new'); reject({ code: 'refresh_token_not_found', status: 400 });
    await expect(pending).resolves.toEqual(local); expect(invalidate).not.toHaveBeenCalled();
  });
  it('does not refresh twice when the once-only recovery itself fails', async () => {
    const refresh = jest.fn(() => ({ data: { session: null }, error: null }));
    const controller = createAuthRecovery(adapterFor(() => ({ data: { session: makeSession() } }), refresh));
    await expect(controller.withAuthenticatedOperation(() => ({ error: { status: 401 } }))).rejects.toMatchObject({ code: 'session_missing_or_expired' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});


it('preserves a newly signed-in identity when refresh began with no stored session', async () => {
  let local: AuthSessionLike | null = null;
  let reject!: (error: unknown) => void;
  const invalidate = jest.fn(); const terminal = jest.fn();
  const controller = createAuthRecovery({ getSession: () => ({ data: { session: local } }), getLocalSession: () => ({ data: { session: local } }),
    refreshSession: () => new Promise((_resolve, fail) => { reject = fail; }), invalidateSession: invalidate });
  controller.subscribeTerminal(terminal);
  const pending = controller.refreshSessionOnce();
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  local = makeSession('new-account');
  reject(Object.assign(new Error('session missing'), { name: 'AuthSessionMissingError' }));
  await expect(pending).resolves.toEqual(local);
  expect(invalidate).not.toHaveBeenCalled(); expect(terminal).not.toHaveBeenCalled();
});
