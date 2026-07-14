/** Default region span used by centerOn / recenter. */
export const DEFAULT_LATITUDE_DELTA = 0.01;

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
