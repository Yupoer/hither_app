/**
 * Local identity for durable drafts only. This never authorizes a server write
 * and deliberately does not refresh tokens (drafts must work while offline).
 */
export function defaultSupabaseAuthStorageKey(supabaseUrl: string): string {
  // Mirrors @supabase/supabase-js 2.110.3 SupabaseClient.ts. The app does not
  // pass auth.storageKey, so changing this formula would read a different
  // user's persisted session namespace.
  const baseUrl = new URL(supabaseUrl);
  return `sb-${baseUrl.hostname.split('.')[0]}-auth-token`;
}

export async function readLocalAuthActor(
  storage: { getItem: (key: string) => Promise<string | null> },
  storageKey: string,
): Promise<string | null> {
  const raw = await storage.getItem(storageKey);
  if (!raw) return null;
  let session: unknown;
  try { session = JSON.parse(raw); } catch { return null; }
  if (!session || typeof session !== 'object') return null;
  const value = session as { access_token?: unknown; user?: { id?: unknown } };
  return typeof value.access_token === 'string' && value.access_token.length > 0
    && typeof value.user?.id === 'string' && value.user.id.length > 0
    ? value.user.id : null;
}
