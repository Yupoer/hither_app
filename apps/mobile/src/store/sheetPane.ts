/**
 * Sheet pane pure helpers still used by production UI.
 * - tabScrollOffsetForSelection → Segmented (settings / dense controls)
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

/** BottomSheet vertical activation and horizontal failure thresholds. */
export const SHEET_FAIL_OFFSET_X = 16 as const;
export const SHEET_ACTIVE_OFFSET_Y = 8 as const;
