import * as SecureStore from 'expo-secure-store';

/**
 * Supabase Auth storage with a deliberately narrow fallback.
 *
 * A signed app uses SecureStore for persisted sessions. Unsigned simulator
 * artifacts (for example a local Release build with CODE_SIGNING_ALLOWED=NO)
 * cannot access the iOS keychain and Expo rejects every operation with
 * ERR_KEY_CHAIN. Keeping the current session in memory lets an explicit sign
 * in finish while avoiding writing auth credentials to an unencrypted store.
 * The fallback is process-local and is therefore discarded when the app exits.
 */
const inMemorySession = new Map<string, string>();
let secureStoreUnavailable = false;

function isSecureStoreUnavailable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  return code === 'ERR_KEY_CHAIN'
    || /(?:keychain|entitlement)/i.test(message);
}

export const supabaseAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (secureStoreUnavailable) return inMemorySession.get(key) ?? null;
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      if (!isSecureStoreUnavailable(error)) throw error;
      secureStoreUnavailable = true;
      return inMemorySession.get(key) ?? null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (secureStoreUnavailable) {
      inMemorySession.set(key, value);
      return;
    }
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      if (!isSecureStoreUnavailable(error)) throw error;
      secureStoreUnavailable = true;
      inMemorySession.set(key, value);
    }
  },

  async removeItem(key: string): Promise<void> {
    if (secureStoreUnavailable) {
      inMemorySession.delete(key);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      if (!isSecureStoreUnavailable(error)) throw error;
      secureStoreUnavailable = true;
      inMemorySession.delete(key);
    }
  },
};

/** Test-only reset; it does not run in application code. */
export function __resetAuthStorageForTests(): void {
  secureStoreUnavailable = false;
  inMemorySession.clear();
}
