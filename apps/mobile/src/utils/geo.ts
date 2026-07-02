import type { Coordinates } from '../types';

/** Mean walking speed in metres per second (~5 km/h), per the design's "walk" ETA. */
const WALKING_SPEED_MPS = 1.4;

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle (haversine) distance between two coordinates, in metres.
 * Good enough for the short walking distances the MVP shows.
 */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Estimated walking time in seconds for a given distance in metres. */
export function walkingEtaSeconds(distanceM: number): number {
  return distanceM / WALKING_SPEED_MPS;
}

/** Format a distance for display, e.g. "320 m" or "1.2 km". */
export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) {
    return `${Math.round(distanceM)} m`;
  }
  return `${(distanceM / 1000).toFixed(1)} km`;
}
