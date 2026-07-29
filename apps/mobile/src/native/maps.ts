/**
 * Maps boundary — place search and directions.
 *
 * This is the ONLY module the JS layer uses for geocoding / place search.
 *
 * Resolution order:
 *  1. Native module non-empty hits (MapKit on iOS Dev Build).
 *  2. Authenticated Google Places/Routes proxy (required on Android production).
 *  3. Photon / Nominatim free geocoders — development / web / iOS Expo Go only;
 *     not used as Android production autocomplete.
 *
 * Empty native results are never treated as a successful terminal search.
 */
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Coordinates } from '../types';
import { distanceMeters } from '../utils/geo';
import { parseCoordinatePair } from '../utils/coordinateDestination';
import { decodePlusCode, extractPlusCode } from '../utils/plusCode';
import {
  MapsProxyError,
  proxyGetDirections,
  proxySearchPlaces,
} from './googleMapsProxy';

/** Custom native module; `null` in Expo Go / when not built. */
const HitherMaps = requireOptionalNativeModule<{
  searchPlaces(query: string, region?: MapRegion): Promise<PlaceResult[]>;
  getDirections(
    from: Coordinates,
    to: Coordinates,
    travelMode: TravelMode,
  ): Promise<DirectionsResult>;
}>('HitherMaps');

/** A search hit the "next gathering point" picker can drop on the map. */
export interface PlaceResult {
  id: string;
  name: string;
  address?: string;
  coordinates: Coordinates;
}

/** Map viewport used to bias search results toward what the user sees. */
export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export type TravelMode = 'walk' | 'drive' | 'transit';

/** Where a route geometry / ETA came from — drives UI labels. */
export type RouteSource = 'native' | 'google' | 'estimate';

export interface DirectionsResult {
  distanceMeters: number;
  expectedTravelTimeSeconds: number;
  points: Coordinates[];
  /** Omitted on older callers; UI treats missing as native when points exist. */
  source?: RouteSource;
}

export const ROUTE_SIMPLIFY_TOLERANCE_M = 10;

function pointToSegmentMeters(
  point: Coordinates,
  start: Coordinates,
  end: Coordinates,
): number {
  const meanLatitude = ((start.latitude + end.latitude) / 2) * Math.PI / 180;
  const xScale = 111_320 * Math.cos(meanLatitude);
  const yScale = 110_540;
  const endX = (end.longitude - start.longitude) * xScale;
  const endY = (end.latitude - start.latitude) * yScale;
  const pointX = (point.longitude - start.longitude) * xScale;
  const pointY = (point.latitude - start.latitude) * yScale;
  const lengthSquared = endX * endX + endY * endY;
  if (lengthSquared === 0) return Math.hypot(pointX, pointY);
  const ratio = Math.max(
    0,
    Math.min(1, (pointX * endX + pointY * endY) / lengthSquared),
  );
  return Math.hypot(pointX - ratio * endX, pointY - ratio * endY);
}

/** Remove provider geometry noise while preserving endpoints and real turns. */
export function simplifyRoutePoints(
  points: Coordinates[],
  toleranceMeters = ROUTE_SIMPLIFY_TOLERANCE_M,
): Coordinates[] {
  if (points.length <= 2 || toleranceMeters <= 0) return points.slice();

  let furthestIndex = -1;
  let furthestDistance = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointToSegmentMeters(points[index], start, end);
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }
  if (furthestIndex < 0 || furthestDistance <= toleranceMeters) {
    return [start, end];
  }
  const before = simplifyRoutePoints(
    points.slice(0, furthestIndex + 1),
    toleranceMeters,
  );
  const after = simplifyRoutePoints(points.slice(furthestIndex), toleranceMeters);
  return [...before.slice(0, -1), ...after];
}

const PHOTON = 'https://photon.komoot.io/api';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'HitherApp/0.1 (gathering-point search)';

function viewboxParam(region?: MapRegion): string | null {
  if (!region) {
    return null;
  }
  const left = region.longitude - region.longitudeDelta / 2;
  const right = region.longitude + region.longitudeDelta / 2;
  const top = region.latitude + region.latitudeDelta / 2;
  const bottom = region.latitude - region.latitudeDelta / 2;
  // Nominatim viewbox order: left,top,right,bottom
  return `${left},${top},${right},${bottom}`;
}

/** Re-rank by real distance from the viewport centre (closest first). */
function rankByDistance(
  results: PlaceResult[],
  region?: MapRegion,
): PlaceResult[] {
  if (!region) {
    return results;
  }
  const centre: Coordinates = {
    latitude: region.latitude,
    longitude: region.longitude,
  };
  return [...results].sort(
    (a, b) =>
      distanceMeters(a.coordinates, centre) -
      distanceMeters(b.coordinates, centre),
  );
}

interface PhotonFeature {
  properties?: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  geometry?: { coordinates?: [number, number] };
}

function photonAddress(p: NonNullable<PhotonFeature['properties']>): string {
  const line = [p.housenumber, p.street].filter(Boolean).join(' ');
  return [line, p.city, p.state, p.country].filter(Boolean).join(', ');
}

/** Primary free geocoder for dev/web/iOS Expo Go. */
async function searchPhoton(
  query: string,
  region?: MapRegion,
): Promise<PlaceResult[]> {
  const params = new URLSearchParams({ q: query, limit: '10' });
  if (region) {
    params.set('lat', String(region.latitude));
    params.set('lon', String(region.longitude));
  }
  const res = await fetch(`${PHOTON}?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) {
    return [];
  }
  const body = (await res.json()) as { features?: PhotonFeature[] };
  return (body.features ?? [])
    .map((f, i): PlaceResult | null => {
      const coords = f.geometry?.coordinates;
      const props = f.properties;
      if (!coords || !props) {
        return null;
      }
      const address = photonAddress(props);
      return {
        id: props.osm_id ? `${props.osm_type ?? 'p'}${props.osm_id}` : `ph${i}`,
        name: props.name || address.split(',')[0] || query,
        address: address || undefined,
        coordinates: { latitude: coords[1], longitude: coords[0] },
      };
    })
    .filter((r): r is PlaceResult => r !== null);
}

interface NominatimHit {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
}

/** Fallback free geocoder. */
async function searchNominatim(
  query: string,
  region?: MapRegion,
): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '0',
    limit: '10',
    'accept-language': 'zh-TW,zh,en',
  });
  const viewbox = viewboxParam(region);
  if (viewbox) {
    params.set('viewbox', viewbox);
    params.set('bounded', query.length <= 4 ? '1' : '0');
  }

  const res = await fetch(`${NOMINATIM}?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) {
    return [];
  }
  const hits = (await res.json()) as NominatimHit[];
  return hits.map((h) => ({
    id: String(h.place_id),
    name: h.name || h.display_name.split(',')[0],
    address: h.display_name,
    coordinates: {
      latitude: Number.parseFloat(h.lat),
      longitude: Number.parseFloat(h.lon),
    },
  }));
}

/** Photon/Nominatim only off Android production. */
function allowPublicGeocoderFallback(): boolean {
  if (Platform.OS !== 'android') return true;
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

/**
 * Provider-specific map defaults for transit orientation.
 *
 * Platform selection lives here (native boundary), not in UI components.
 * - Android Google Maps: `showsTransit` (requires Maps SDK ≥ 20 + patch).
 * - iOS MapKit: no network-layer toggle; keep standard POIs (incl. transit).
 */
export type MapTransitDefaultProps = {
  showsTransit?: boolean;
  showsPointsOfInterests?: boolean;
  showsBuildings?: boolean;
};

export function defaultMapTransitProps(): MapTransitDefaultProps {
  if (Platform.OS === 'android') {
    // Cast surface for patched react-native-maps prop (not in stock types).
    return { showsTransit: true };
  }
  return {
    showsPointsOfInterests: true,
    showsBuildings: false,
  };
}

/**
 * Search for places by free text, biased toward `region` when given.
 * Returns [] on total failure so the picker degrades gracefully.
 */
export async function searchPlaces(
  query: string,
  region?: MapRegion,
): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const coordinatePair = parseCoordinatePair(trimmed);
  if (coordinatePair) {
    return [{
      id: `coordinates:${coordinatePair.latitude},${coordinatePair.longitude}`,
      name: trimmed,
      coordinates: coordinatePair,
    }];
  }

  const plusCode = extractPlusCode(trimmed);
  const plusCodeCoordinates = plusCode
    ? decodePlusCode(
      plusCode,
      region ? { latitude: region.latitude, longitude: region.longitude } : undefined,
    )
    : null;
  if (plusCode && plusCodeCoordinates) {
    // A Plus Code identifies a coordinate rectangle, not necessarily a named
    // POI. Ask the authenticated Places proxy for the nearest display name;
    // retain the locally decoded coordinate even when Google snaps the result
    // to a nearby place. If lookup is unavailable, the add-time title editor
    // remains the guaranteed fallback.
    try {
      const namedPlaces = await proxySearchPlaces(plusCode, region);
      const nearest = namedPlaces?.length
        ? [...namedPlaces].sort(
          (a, b) =>
            distanceMeters(a.coordinates, plusCodeCoordinates) -
            distanceMeters(b.coordinates, plusCodeCoordinates),
        )[0]
        : null;
      if (nearest) {
        return [{
          ...nearest,
          id: `plus-code:${plusCode}`,
          coordinates: plusCodeCoordinates,
        }];
      }
    } catch {
      // Keep the decoded coordinate usable when Places is offline or out of quota.
    }
    return [{
      id: `plus-code:${plusCode}`,
      name: plusCode,
      coordinates: plusCodeCoordinates,
    }];
  }

  // Native non-empty only — empty arrays must not short-circuit the proxy.
  if (HitherMaps) {
    try {
      const native = await HitherMaps.searchPlaces(trimmed, region);
      if (Array.isArray(native) && native.length > 0) {
        return native;
      }
    } catch {
      // fall through
    }
  }

  try {
    const proxy = await proxySearchPlaces(trimmed, region);
    if (proxy !== null) {
      return proxy;
    }
  } catch (err) {
    // Fail-closed for auth/quota: do not pretend free geocoders are production Places.
    if (err instanceof MapsProxyError) {
      if (err.code === 'quota_exceeded' || err.code === 'unauthorized') {
        if (!allowPublicGeocoderFallback()) return [];
      }
    }
  }

  if (!allowPublicGeocoderFallback()) {
    return [];
  }

  try {
    const photon = await searchPhoton(trimmed, region);
    if (photon.length > 0) {
      return rankByDistance(photon, region);
    }
    return rankByDistance(await searchNominatim(trimmed, region), region);
  } catch {
    return [];
  }
}

export async function getDirections(
  from: Coordinates,
  to: Coordinates,
  travelMode: TravelMode,
): Promise<DirectionsResult | null> {
  // Public MapKit transit supports ETA, not route geometry. Use the existing
  // authenticated Routes proxy for the in-app transit polyline on iOS.
  if (HitherMaps && !(Platform.OS === 'ios' && travelMode === 'transit')) {
    try {
      const route = await HitherMaps.getDirections(from, to, travelMode);
      if (route && route.points.length > 0) {
        return {
          ...route,
          points: simplifyRoutePoints(route.points),
          source: route.source ?? 'native',
        };
      }
    } catch {
      // fall through to proxy
    }
  }

  try {
    const route = await proxyGetDirections(from, to, travelMode);
    return route
      ? { ...route, points: simplifyRoutePoints(route.points) }
      : null;
  } catch {
    return null;
  }
}
