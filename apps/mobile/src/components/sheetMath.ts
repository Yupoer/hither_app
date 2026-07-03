/**
 * Detent math for the pull-up sheet — pure so the settle behaviour has a unit
 * test (src/__tests__/sheetMath.test.ts) without mocking react-native.
 */

// A release past either threshold counts as an intentional step; anything
// smaller is a wobble that snaps back. `vy` is px/ms.
const MOVE_MIN = 14;
const VEL_MIN = 0.2;

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
 * Detent a released drag settles on. Stepwise: an intentional gesture moves
 * EXACTLY one detent in its direction — no fling ever skips a stage (peek
 * must pass mid before full, and back down the same way) — while a
 * sub-threshold wobble stays put.
 */
export function settleTarget(
  g: { dy: number; vy: number },
  startH: number,
  detents: number[],
): number {
  const last = detents.length - 1;
  const startIdx = nearestDetent(startH, detents);
  if (Math.abs(g.dy) <= MOVE_MIN && Math.abs(g.vy) <= VEL_MIN) return startIdx;
  const dir = g.dy < 0 || (g.dy === 0 && g.vy < 0) ? 1 : -1; // up = taller
  return Math.max(0, Math.min(last, startIdx + dir));
}
