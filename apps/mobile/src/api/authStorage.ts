import * as SecureStore from 'expo-secure-store';

export interface AuthStorageAdapter {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}
export interface SupabaseAuthStorage {
  /** Draft identity only: cached value without waiting for credential persistence. */
  getLocalItem?: (key: string) => Promise<string | null>;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}
export interface AuthStorageController {
  storage: SupabaseAuthStorage;
  resetForTests: () => void;
}

function sessionActor(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const session = JSON.parse(value);
    return typeof session?.access_token === 'string' && typeof session?.refresh_token === 'string'
      && typeof session?.user?.id === 'string' ? session.user.id : null;
  } catch { return null; }
}

/** Persist only in SecureStore. Keep the newest rotation readable through
 * temporary write failure; serialize each key and fence queued writes on logout.
 * A failed deletion retains a process-local tombstone and retries on later use.
 */
export function createSupabaseAuthStorage(
  secureStore: AuthStorageAdapter = SecureStore,
): AuthStorageController {
  const latest = new Map<string, string | null>();
  // Track the physical slot independently of the recoverable process cache.
  const persistedActors = new Map<string, string | null>();
  const pending = new Set<string>();
  const generations = new Map<string, number>();
  const flights = new Map<string, Promise<unknown>>();
  function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
    const flight = (flights.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    flights.set(key, flight);
    void flight.finally(() => {
      if (flights.get(key) === flight) flights.delete(key);
    }).catch(() => undefined);
    return flight;
  }
  async function flush(key: string, generation: number): Promise<void> {
    if (generations.get(key) !== generation || !pending.has(key)) return;
    const value = latest.get(key);
    try {
      if (value == null) await secureStore.deleteItemAsync(key);
      else await secureStore.setItemAsync(key, value);
      persistedActors.set(key, sessionActor(value));
      if (generations.get(key) === generation) pending.delete(key);
    } catch {
      // A later read/write retries persistence. Never return an older token
      // merely because the newest rotated credential could not be written.
    }
  }
  const storage: SupabaseAuthStorage = {
    getLocalItem(key) {
      // Auth bootstrap warms latest. A rotated-token write must never hold a
      // local button behind Keychain I/O. Logout publishes its tombstone before
      // any await; replacement actors remain fenced until old-slot deletion.
      return latest.has(key)
        ? Promise.resolve().then(() => latest.get(key) ?? null)
        : storage.getItem(key);
    },
    getItem(key) {
      return serialize(key, async () => {
        if (latest.has(key)) {
          await flush(key, generations.get(key) ?? 0);
          return latest.get(key) ?? null;
        }
        const generation = generations.get(key) ?? 0;
        const value = await secureStore.getItemAsync(key);
        persistedActors.set(key, sessionActor(value));
        if ((generations.get(key) ?? 0) !== generation) return latest.get(key) ?? null;
        latest.set(key, value);
        return value;
      });
    },
    setItem(key, value) {
      const generation = (generations.get(key) ?? 0) + 1;
      generations.set(key, generation);
      const actor = sessionActor(value);
      if (actor) {
        return serialize(key, async () => {
          if (generations.get(key) !== generation) return;
          const persistedActor = persistedActors.get(key);
          if (persistedActor === undefined || (persistedActor !== null && persistedActor !== actor)) {
            // A replacement must retire the old account before publishing the
            // new one. If deletion fails, reject sign-in and retain the old
            // process identity. A failed subsequent write can then lose only
            // the new credential on restart, never restore the previous actor.
            await secureStore.deleteItemAsync(key);
            persistedActors.set(key, null);
            if (generations.get(key) !== generation) return;
          }
          latest.set(key, value);
          pending.add(key);
          await flush(key, generation);
        });
      }
      latest.set(key, value);
      pending.add(key);
      return serialize(key, () => flush(key, generation));
    },
    removeItem(key) {
      const generation = (generations.get(key) ?? 0) + 1;
      generations.set(key, generation);
      latest.set(key, null);
      pending.add(key);
      return serialize(key, () => flush(key, generation));
    },
  };
  return {
    storage,
    resetForTests: () => {
      latest.clear(); persistedActors.clear(); pending.clear(); generations.clear(); flights.clear();
    },
  };
}
const controller = createSupabaseAuthStorage();
export const supabaseAuthStorage = controller.storage;
export function __resetAuthStorageForTests(): void { controller.resetForTests(); }
