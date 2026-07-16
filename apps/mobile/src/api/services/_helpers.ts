import { supabase } from '../supabase';

const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Generate a 6-char invite code from the schema's character set. */
export function generateInviteCode(): string {
  return Array.from(
    { length: 6 },
    () =>
      INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)],
  ).join('');
}

/**
 * Current authenticated user id (auth.uid()). Throws if signed out. Reads the
 * locally cached session — no network round-trip per API call; RLS re-validates
 * the JWT server-side on every query, so nothing trusts this id blindly.
 */
export async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (error || !uid) {
    throw new Error('尚未登入');
  }
  return uid;
}

/** True when the failure is a transport-level fetch/network error (RN common). */
export function isNetworkRequestError(error: unknown): boolean {
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
  error: { message: string; code?: string; details?: string | null } | null,
): void {
  if (!error) return;
  const err = new Error(error.message) as Error & {
    code?: string;
    details?: string | null;
  };
  if (error.code) err.code = error.code;
  if (error.details !== undefined) err.details = error.details;
  throw err;
}

/** Short pause used for one-shot retries after flaky mobile network blips. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
