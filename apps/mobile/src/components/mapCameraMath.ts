/** Default region span used by centerOn / recenter. */
export const DEFAULT_LATITUDE_DELTA = 0.01;

/** Street-level camera used for locate-me. */
export const LOCATE_ZOOM = 16.5;
export const LOCATE_ALTITUDE = 900;

/** Wider framing when jumping to a searched / newly added place. */
export const PLACE_ZOOM = 14;
export const PLACE_ALTITUDE = 2500;

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
