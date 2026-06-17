/**
 * Maps boundary — place search and directions.
 *
 * This is the ONLY module the JS layer uses for geocoding / place search.
 * Per the "Apple Maps 搜尋" decision (hybrid plan A): Phase A ships a
 * pure-JS Nominatim (OpenStreetMap) fallback that runs in Expo Go on any
 * platform. A native module (`apps/mobile/modules/hither-maps`, Phase B)
 * can later back the SAME interface with Apple MapKit / Google Places for
 * better quality on a Dev Build.
 *
 * Nominatim usage policy: low volume only, must send a descriptive
 * User-Agent / Referer. Do not hammer it; debounce callers.
 *
 * Phase B seam: the custom native module `HitherMaps`
 * (`apps/mobile/modules/hither-maps`) can back these with Apple MapKit on a
 * Dev Build; absent in Expo Go, where the Nominatim fallback runs.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Coordinates } from '../types';

/** Custom native module; `null` in Expo Go / when not built. */
const HitherMaps = requireOptionalNativeModule<{
  searchPlaces(query: string, region?: MapRegion): Promise<PlaceResult[]>;
  getDirections(from: Coordinates, to: Coordinates): Promise<DirectionsResult>;
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

/** A coarse directions result. Phase A returns a straight-line estimate. */
export interface DirectionsResult {
  /** Straight-line (or routed, on native) distance in metres. */
  distanceMeters: number;
  /** Ordered polyline points. Phase A: just [from, to]. */
  points: Coordinates[];
}

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

interface NominatimHit {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
}

/**
 * Search for places by free text, biased toward `region` when given.
 * Returns [] on network error so the picker degrades gracefully.
 */
export async function searchPlaces(
  query: string,
  region?: MapRegion,
): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  if (HitherMaps) {
    try {
      return await HitherMaps.searchPlaces(trimmed, region);
    } catch {
      // fall through to the Nominatim implementation
    }
  }

  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    addressdetails: '0',
    limit: '8',
  });
  const viewbox = viewboxParam(region);
  if (viewbox) {
    params.set('viewbox', viewbox);
    params.set('bounded', '0'); // bias, don't hard-restrict
  }

  try {
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
  } catch {
    return [];
  }
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Directions between two points. Phase A returns a straight-line estimate
 * (haversine + a 2-point polyline); a native module can replace this with a
 * real routed path without changing callers.
 */
export async function getDirections(
  from: Coordinates,
  to: Coordinates,
): Promise<DirectionsResult> {
  if (HitherMaps) {
    try {
      return await HitherMaps.getDirections(from, to);
    } catch {
      // fall through to the straight-line estimate
    }
  }
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const distanceMeters = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
  return { distanceMeters, points: [from, to] };
}
