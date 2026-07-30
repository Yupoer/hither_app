/**
 * Client-side gate for Live Activity push-to-start token registration.
 * Prevents unbounded re-upsert / diagnostic spam for the same identity and
 * permanent ownership conflicts until token/user/device changes.
 *
 * Permanent conflicts can optionally be durability-backed (AsyncStorage) so
 * cold starts do not re-spam the same identity every process death.
 */

import type { LiveActivityTokenRegisterResult } from '../api/services/LiveActivityService';

export type TokenGateIdentity = {
  userId: string;
  deviceId: string;
  token: string | null;
  enabled: boolean;
};

export function identityKey(id: TokenGateIdentity): string {
  return `${id.userId}|${id.deviceId}|${id.token ?? 'null'}|${id.enabled ? '1' : '0'}`;
}

export type TokenGateDecision =
  | { action: 'register' }
  | { action: 'skip'; reason: 'idempotent_cache' | 'permanent_conflict' | 'backoff' };

export type TokenGateDurableStore = {
  getPermanentKey: () => Promise<string | null>;
  setPermanentKey: (key: string | null) => Promise<void>;
};

/** Default durable key TTL: 24h (cold-start spam window). */
export const TOKEN_PERMANENT_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * In-memory register gate. Survives remounts within the same JS runtime;
 * optional durable store survives process death for permanent conflicts.
 */
export function createLiveActivityTokenGate(options?: {
  /** Transient error backoff base ms (default 5s). */
  backoffBaseMs?: number;
  /** Max backoff ms (default 5 min). */
  backoffMaxMs?: number;
  now?: () => number;
  /** Optional durable permanent-conflict key (e.g. AsyncStorage). */
  durable?: TokenGateDurableStore;
  /** Seed permanent key synchronously (tests / preloaded). */
  initialPermanentKey?: string | null;
}) {
  const backoffBaseMs = options?.backoffBaseMs ?? 5_000;
  const backoffMaxMs = options?.backoffMaxMs ?? 5 * 60_000;
  const now = options?.now ?? Date.now;
  const durable = options?.durable;

  let lastSuccessKey: string | null = null;
  let permanentConflictKey: string | null = options?.initialPermanentKey ?? null;
  let transientAttempts = 0;
  let nextRetryAt = 0;
  let lastAttemptKey: string | null = null;
  let hydratePromise: Promise<void> | null = null;

  const hydrate = (): Promise<void> => {
    if (!durable) return Promise.resolve();
    if (!hydratePromise) {
      hydratePromise = durable
        .getPermanentKey()
        .then((key) => {
          if (key && !permanentConflictKey) permanentConflictKey = key;
        })
        .catch(() => undefined);
    }
    return hydratePromise;
  };

  // Fire-and-forget hydrate on create when durable is provided.
  void hydrate();

  const persistPermanent = (key: string | null) => {
    if (!durable) return;
    void durable.setPermanentKey(key).catch(() => undefined);
  };

  return {
    /** Await durable hydrate before first register decision (optional). */
    ready: hydrate,

    /** Decide whether to call the network upsert. */
    shouldRegister(id: TokenGateIdentity): TokenGateDecision {
      const key = identityKey(id);
      if (lastSuccessKey === key) {
        return { action: 'skip', reason: 'idempotent_cache' };
      }
      if (permanentConflictKey === key) {
        return { action: 'skip', reason: 'permanent_conflict' };
      }
      if (lastAttemptKey === key && now() < nextRetryAt) {
        return { action: 'skip', reason: 'backoff' };
      }
      return { action: 'register' };
    },

    /** Record outcome so future identical identities short-circuit. */
    recordResult(id: TokenGateIdentity, result: LiveActivityTokenRegisterResult): void {
      const key = identityKey(id);
      lastAttemptKey = key;

      if (
        result === 'upserted' ||
        result === 'benign_idempotent' ||
        result === 'reclaimed_own_token'
      ) {
        lastSuccessKey = key;
        permanentConflictKey = null;
        persistPermanent(null);
        transientAttempts = 0;
        nextRetryAt = 0;
        return;
      }

      if (result === 'foreign_token_conflict' || result === 'token_unique_unresolved') {
        // Permanent for this exact identity until token/user/device/enabled changes.
        permanentConflictKey = key;
        persistPermanent(key);
        lastSuccessKey = null;
        transientAttempts = 0;
        nextRetryAt = 0;
        return;
      }

      // unknown_error → bounded backoff
      transientAttempts += 1;
      const delay = Math.min(
        backoffMaxMs,
        backoffBaseMs * 2 ** Math.min(transientAttempts - 1, 6),
      );
      nextRetryAt = now() + delay;
      lastSuccessKey = null;
    },

    /** Clear permanent stop when identity inputs change (caller always passes full id). */
    reset(): void {
      lastSuccessKey = null;
      permanentConflictKey = null;
      persistPermanent(null);
      transientAttempts = 0;
      nextRetryAt = 0;
      lastAttemptKey = null;
    },

    /** Test helpers */
    _debug() {
      return {
        lastSuccessKey,
        permanentConflictKey,
        transientAttempts,
        nextRetryAt,
      };
    },
  };
}

export type LiveActivityTokenGate = ReturnType<typeof createLiveActivityTokenGate>;

/** Process-wide gate shared by useLiveActivity mounts. */
let sharedGate: LiveActivityTokenGate | null = null;

const DURABLE_KEY = '@hither/la-token-permanent-conflict';

/** AsyncStorage-backed durable store for permanent conflict identity. */
export function createAsyncStorageTokenDurable(
  storage: {
    getItem: (k: string) => Promise<string | null>;
    setItem: (k: string, v: string) => Promise<void>;
    removeItem: (k: string) => Promise<void>;
  },
  now: () => number = Date.now,
): TokenGateDurableStore {
  return {
    getPermanentKey: async () => {
      const raw = await storage.getItem(DURABLE_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { key?: string; expiresAt?: number };
        if (
          typeof parsed.key === 'string' &&
          typeof parsed.expiresAt === 'number' &&
          parsed.expiresAt > now()
        ) {
          return parsed.key;
        }
      } catch {
        // ignore
      }
      await storage.removeItem(DURABLE_KEY).catch(() => undefined);
      return null;
    },
    setPermanentKey: async (key) => {
      if (!key) {
        await storage.removeItem(DURABLE_KEY);
        return;
      }
      await storage.setItem(
        DURABLE_KEY,
        JSON.stringify({ key, expiresAt: now() + TOKEN_PERMANENT_TTL_MS }),
      );
    },
  };
}

export function getSharedLiveActivityTokenGate(): LiveActivityTokenGate {
  if (!sharedGate) {
    // Lazy durable store — require only when first used on device.
    let durable: TokenGateDurableStore | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
        getItem: (k: string) => Promise<string | null>;
        setItem: (k: string, v: string) => Promise<void>;
        removeItem: (k: string) => Promise<void>;
      };
      durable = createAsyncStorageTokenDurable(AsyncStorage);
    } catch {
      durable = undefined;
    }
    sharedGate = createLiveActivityTokenGate({ durable });
  }
  return sharedGate;
}

/** Test-only: replace shared gate. */
export function __resetSharedLiveActivityTokenGateForTests(): void {
  sharedGate = createLiveActivityTokenGate();
}
