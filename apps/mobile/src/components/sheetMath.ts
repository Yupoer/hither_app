/**
 * Detent math for the pull-up sheet — pure so the settle behaviour has a unit
 * test (src/__tests__/sheetMath.test.ts) without mocking react-native.
 */

// A release flicking faster than this (px/ms) steps one detent in the flick's
// direction no matter how far the drag travelled; below it, position decides.
const VEL_FLICK = 0.35;

/** Index of the detent closest to height `h`. */
export function nearestDetent(h: number, detents: number[]): number {
  let best = 0;
  let bestD = Infinity;
  detents.forEach((d, i) => {
    const dist = Math.abs(d - h);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  });
  return best;
}

/**
 * Detent a released drag settles on — position-based, velocity as a nudge:
 *
 * - Otherwise (no flick) the sheet settles on the detent nearest its
 *   released height, whatever that is — a long drag can cross multiple
 *   stages in one gesture (peek straight to full).
 * - A flick (|vy| > VEL_FLICK) steps one detent past the nearest detent, in
 *   the flick's direction — a quick shove carries one stage further than a
 *   slow release would have landed.
 */
export function settleTarget(
  g: { vy: number },
  endH: number,
  detents: number[],
): number {
  const last = detents.length - 1;
  const nearest = nearestDetent(endH, detents);
  // A flick nudges one detent past where the finger released, in the flick's
  // direction; a slow release settles on whichever detent it's nearest — so a
  // long drag can cross multiple stages at once (peek straight to full).
  if (Math.abs(g.vy) > VEL_FLICK) {
    const dir = g.vy < 0 ? 1 : -1;
    return Math.max(0, Math.min(last, nearest + dir));
  }
  return nearest;
}
