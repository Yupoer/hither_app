import type { Coordinates } from '../types';

/** Mean walking speed in metres per second (~5 km/h), per the design's "walk" ETA. */
const WALKING_SPEED_MPS = 1.4;

export type TravelMode = 'walk' | 'drive' | 'transit';

// Rough average speeds (m/s) for the nav-mode switcher's ETA estimate — no
// live routing API yet, so these are ballpark urban averages (drive accounts
// for lights/traffic, transit for stops/waiting), not turn-by-turn ETAs.
const TRAVEL_SPEED_MPS: Record<TravelMode, number> = {
  walk: WALKING_SPEED_MPS,
  drive: 10,
  transit: 6.5,
};

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

/** Estimated travel time in seconds for a given distance and travel mode. */
export function etaSecondsFor(distanceM: number, mode: TravelMode): number {
  return distanceM / TRAVEL_SPEED_MPS[mode];
}

/** Format a distance for display, e.g. "320 m" or "1.2 km". */
export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) {
    return `${Math.round(distanceM)} m`;
  }
  return `${(distanceM / 1000).toFixed(1)} km`;
}

/**
 * Compact duration from whole minutes (≥60):
 * 90 → "1hr30", 300 → "5hr", 2160 → "1d12hr".
 * Day scale drops remaining minutes (25h30 → "1d1hr").
 */
export function formatCompactDurationFromMinutes(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) {
    return mm === 0 ? `${h}hr` : `${h}hr${mm}`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `${d}d` : `${d}d${rh}hr`;
}

/**
 * Short ETA for cards / flock rows / Live Activity parity:
 * "now", "12 min", "1hr30", "5hr", "1d12hr".
 */
export function formatShortEta(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  return formatCompactDurationFromMinutes(m);
}
