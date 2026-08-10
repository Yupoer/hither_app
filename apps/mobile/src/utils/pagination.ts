/**
 * Indices of dots to render for a paged indicator, capped at `maxVisible`.
 * The active dot stays centered in the window until the window would run
 * off either edge, where it clamps instead — the window only starts sliding
 * once the active page is within half a window of the start/end (classic
 * App Store-style paging dots).
 */
export function dotWindow(total: number, active: number, maxVisible: number): number[] {
  if (total <= maxVisible) {
    return Array.from({ length: total }, (_, i) => i);
  }
  const half = Math.floor(maxVisible / 2);
  const start = Math.min(Math.max(active - half, 0), total - maxVisible);
  return Array.from({ length: maxVisible }, (_, i) => start + i);
}

/** First index of the sliding window (same clamp rules as `dotWindow`). */
export function dotWindowStart(total: number, active: number, maxVisible: number): number {
  if (total <= maxVisible) return 0;
  const half = Math.floor(maxVisible / 2);
  return Math.min(Math.max(active - half, 0), total - maxVisible);
}

/** Active index relative to the visible window (0-based). */
export function dotWindowRelative(
  total: number,
  active: number,
  maxVisible: number,
): number {
  return active - dotWindowStart(total, active, maxVisible);
}

/** Pitch (px) of one inactive dot + gap — used for strip slide animation. */
export const DOT_PITCH_PX = 12; // 6px dot + 6px gap (matches MapScreen styles)
