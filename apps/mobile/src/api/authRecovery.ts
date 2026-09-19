import {
  classifyOperationError,
  getOperationResultError,
  isSessionOperationError,
  type OperationErrorClassification,
} from '../utils/operationError';

/** Minimal session shape needed by the guarded transport. */
export interface AuthSessionLike {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number | null;
  user?: {
    id?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface AuthAdapterResult {
  data?: { session?: AuthSessionLike | null } | null;
  error?: unknown | null;
}

/** Injectable boundary around Supabase Auth for deterministic unit tests. */
export interface AuthRecoveryAdapter {
  getSession: () => Promise<AuthAdapterResult> | AuthAdapterResult;
  refreshSession: () => Promise<AuthAdapterResult> | AuthAdapterResult;
}

export interface AuthenticatedOperationOptions {
  operation?: string;
  mutation?: boolean;
  /** Auth failures are rejected once, refreshed once, then returned/thrown. */
  recoverOnce?: boolean;
}

export interface AuthRecoveryController {
  getSession(options?: { forceRefresh?: boolean }): Promise<AuthSessionLike>;
  refreshSessionOnce(): Promise<AuthSessionLike>;
  refreshIfExpiring(): Promise<AuthSessionLike | null>;
  withAuthenticatedOperation<T>(
    work: (session: AuthSessionLike) => Promise<T> | T,
    options?: AuthenticatedOperationOptions,
  ): Promise<T>;
}

const DEFAULT_EXPIRY_SKEW_SECONDS = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sessionFrom(result: AuthAdapterResult | null | undefined): AuthSessionLike | null {
  const session = result?.data?.session;
  if (!isRecord(session) || typeof session.access_token !== 'string' || !session.access_token) {
    return null;
  }
  return session as AuthSessionLike;
}

function errorFromResult(result: AuthAdapterResult | null | undefined): unknown | null {
  return result?.error == null ? null : result.error;
}

function sessionMissingError(cause?: unknown): Error & { code: string; status: number; cause?: unknown } {
  const error = new Error('Authenticated session is missing or expired') as Error & {
    code: string;
    status: number;
    cause?: unknown;
  };
  error.code = 'session_missing_or_expired';
  error.status = 401;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function preserveAuthError(error: unknown, fallback: string): unknown {
  if (error instanceof Error) return error;
  if (isRecord(error)) return error;
  return new Error(typeof error === 'string' && error ? error : fallback);
}

function isExpiring(session: AuthSessionLike, nowMs: number): boolean {
  return typeof session.expires_at === 'number'
    && Number.isFinite(session.expires_at)
    && session.expires_at <= Math.floor(nowMs / 1000) + DEFAULT_EXPIRY_SKEW_SECONDS;
}

function classifyAuthFailure(error: unknown): OperationErrorClassification {
  return classifyOperationError(error);
}

/**
 * Create an auth recovery coordinator. Each controller owns one refresh
 * single-flight, so unrelated test adapters cannot share promises while all
 * production Supabase calls share the configured controller.
 */
export function createAuthRecovery(
  adapter: AuthRecoveryAdapter,
  options: { now?: () => number } = {},
): AuthRecoveryController {
  const now = options.now ?? (() => Date.now());
  let refreshFlight: Promise<AuthSessionLike> | null = null;

  const refreshSessionOnce = async (): Promise<AuthSessionLike> => {
    if (refreshFlight) return refreshFlight;

    const flight = (async () => {
      let result: AuthAdapterResult;
      try {
        result = await adapter.refreshSession();
      } catch (error) {
        throw preserveAuthError(error, 'Unable to refresh the authenticated session.');
      }
      const resultError = errorFromResult(result);
      if (resultError) throw preserveAuthError(resultError, 'Unable to refresh the authenticated session.');
      const session = sessionFrom(result);
      if (!session) throw sessionMissingError();
      return session;
    })();

    refreshFlight = flight;
    try {
      return await flight;
    } finally {
      if (refreshFlight === flight) refreshFlight = null;
    }
  };

  const getSession = async (
    getOptions: { forceRefresh?: boolean } = {},
  ): Promise<AuthSessionLike> => {
    let result: AuthAdapterResult;
    try {
      result = await adapter.getSession();
    } catch (error) {
      const classified = classifyAuthFailure(error);
      // A storage or network failure must be surfaced as-is. Do not attempt a
      // second mutation with the anon key while the session cannot be read.
      if (!isSessionOperationError(error) && classified.kind !== 'unknown') throw error;
      return refreshSessionOnce();
    }

    const resultError = errorFromResult(result);
    if (resultError) {
      const classified = classifyAuthFailure(resultError);
      if (
        classified.kind !== 'session_missing_or_expired'
        && classified.kind !== 'unknown'
      ) {
        throw preserveAuthError(resultError, 'Unable to read the authenticated session.');
      }
      return refreshSessionOnce();
    }

    const session = sessionFrom(result);
    if (session && !getOptions.forceRefresh && !isExpiring(session, now())) return session;
    return refreshSessionOnce();
  };

  const refreshIfExpiring = async (): Promise<AuthSessionLike | null> => {
    let result: AuthAdapterResult;
    try {
      result = await adapter.getSession();
    } catch (error) {
      throw error;
    }
    const resultError = errorFromResult(result);
    if (resultError) throw preserveAuthError(resultError, 'Unable to read the authenticated session.');
    const session = sessionFrom(result);
    if (!session) return null;
    return isExpiring(session, now()) ? refreshSessionOnce() : session;
  };

  const withAuthenticatedOperation = async <T>(
    work: (session: AuthSessionLike) => Promise<T> | T,
    operationOptions: AuthenticatedOperationOptions = {},
  ): Promise<T> => {
    let session = await getSession();
    const shouldRecover = operationOptions.recoverOnce !== false;

    for (let attempt = 0; attempt < (shouldRecover ? 2 : 1); attempt += 1) {
      try {
        const result = await work(session);
        const resultError = getOperationResultError(result);
        if (
          resultError
          && attempt === 0
          && shouldRecover
          && classifyAuthFailure(resultError).kind === 'session_missing_or_expired'
        ) {
          session = await refreshSessionOnce();
          continue;
        }
        return result;
      } catch (error) {
        if (
          attempt === 0
          && shouldRecover
          && classifyAuthFailure(error).kind === 'session_missing_or_expired'
        ) {
          session = await refreshSessionOnce();
          continue;
        }
        throw error;
      }
    }

    // The loop always returns or throws; this keeps TypeScript's control-flow
    // analysis explicit if the attempt policy changes later.
    throw sessionMissingError();
  };

  return {
    getSession,
    refreshSessionOnce,
    refreshIfExpiring,
    withAuthenticatedOperation,
  };
}

let defaultController: AuthRecoveryController | null = null;

export function configureDefaultAuthRecovery(
  adapter: AuthRecoveryAdapter,
  options?: { now?: () => number },
): AuthRecoveryController {
  defaultController = createAuthRecovery(adapter, options);
  return defaultController;
}

export function getDefaultAuthRecovery(): AuthRecoveryController {
  if (!defaultController) {
    throw new Error('Auth recovery has not been configured');
  }
  return defaultController;
}

/** Test isolation for modules that use the default singleton. */
export function __resetDefaultAuthRecoveryForTests(): void {
  defaultController = null;
}

