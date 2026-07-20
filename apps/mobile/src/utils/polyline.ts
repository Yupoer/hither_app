import type { Coordinates } from '../types';

/**
 * Decode a Google encoded polyline into coordinates.
 * Empty or truncated input yields `[]` (no partial route).
 * Precision is the standard 1e-5 scaling used by Google Directions/Routes.
 */
export function decodePolyline(encoded: string): Coordinates[] {
  if (!encoded || typeof encoded !== 'string') {
    return [];
  }

  const coordinates: Coordinates[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;

  try {
    while (index < len) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        if (index >= len) return [];
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      result = 0;
      shift = 0;
      do {
        if (index >= len) return [];
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      coordinates.push({
        latitude: lat / 1e5,
        longitude: lng / 1e5,
      });
    }
  } catch {
    return [];
  }

  return coordinates;
}
