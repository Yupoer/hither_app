import type { AuthAdapterResult, AuthRecoveryAdapter, AuthSessionLike } from './authRecovery';
import type { SupabaseAuthStorage } from './authStorage';
export function createSupabaseAuthRecoveryAdapter(auth: {
  getSession: () => Promise<AuthAdapterResult>;
  refreshSession: () => Promise<AuthAdapterResult>;
  stopAutoRefresh: () => void | Promise<void>;
}, storage: SupabaseAuthStorage, key: string): AuthRecoveryAdapter {
  const getLocalSession = async (): Promise<AuthAdapterResult> => {
    const raw = await storage.getItem(key);
    let session: AuthSessionLike | null = null;
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (typeof parsed?.access_token === 'string' && typeof parsed?.refresh_token === 'string'
        && typeof parsed?.user?.id === 'string') session = parsed;
    } catch { /* Malformed data is not an authenticated identity. */ }
    return { data: { session }, error: null };
  };
  return {
    getLocalSession,
    getSession: () => auth.getSession(),
    refreshSession: async () => {
      const before = (await getLocalSession()).data?.session;
      // SDK getSession may already refresh an expired/near-expiry JWT. Reuse
      // that rotation rather than invoking refreshSession's second rotation.
      const observed = await auth.getSession();
      if (observed.error) return observed;
      if (observed.data?.session && before
        && observed.data.session.refresh_token !== before.refresh_token) return observed;
      return auth.refreshSession();
    },
    invalidateSession: async expected => {
      const current = (await getLocalSession()).data?.session;
      if (current && (!expected || current.refresh_token !== expected.refresh_token
        || current.user?.id !== expected.user?.id || current.access_token !== expected.access_token)) return false;
      void auth.stopAutoRefresh();
      // No server logout or anonymous deletion. Remove only the rejected
      // credential; a new OAuth flow's verifier and durable drafts are retained.
      await storage.removeItem(key);
      return true;
    },
  };
}
