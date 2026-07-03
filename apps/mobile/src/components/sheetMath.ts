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
 * Detent a released drag settles on — Apple Maps rules, velocity first:
 *
 * - A flick (|vy| > VEL_FLICK) steps EXACTLY one detent in the flick's
 *   direction, even against the drag's net displacement — flicking back
 *   toward where you started returns you there.
 * - Otherwise the sheet settles on the detent nearest its released height:
 *   past the midpoint carries forward, short of it snaps back. Never stuck
 *   in between.
 *
 * Stepwise is preserved structurally: the live drag is clamped to the start
 * detent's neighbours, so the nearest detent is at most one step away and a
 * fling can never skip a stage.
 */
export function settleTarget(
  g: { vy: number },
  endH: number,
  startIdx: number,
  detents: number[],
): number {
  const last = detents.length - 1;
  if (Math.abs(g.vy) > VEL_FLICK) {
    const dir = g.vy < 0 ? 1 : -1; // finger up (vy < 0) = taller
    return Math.max(0, Math.min(last, startIdx + dir));
  }
  return nearestDetent(endH, detents);
}
