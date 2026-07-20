import type { Coordinates } from '../types';

export interface CoordinateDestinationInput {
  title: string;
  coordinates: Coordinates;
}

export type CoordinateValidationError = 'empty_title' | 'invalid_coords';

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
  const latitude = Number.parseFloat(latText.trim());
  const longitude = Number.parseFloat(lngText.trim());
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
