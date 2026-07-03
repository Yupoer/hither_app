/**
 * Detent math for the pull-up sheet — pure so the settle behaviour has a unit
 * test (src/__tests__/sheetMath.test.ts) without mocking react-native.
 */

// Settle tuning. `vy` is px/ms. A release past MOVE_MIN/VEL_MIN always
// advances at least one detent in its direction (VEL_STRONG jumps two);
// PROJECT_MS lets a long slow drag cross extra detents by projection.
const PROJECT_MS = 160;
const MOVE_MIN = 14;
const VEL_MIN = 0.2;
const VEL_STRONG = 0.9;

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
 * Detent a released drag settles on. Directional: an intentional gesture
 * never snaps back the way it came — it advances at least one detent in its
 * direction (two on a strong fling), while a sub-threshold wobble stays put.
 */
export function settleTarget(
  g: { dy: number; vy: number },
  startH: number,
  detents: number[],
): number {
  const last = detents.length - 1;
  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  const startIdx = nearestDetent(startH, detents);
  if (Math.abs(g.dy) <= MOVE_MIN && Math.abs(g.vy) <= VEL_MIN) return startIdx;
  const dir = g.dy < 0 || (g.dy === 0 && g.vy < 0) ? 1 : -1; // up = taller
  const proj = nearestDetent(startH - g.dy - g.vy * PROJECT_MS, detents);
  const floor = clamp(startIdx + dir * (Math.abs(g.vy) > VEL_STRONG ? 2 : 1));
  return clamp(dir > 0 ? Math.max(floor, proj) : Math.min(floor, proj));
}
