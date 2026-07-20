import type { Coordinates } from '../types';

export interface CoordinateDestinationInput {
  title: string;
  coordinates: Coordinates;
}

export type CoordinateValidationError = 'empty_title' | 'invalid_coords';

const COORDINATE_PAIR_RE =
  /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/;

/** Parse the comma-separated latitude, longitude format copied from Google Maps. */
export function parseCoordinatePair(text: string): Coordinates | null {
  const match = COORDINATE_PAIR_RE.exec(text);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

/**
 * Pure validation for lat/lng destination form fields.
 * Latitude must be −90..90; longitude −180..180; title non-empty after trim.
 */
export function validateCoordinateDestination(
  title: string,
  latText: string,
  lngText: string,
):
  | { ok: true; input: CoordinateDestinationInput }
  | { ok: false; error: CoordinateValidationError } {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return { ok: false, error: 'empty_title' };
  }
  const pastedPair = !lngText.trim()
    ? parseCoordinatePair(latText)
    : !latText.trim()
      ? parseCoordinatePair(lngText)
      : null;
  const latitude = pastedPair?.latitude ?? Number.parseFloat(latText.trim());
  const longitude = pastedPair?.longitude ?? Number.parseFloat(lngText.trim());
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { ok: false, error: 'invalid_coords' };
  }
  return {
    ok: true,
    input: {
      title: trimmedTitle,
      coordinates: { latitude, longitude },
    },
  };
}
