import type { Coordinates } from '../types';

/** Default region span used by centerOn / recenter. */
export const DEFAULT_LATITUDE_DELTA = 0.01;

/** Safe first camera while a newly-created group has no locations yet. */
export const DEFAULT_MAP_CENTER: Coordinates = {
  latitude: 25.0478,
  longitude: 121.517,
};

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Always return a native-map-safe region, including an empty new group. */
export function initialRegionFor(
  center?: Coordinates,
  latOffset = 0,
): MapRegion {
  const target = center ?? DEFAULT_MAP_CENTER;
  return {
    latitude: target.latitude - latOffset,
    longitude: target.longitude,
    latitudeDelta: DEFAULT_LATITUDE_DELTA,
    longitudeDelta: DEFAULT_LATITUDE_DELTA,
  };
}

/** Locate-me camera — neighborhood scale (not street-close). */
export const LOCATE_ZOOM = 15;
export const LOCATE_ALTITUDE = 1600;

/** Framing when jumping to a searched / newly added place — wider still. */
export const PLACE_ZOOM = 13;
export const PLACE_ALTITUDE = 4000;

/**
 * Latitude shift so a target pin lands at the vertical midpoint of the
 * unobstructed band between topPad (carousel) and bottomPad (sheet).
 * Positive → pin appears above geometric screen center.
 */
export function latOffsetForVisibleBand(
  latitudeDelta: number,
  topPad: number,
  bottomPad: number,
  windowHeight: number,
): number {
  if (windowHeight <= 0) return 0;
  return (latitudeDelta * (bottomPad - topPad)) / (2 * windowHeight);
}
