/**
 * Maps boundary — place search and directions.
 *
 * This is the ONLY module the JS layer uses for geocoding / place search.
 * Per the "Apple Maps 搜尋" decision (hybrid plan A): Phase A ships a pure-JS
 * fallback that runs in Expo Go on any platform. A native module
 * (`apps/mobile/modules/hither-maps`, Phase B) can later back the SAME
 * interface with Apple MapKit / Google Places for better quality on a Dev Build.
 *
 * JS fallback quality (no budget / no API key):
 *  - Photon (https://photon.komoot.io) is the primary geocoder — it does
 *    typeahead + fuzzy matching and biases by lat/lon, so it beats plain
 *    Nominatim for the "type a place name" case.
 *  - Nominatim (OpenStreetMap) is the fallback when Photon returns nothing.
 *  - Both re-rank by real (haversine) distance from the user's viewport.
 *
 * Usage policy: both are free shared instances — low volume only, send a
 * descriptive User-Agent, and debounce callers. Self-host if volume grows.
 *
 * Phase B seam: the custom native module `HitherMaps`
 * (`apps/mobile/modules/hither-maps`) can back these with Apple MapKit on a
 * Dev Build; absent in Expo Go, where the fallback below runs.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Coordinates } from '../types';
import { distanceMeters } from '../utils/geo';

/** Custom native module; `null` in Expo Go / when not built. */
const HitherMaps = requireOptionalNativeModule<{
  searchPlaces(query: string, region?: MapRegion): Promise<PlaceResult[]>;
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

/** Primary: Photon typeahead/fuzzy geocoder, biased to the viewport centre. */
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

/** Fallback: Nominatim, localised and viewport-biased. */
async function searchNominatim(
  query: string,
  region?: MapRegion,
): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '0',
    limit: '10',
    // Prefer local/Chinese place names over the English transliteration.
    'accept-language': 'zh-TW,zh,en',
  });
  const viewbox = viewboxParam(region);
  if (viewbox) {
    params.set('viewbox', viewbox);
    // Short queries are ambiguous — keep them inside the viewport; longer,
    // more specific queries just bias so a named far-away place still shows.
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
      // fall through to the JS implementation
    }
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
