/**
 * Sheet pane pure helpers still used by production UI.
 * - tabScrollOffsetForSelection → Segmented (settings / dense controls)
 * - coverFlowSnapIndex → PaneCoverFlow (main members/route/tools/store)
 */

/**
 * Scroll offset so that selected tab is fully visible in a 3-slot viewport.
 * Each tab has equal width `tabWidth`; viewport shows `viewportCount` tabs.
 */
export function tabScrollOffsetForSelection(input: {
  selectedIndex: number;
  tabWidth: number;
  viewportCount: number;
  totalCount: number;
}): number {
  const { selectedIndex, tabWidth, viewportCount, totalCount } = input;
  if (tabWidth <= 0 || totalCount <= viewportCount) return 0;
  const maxOffset = Math.max(0, (totalCount - viewportCount) * tabWidth);
  // Prefer selected tab as middle of the 3-slot window when possible.
  const ideal = (selectedIndex - Math.floor((viewportCount - 1) / 2)) * tabWidth;
  return Math.max(0, Math.min(maxOffset, ideal));
}

/**
 * CoverFlow snap: finger right (positive translationX) → previous index;
 * finger left → next. No wrap. Sub-threshold / cancel returns current.
 */
export function coverFlowSnapIndex(input: {
  currentIndex: number;
  translationX: number;
  velocityX?: number;
  itemCount: number;
  /** Min |tx| to step one page without fling. */
  threshold?: number;
  /** Min |vx| (px/s) to fling one step when |tx| is small. */
  flingVelocity?: number;
}): number {
  const {
    currentIndex,
    translationX,
    velocityX = 0,
    itemCount,
    threshold = 48,
    flingVelocity = 600,
  } = input;
  if (itemCount <= 0) return 0;
  const clampIdx = (i: number) => Math.max(0, Math.min(itemCount - 1, i));
  let delta = 0;
  if (Math.abs(translationX) >= threshold) {
    delta = translationX < 0 ? 1 : -1;
  } else if (Math.abs(velocityX) >= flingVelocity) {
    delta = velocityX < 0 ? 1 : -1;
  }
  // Multi-step for long drags (~card step ≈ threshold*1.5 for CoverFlow spacing).
  if (Math.abs(translationX) >= threshold * 2) {
    const steps = Math.round(Math.abs(translationX) / (threshold * 1.5));
    delta = (translationX < 0 ? 1 : -1) * Math.max(1, steps);
  }
  return clampIdx(currentIndex + delta);
}

/** Steps crossed when snapping from `from` to `to` (for one haptic per index). */
export function coverFlowHapticSteps(from: number, to: number): number {
  return Math.abs(to - from);
}

/** CoverFlow / BottomSheet exclusive offset constants (mirrored in components). */
export const COVERFLOW_ACTIVE_OFFSET_X = 12 as const;
export const COVERFLOW_FAIL_OFFSET_Y = 14 as const;
export const SHEET_FAIL_OFFSET_X = 16 as const;
export const SHEET_ACTIVE_OFFSET_Y = 8 as const;
