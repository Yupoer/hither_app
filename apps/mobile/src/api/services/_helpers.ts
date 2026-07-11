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

/** Throw a clean Error when a Supabase response reports one. */
export function orThrow(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}
