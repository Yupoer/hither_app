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

export const DOT_INACTIVE_PX = 6;
export const DOT_ACTIVE_PX = 18;
export const DOT_GAP_PX = 6;

/** Inactive width + gap. Kept for callers that still reason in slot pitch. */
export const DOT_PITCH_PX = DOT_INACTIVE_PX + DOT_GAP_PX;

export interface IndicatorItemGeometry {
  index: number;
  active: boolean;
  width: number;
}

export interface IndicatorRowGeometry {
  items: IndicatorItemGeometry[];
  totalWidth: number;
}

/**
 * Visible indicator items in normal flow. Each item owns its active/inactive
 * width; the row width is the sum of those widths plus gaps. No overlay slot.
 */
export function indicatorRowGeometry(
  total: number,
  active: number,
  maxVisible = 5,
): IndicatorRowGeometry {
  const indexes = dotWindow(total, active, maxVisible);
  const items = indexes.map((index) => {
    const isActive = index === active;
    return {
      index,
      active: isActive,
      width: isActive ? DOT_ACTIVE_PX : DOT_INACTIVE_PX,
    };
  });
  const totalWidth =
    items.reduce((sum, item) => sum + item.width, 0)
    + DOT_GAP_PX * Math.max(0, items.length - 1);
  return { items, totalWidth };
}
