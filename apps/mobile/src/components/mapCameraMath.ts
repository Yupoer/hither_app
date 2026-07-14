/** Default region span used by centerOn / recenter. */
export const DEFAULT_LATITUDE_DELTA = 0.01;

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
