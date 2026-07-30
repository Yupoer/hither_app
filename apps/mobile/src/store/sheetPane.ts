import type { SheetPaneKey } from './types';
import { SHEET_PANE_ORDER } from './types';

/** Fixed four-pane order index. */
export function paneIndex(key: SheetPaneKey): number {
  return SHEET_PANE_ORDER.indexOf(key);
}

export function paneAt(index: number): SheetPaneKey | null {
  if (index < 0 || index >= SHEET_PANE_ORDER.length) return null;
  return SHEET_PANE_ORDER[index]!;
}

/**
 * Next pane from horizontal content swipe.
 * dx > 0 (finger right) → previous pane; dx < 0 → next pane.
 * No wrap at ends.
 */
export function paneAfterSwipe(
  current: SheetPaneKey,
  dx: number,
  threshold = 48,
): SheetPaneKey {
  if (Math.abs(dx) < threshold) return current;
  const idx = paneIndex(current);
  if (dx < 0) {
    return paneAt(Math.min(SHEET_PANE_ORDER.length - 1, idx + 1)) ?? current;
  }
  return paneAt(Math.max(0, idx - 1)) ?? current;
}

/**
 * Whether a horizontal gesture should switch panes.
 * Requires dominant horizontal movement so vertical sheet drag / scroll wins.
 */
export function isHorizontalPaneGesture(
  dx: number,
  dy: number,
  threshold = 48,
  dominance = 1.2,
): boolean {
  return Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * dominance;
}

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
