/**
 * Authenticated Supabase Edge Function client for Places / Routes.
 * Keeps the server Maps key off the device; callers never see it.
 */
import type { Coordinates } from '../types';
import { decodePolyline } from '../utils/polyline';
import type { DirectionsResult, MapRegion, PlaceResult, TravelMode } from './maps';

export type MapsProxyErrorCode =
  | 'unauthorized'
  | 'quota_exceeded'
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
  error?: 'quota_exceeded' | 'invalid_input' | 'upstream_unavailable' | string;
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
    throw new MapsProxyError('unauthorized', 401);
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
    throw new MapsProxyError('network', 0);
  }
}

function throwForStatus(res: Response, body: ProxyErrorBody): never {
  if (res.status === 401) throw new MapsProxyError('unauthorized', 401);
  if (res.status === 429 || body.error === 'quota_exceeded') {
    throw new MapsProxyError('quota_exceeded', 429);
  }
  if (res.status === 400 || body.error === 'invalid_input') {
    throw new MapsProxyError('invalid_input', 400);
  }
  throw new MapsProxyError('upstream_unavailable', res.status || 503);
}

/**
 * Places search via proxy. Returns `null` when the proxy is unavailable
 * without a hard auth/quota error (caller may fall through).
 */
export async function proxySearchPlaces(
  query: string,
  region?: MapRegion,
): Promise<PlaceResult[] | null> {
  const res = await postProxy({
    action: 'search',
    query,
    region,
    languageCode: 'zh-TW',
  });
  const body = (await res.json().catch(() => ({}))) as ProxySearchResponse & ProxyErrorBody;
  if (!res.ok) throwForStatus(res, body);
  if (body.action !== 'search' || !Array.isArray(body.places)) {
    throw new MapsProxyError('upstream_unavailable', 503);
  }
  return body.places.map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address,
    coordinates: p.coordinates,
  }));
}

/** Directions via proxy; polyline is decoded to map points. */
export async function proxyGetDirections(
  from: Coordinates,
  to: Coordinates,
  travelMode: TravelMode,
): Promise<DirectionsResult | null> {
  const res = await postProxy({
    action: 'route',
    from,
    to,
    travelMode,
  });
  const body = (await res.json().catch(() => ({}))) as ProxyRouteResponse & ProxyErrorBody;
  if (!res.ok) throwForStatus(res, body);
  if (body.action !== 'route') {
    throw new MapsProxyError('upstream_unavailable', 503);
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
}
