import { classifyOperationError, getOperationResultError, isSessionOperationError } from '../utils/operationError';

export interface AuthSessionLike {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number | null;
  user?: { id?: string } | null;
}
export interface AuthAdapterResult {
  data?: { session?: AuthSessionLike | null } | null;
  error?: unknown | null;
}
export interface AuthRecoveryAdapter {
  getSession: () => Promise<AuthAdapterResult> | AuthAdapterResult;
  refreshSession: () => Promise<AuthAdapterResult> | AuthAdapterResult;
  /** Reads persisted identity without invoking the SDK's implicit refresh. */
  getLocalSession?: () => Promise<AuthAdapterResult> | AuthAdapterResult;
  invalidateSession?: (expected: AuthSessionLike | null) => Promise<boolean | void> | boolean | void;
}
export interface AuthenticatedOperationOptions {
  operation?: string;
  mutation?: boolean;
  recoverOnce?: boolean;
}
export interface AuthRecoveryController {
  getSession(options?: { forceRefresh?: boolean }): Promise<AuthSessionLike>;
  getLocalSession(): Promise<AuthSessionLike | null>;
  refreshSessionOnce(): Promise<AuthSessionLike>;
  refreshIfExpiring(): Promise<AuthSessionLike | null>;
  subscribeTerminal(listener: () => void): () => void;
  withAuthenticatedOperation<T>(work: (session: AuthSessionLike) => Promise<T> | T, options?: AuthenticatedOperationOptions): Promise<T>;
}
const TERMINAL_REFRESH_CODES = new Set([
  'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found',
  'session_expired', 'user_not_found', 'user_banned',
]);
/** Only apply this policy to an Auth refresh failure, never a generic API 401. */
export function isTerminalRefreshError(error: unknown): boolean {
  const value = error as { code?: unknown; name?: unknown } | null;
  return (typeof value?.code === 'string' && TERMINAL_REFRESH_CODES.has(value.code))
    || value?.name === 'AuthSessionMissingError';
}
function sessionFrom(result: AuthAdapterResult): AuthSessionLike | null {
  const session = result.data?.session;
  return session && typeof session.access_token === 'string' && session.access_token ? session : null;
}
function missingSession(code = 'session_missing_or_expired'): Error & { code: string; status: number } {
  return Object.assign(new Error('Authenticated session is unavailable'), { code, status: 401 });
}
function checked(result: AuthAdapterResult): AuthSessionLike | null {
  if (result.error) throw result.error;
  return sessionFrom(result);
}
function expiring(session: AuthSessionLike, now: number): boolean {
  return typeof session.expires_at === 'number' && session.expires_at <= Math.floor(now / 1000) + 30;
}
export function createAuthRecovery(adapter: AuthRecoveryAdapter, options: { now?: () => number } = {}): AuthRecoveryController {
  const now = options.now ?? Date.now;
  let refreshFlight: Promise<AuthSessionLike> | null = null;
  const listeners = new Set<() => void>();
  const getLocalSession = async () => checked(await (adapter.getLocalSession ?? adapter.getSession)());
  const refreshSessionOnce = (): Promise<AuthSessionLike> => {
    if (refreshFlight) return refreshFlight;
    // Install the flight before starting any adapter work (including synchronous
    // test adapters and SDK events) so every caller observes the same rotation.
    const flight = Promise.resolve().then(async () => {
      const before = adapter.getLocalSession ? await getLocalSession() : null;
      try {
        const session = checked(await adapter.refreshSession());
        if (!session) throw missingSession();
        if (before?.user?.id && session.user?.id !== before.user.id) throw missingSession('account_changed');
        return session;
      } catch (error) {
        if (isTerminalRefreshError(error)) {
          const current = adapter.getLocalSession ? await getLocalSession().catch(() => null) : null;
          // A stale refresh rejection must not invalidate a newly rotated token
          // or a different account that signed in while the request was pending.
          if (current && (!before || current.refresh_token !== before.refresh_token
            || current.user?.id !== before.user?.id || current.access_token !== before.access_token)) return current;
          const invalidated = await adapter.invalidateSession?.(before);
          const after = adapter.getLocalSession ? await getLocalSession().catch(() => null) : null;
          if (after && (!before || after.refresh_token !== before.refresh_token
            || after.user?.id !== before.user?.id || after.access_token !== before.access_token)) return after;
          if (invalidated !== false) for (const listener of listeners) listener();
        }
        throw error;
      }
    });
    refreshFlight = flight;
    void flight.finally(() => { if (refreshFlight === flight) refreshFlight = null; }).catch(() => undefined);
    return flight;
  };
  const getSession = async (getOptions: { forceRefresh?: boolean } = {}): Promise<AuthSessionLike> => {
    if (getOptions.forceRefresh && adapter.getLocalSession) {
      const local = await getLocalSession();
      if (!local) throw missingSession();
      return refreshSessionOnce();
    }
    let session: AuthSessionLike | null;
    try { session = checked(await adapter.getSession()); }
    catch (error) {
      if (!isSessionOperationError(error) && classifyOperationError(error).kind !== 'unknown') throw error;
      return refreshSessionOnce();
    }
    if (session && !getOptions.forceRefresh && !expiring(session, now())) return session;
    return refreshSessionOnce();
  };
  const refreshIfExpiring = async () => {
    const session = checked(await adapter.getSession());
    return session && expiring(session, now()) ? refreshSessionOnce() : session;
  };
  const withAuthenticatedOperation = async <T>(work: (session: AuthSessionLike) => Promise<T> | T, operationOptions: AuthenticatedOperationOptions = {}): Promise<T> => {
    let session = await getSession();
    const actorId = session.user?.id;
    const recover = operationOptions.recoverOnce !== false;
    for (let attempt = 0; attempt < (recover ? 2 : 1); attempt += 1) {
      let result: T;
      let thrown: unknown;
      try { result = await work(session); }
      catch (error) { thrown = error; }
      const error = thrown ?? getOperationResultError(result!);
      if (attempt === 0 && recover && error && isSessionOperationError(error)
        && (error as { code?: string })?.code !== 'account_changed') {
        session = await refreshSessionOnce();
        if (actorId && session.user?.id !== actorId) throw missingSession('account_changed');
        continue;
      }
      if (thrown !== undefined) throw thrown;
      return result!;
    }
    throw missingSession();
  };
  return { getSession, getLocalSession, refreshSessionOnce, refreshIfExpiring, withAuthenticatedOperation,
    subscribeTerminal: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
let defaultController: AuthRecoveryController | null = null;
export function configureDefaultAuthRecovery(adapter: AuthRecoveryAdapter, options?: { now?: () => number }): AuthRecoveryController {
  defaultController = createAuthRecovery(adapter, options);
  return defaultController;
}
export function getDefaultAuthRecovery(): AuthRecoveryController {
  if (!defaultController) throw new Error('Auth recovery has not been configured');
  return defaultController;
}
export function __resetDefaultAuthRecoveryForTests(): void { defaultController = null; }
