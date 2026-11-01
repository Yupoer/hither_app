import { supabase } from '../supabase';
import {
  getDefaultAuthRecovery,
  type AuthSessionLike,
  type AuthenticatedOperationOptions,
} from '../authRecovery';
import {
  classifyOperationError,
  type OperationErrorClassification,
} from '../../utils/operationError';

const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Generate a 6-char invite code from the schema's character set. */
export function generateInviteCode(): string {
  return Array.from(
    { length: 6 },
    () =>
      INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)],
  ).join('');
}

/** Ensure a request has a real session before any caller starts a mutation. */
export async function requireAuthenticatedSession(): Promise<AuthSessionLike> {
  return getDefaultAuthRecovery().getSession();
}

/**
 * Draft-only actor binding for offline durable work.
 *
 * This intentionally does not call requireUserId(), getSession(), or refresh
 * the token. It reads the current Supabase SecureStore namespace through the
 * local-only wrapper and fails closed when the persisted session is absent.
 */
export async function requireLocalActorId(): Promise<string> {
  const actorId = await supabase.getLocalAuthActorId();
  if (actorId) return actorId;
  throw Object.assign(new Error('Local auth actor is unavailable'), {
    code: 'local_auth_actor_missing',
  });
}

/**
 * Injectable/testable operation gate for service adapters that need an
 * explicit boundary instead of relying on the Supabase client proxy.
 */
export function runAuthenticatedOperation<T>(
  operation: string,
  work: (session: AuthSessionLike) => Promise<T> | T,
  options: Omit<AuthenticatedOperationOptions, 'operation'> = {},
): Promise<T> {
  return getDefaultAuthRecovery().withAuthenticatedOperation(work, {
    ...options,
    operation,
  });
}

/**
 * Current authenticated user id (auth.uid()). Throws if signed out. Reads the
 * locally cached session — no network round-trip per API call; RLS re-validates
 * the JWT server-side on every query, so nothing trusts this id blindly.
 */
export async function requireUserId(): Promise<string> {
  const session = await requireAuthenticatedSession();
  const uid = session.user?.id;
  if (!uid) {
    throw Object.assign(new Error('Authenticated session user is missing'), {
      code: 'session_missing_or_expired',
      status: 401,
    });
  }
  return uid;
}

/** True when the failure is a transport-level fetch/network error (RN common). */
export function isNetworkRequestError(error: unknown): boolean {
  if (classifyOperationError(error).kind === 'offline_transport') return true;
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return (
    msg.includes('network request failed')
    || msg.includes('failed to fetch')
    || msg.includes('networkerror')
    || msg.includes('fetch failed')
    || msg.includes('the network connection was lost')
  );
}

/** Throw a clean Error when a Supabase response reports one. */
export function orThrow(
  error: unknown | null,
): void {
  if (!error) return;
  const source = typeof error === 'object' && error !== null
    ? error as Record<string, unknown>
    : {};
  const message = typeof source.message === 'string'
    ? source.message
    : typeof error === 'string'
      ? error
      : 'Supabase operation failed';
  const err = new Error(message) as Error & {
    code?: string;
    details?: unknown;
    hint?: unknown;
    status?: number;
    cause?: unknown;
  };
  if (typeof source.code === 'string') err.code = source.code;
  if (source.details !== undefined) err.details = source.details;
  if (source.hint !== undefined) err.hint = source.hint;
  if (typeof source.status === 'number') err.status = source.status;
  // Keep the structured provider error available to the classifier without
  // stringifying it into logs or user-facing copy.
  err.cause = error;
  throw err;
}

export {
  classifyOperationError,
  type OperationErrorClassification,
};

/** Short pause used for one-shot retries after flaky mobile network blips. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
