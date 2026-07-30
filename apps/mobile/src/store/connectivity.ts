/**
 * Lightweight online detection for the store (watch/redeem gate).
 * Prefer NetInfo when present (optional peer); otherwise navigator.onLine
 * + optional HEAD probe. No hard dependency on @react-native-community/netinfo.
 */

export type ConnectivitySnapshot = {
  /** true = online, false = offline, null = unknown */
  online: boolean | null;
  source: 'netinfo' | 'navigator' | 'probe' | 'unknown';
};

type NetInfoModule = {
  fetch: () => Promise<{ isConnected?: boolean | null; isInternetReachable?: boolean | null }>;
  addEventListener?: (
    listener: (state: { isConnected?: boolean | null; isInternetReachable?: boolean | null }) => void,
  ) => () => void;
};

function loadNetInfo(): NetInfoModule | null {
  try {
    // Optional — many RN apps have this; Expo Go may not until installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-community/netinfo').default as NetInfoModule;
  } catch {
    return null;
  }
}

function readNavigatorOnline(): boolean | null {
  try {
    const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    if (nav && typeof nav.onLine === 'boolean') return nav.onLine;
  } catch {
    /* ignore */
  }
  return null;
}

function resolveNetInfoState(state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}): boolean | null {
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  if (state.isConnected === true) return true;
  return null;
}

/** Synchronous best-effort (navigator only / last known). */
export function getNavigatorOnline(): boolean | null {
  return readNavigatorOnline();
}

/**
 * Async snapshot: NetInfo if available, else navigator, else null (unknown).
 */
export async function getConnectivitySnapshot(): Promise<ConnectivitySnapshot> {
  const netInfo = loadNetInfo();
  if (netInfo?.fetch) {
    try {
      const state = await netInfo.fetch();
      const online = resolveNetInfoState(state);
      if (online !== null) return { online, source: 'netinfo' };
    } catch {
      /* fall through */
    }
  }
  const nav = readNavigatorOnline();
  if (nav !== null) return { online: nav, source: 'navigator' };
  return { online: null, source: 'unknown' };
}

/**
 * Optional reachability probe (no NetInfo). Uses a short-timeout fetch to the
 * Supabase project URL when available; returns null when URL missing.
 */
export async function probeReachability(
  baseUrl?: string | null,
  timeoutMs = 2500,
): Promise<boolean | null> {
  const url = (baseUrl ?? '').replace(/\/$/, '');
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // HEAD on auth health is cheap; any network-level failure ⇒ offline.
    await fetch(`${url}/auth/v1/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return true;
  } catch (e) {
    const msg = String(e ?? '').toLowerCase();
    if (
      msg.includes('abort')
      || msg.includes('network')
      || msg.includes('failed')
      || msg.includes('fetch')
    ) {
      return false;
    }
    // Non-network HTTP errors still mean the host was reachable.
    return true;
  }
}

/**
 * Subscribe to connectivity changes when NetInfo is present.
 * Returns unsubscribe; no-op when NetInfo missing.
 */
export function subscribeConnectivity(
  onChange: (online: boolean | null) => void,
): () => void {
  const netInfo = loadNetInfo();
  if (!netInfo?.addEventListener) {
    return () => undefined;
  }
  return netInfo.addEventListener((state) => {
    onChange(resolveNetInfoState(state));
  });
}

/** True when we have a positive offline signal (not when unknown). */
export function isDefinitelyOffline(online: boolean | null): boolean {
  return online === false;
}
