/**
 * Authenticated Supabase Edge Function client for Places / Routes.
 * Keeps the server Maps key off the device; callers never see it.
 */
import type { Coordinates } from '../types';
import { decodePolyline } from '../utils/polyline';
import type { DirectionsResult, MapRegion, PlaceResult, TravelMode } from './maps';

/**
 * Classified maps failure families.
 * - quota_exceeded: daily hard limit hit (429)
 * - quota_rpc_failed: consume_google_maps_quota RPC error (503)
 * - missing_config: Edge Function missing URL/API key (503)
 * - upstream_unavailable: Google non-2xx / malformed body (503)
 * - network: client fetch failure
 * - unauthorized / invalid_input: auth or validation
 */
export type MapsProxyErrorCode =
  | 'unauthorized'
  | 'quota_exceeded'
  | 'quota_rpc_failed'
  | 'missing_config'
  | 'invalid_input'
  | 'upstream_unavailable'
  | 'network';

export class MapsProxyError extends Error {
  readonly code: MapsProxyErrorCode;
  readonly status: number;

  constructor(code: MapsProxyErrorCode, status: number, message?: string) {
    super(message ?? code);
    this.name = 'MapsProxyError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Codes that should avoid tight multi-key retry loops:
 * - quota_exceeded: daily limit hit (quota was booked)
 * - quota_rpc_failed: consume RPC unhealthy (quota may not have been booked)
 */
export function isMapsQuotaFailure(code: MapsProxyErrorCode): boolean {
  return code === 'quota_exceeded' || code === 'quota_rpc_failed';
}

/** Global cool-down applies across all keys (quota / missing config). */
function usesGlobalCooldown(code: MapsProxyErrorCode): boolean {
  return isMapsQuotaFailure(code) || code === 'missing_config';
}

/** Record map/search/directions failures without changing throw/fallback behavior. */
function recordMapsProxyFailure(
  operation: 'maps.proxy.search' | 'maps.proxy.directions' | 'maps.proxy.request',
  error: MapsProxyError,
): void {
  try {
    // Lazy require keeps unit tests that mock this module free of performance deps.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recordClassifiedError } = require('../state/performance') as {
      recordClassifiedError: (
        operation: string,
        error: unknown,
        extra?: Record<string, unknown>,
      ) => Promise<void>;
    };
    void recordClassifiedError(operation, error, {
      subsystem: 'maps',
      // Classification lives on allow-listed errorCode (not a dropped extra field).
      errorCode: error.code,
      httpStatus: error.status,
      supabaseOperation: 'functions.google-maps',
      screen: 'Map',
      outcome: 'failed',
    });
  } catch {
    // Telemetry must never break map fallback.
  }
}

type ProxySearchResponse = {
  action: 'search';
  places: Array<{
    id: string;
    name: string;
    address?: string;
    coordinates: Coordinates;
  }>;
};

type ProxyRouteResponse = {
  action: 'route';
  route: {
    distanceMeters: number;
    expectedTravelTimeSeconds: number;
    encodedPolyline: string;
  } | null;
};

type ProxyErrorBody = {
  error?:
    | 'quota_exceeded'
    | 'invalid_input'
    | 'upstream_unavailable'
    | 'quota_rpc_failed'
    | 'missing_config'
    | string;
};

async function getAuthContext(): Promise<{
  url: string;
  anonKey: string;
  accessToken: string;
} | null> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  // Lazy import so unit tests that never hit the proxy do not require Supabase env.
  const { supabase } = await import('../api/supabase');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return { url, anonKey, accessToken: session.access_token };
}

async function postProxy(body: unknown): Promise<Response> {
  const auth = await getAuthContext();
  if (!auth) {
    const err = new MapsProxyError('unauthorized', 401);
    recordMapsProxyFailure('maps.proxy.request', err);
    throw err;
  }
  try {
    return await fetch(`${auth.url}/functions/v1/google-maps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        apikey: auth.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    const err = new MapsProxyError('network', 0);
    recordMapsProxyFailure('maps.proxy.request', err);
    throw err;
  }
}

function throwForStatus(
  res: Response,
  body: ProxyErrorBody,
  operation: 'maps.proxy.search' | 'maps.proxy.directions' = 'maps.proxy.search',
): never {
  let err: MapsProxyError;
  if (res.status === 401) err = new MapsProxyError('unauthorized', 401);
  else if (res.status === 429 || body.error === 'quota_exceeded') {
    err = new MapsProxyError('quota_exceeded', 429);
  } else if (res.status === 400 || body.error === 'invalid_input') {
    err = new MapsProxyError('invalid_input', 400);
  } else if (body.error === 'quota_rpc_failed') {
    err = new MapsProxyError('quota_rpc_failed', 503);
  } else if (body.error === 'missing_config') {
    err = new MapsProxyError('missing_config', 503);
  } else if (body.error === 'upstream_unavailable') {
    err = new MapsProxyError('upstream_unavailable', res.status || 503);
  } else {
    // Unknown 5xx — treat as Google/upstream class without inventing config/quota.
    err = new MapsProxyError('upstream_unavailable', res.status || 503);
  }
  recordMapsProxyFailure(operation, err);
  throw err;
}

/** Short TTL success cache + in-flight promise sharing (no credentials in keys). */
const CACHE_TTL_MS = 45_000;
/** Negative cache for classified failures — never infinite retry. */
const FAILURE_COOLDOWN_MS: Record<MapsProxyErrorCode, number> = {
  unauthorized: 30_000,
  quota_exceeded: 60_000,
  quota_rpc_failed: 30_000,
  missing_config: 60_000,
  invalid_input: 15_000,
  upstream_unavailable: 8_000,
  network: 5_000,
};

const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const failureCooldown = new Map<
  string,
  { expiresAt: number; error: MapsProxyError }
>();
/** Process-global cool-down for quota / missing_config (all keys). */
let globalFailureCooldown: { expiresAt: number; error: MapsProxyError } | null =
  null;
const inFlight = new Map<string, Promise<unknown>>();

function regionKey(region?: MapRegion): string {
  if (!region) return '';
  const r = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : '0');
  return `${r(region.latitude)},${r(region.longitude)},${r(region.latitudeDelta)},${r(region.longitudeDelta)}`;
}

function coordKey(c: Coordinates): string {
  return `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;
}

function rememberFailure(key: string, error: MapsProxyError): void {
  const ttl = FAILURE_COOLDOWN_MS[error.code] ?? 5_000;
  const entry = { expiresAt: Date.now() + ttl, error };
  failureCooldown.set(key, entry);
  if (usesGlobalCooldown(error.code)) {
    globalFailureCooldown = entry;
  }
  // Bound map growth.
  if (failureCooldown.size > 40) {
    const now = Date.now();
    for (const [k, v] of failureCooldown) {
      if (v.expiresAt <= now) failureCooldown.delete(k);
    }
    while (failureCooldown.size > 40) {
      const first = failureCooldown.keys().next().value;
      if (first == null) break;
      failureCooldown.delete(first);
    }
  }
}

async function withDedupeCache<T>(key: string, work: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }
  // Global short-circuit: after quota/missing_config, block all keys.
  if (globalFailureCooldown && globalFailureCooldown.expiresAt > now) {
    throw globalFailureCooldown.error;
  }
  if (globalFailureCooldown && globalFailureCooldown.expiresAt <= now) {
    globalFailureCooldown = null;
  }
  const failed = failureCooldown.get(key);
  if (failed && failed.expiresAt > now) {
    // Bounded recovery: surface the same classified error until cooldown ends.
    throw failed.error;
  }
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await work();
      responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      failureCooldown.delete(key);
      // Bound cache growth: drop expired + oldest when large.
      if (responseCache.size > 40) {
        for (const [k, v] of responseCache) {
          if (v.expiresAt <= Date.now()) responseCache.delete(k);
        }
        while (responseCache.size > 40) {
          const first = responseCache.keys().next().value;
          if (first == null) break;
          responseCache.delete(first);
        }
      }
      return value;
    } catch (error) {
      if (error instanceof MapsProxyError) {
        rememberFailure(key, error);
      }
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

/** Test helper — clears in-memory proxy cache between Jest cases. */
export function __resetGoogleMapsProxyCacheForTests(): void {
  responseCache.clear();
  failureCooldown.clear();
  globalFailureCooldown = null;
  inFlight.clear();
}

/**
 * Places search via proxy. Returns `null` when the proxy is unavailable
 * without a hard auth/quota error (caller may fall through).
 */
export async function proxySearchPlaces(
  query: string,
  region?: MapRegion,
): Promise<PlaceResult[] | null> {
  const key = `search:${query.trim().toLowerCase()}:${regionKey(region)}`;
  return withDedupeCache(key, async () => {
    const res = await postProxy({
      action: 'search',
      query,
      region,
      languageCode: 'zh-TW',
    });
    const body = (await res.json().catch(() => ({}))) as ProxySearchResponse & ProxyErrorBody;
    if (!res.ok) throwForStatus(res, body, 'maps.proxy.search');
    if (body.action !== 'search' || !Array.isArray(body.places)) {
      const err = new MapsProxyError('upstream_unavailable', 503);
      recordMapsProxyFailure('maps.proxy.search', err);
      throw err;
    }
    return body.places.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      coordinates: p.coordinates,
    }));
  });
}

/** Directions via proxy; polyline is decoded to map points. */
export async function proxyGetDirections(
  from: Coordinates,
  to: Coordinates,
  travelMode: TravelMode,
): Promise<DirectionsResult | null> {
  const key = `route:${coordKey(from)}:${coordKey(to)}:${travelMode}`;
  return withDedupeCache(key, async () => {
    const res = await postProxy({
      action: 'route',
      from,
      to,
      travelMode,
    });
    const body = (await res.json().catch(() => ({}))) as ProxyRouteResponse & ProxyErrorBody;
    if (!res.ok) throwForStatus(res, body, 'maps.proxy.directions');
    if (body.action !== 'route') {
      const err = new MapsProxyError('upstream_unavailable', 503);
      recordMapsProxyFailure('maps.proxy.directions', err);
      throw err;
    }
    if (!body.route) return null;
    const points = decodePolyline(body.route.encodedPolyline);
    if (points.length === 0) return null;
    return {
      distanceMeters: body.route.distanceMeters,
      expectedTravelTimeSeconds: body.route.expectedTravelTimeSeconds,
      points,
      source: 'google',
    };
  });
}
