/**
 * Shared place identity helpers for daily accommodation + account favorites.
 * Exact-match uses name + normalized coordinates (6 decimal places ≈ 0.1 m).
 */

import type { Coordinates } from '../types';

/** Round lat/lng to a stable precision used for uniqueness / dedupe. */
export const PLACE_COORD_DECIMALS = 6;

export function normalizeCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** PLACE_COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

export function normalizeCoordinates(coords: Coordinates): Coordinates {
  return {
    latitude: normalizeCoordinate(coords.latitude),
    longitude: normalizeCoordinate(coords.longitude),
  };
}

export function normalizePlaceName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Stable string key for exact-match (name + normalized coords). */
export function placeExactMatchKey(
  name: string,
  coords: Coordinates,
): string {
  const n = normalizePlaceName(name).toLowerCase();
  const c = normalizeCoordinates(coords);
  return `${n}|${c.latitude.toFixed(PLACE_COORD_DECIMALS)}|${c.longitude.toFixed(PLACE_COORD_DECIMALS)}`;
}

/** Coordinate-only key for map marker dedupe after identity. */
export function coordinateDedupeKey(coords: Coordinates): string {
  const c = normalizeCoordinates(coords);
  return `${c.latitude.toFixed(PLACE_COORD_DECIMALS)}|${c.longitude.toFixed(PLACE_COORD_DECIMALS)}`;
}
