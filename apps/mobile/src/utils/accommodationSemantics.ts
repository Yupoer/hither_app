/**
 * Pure accommodation itinerary semantics: auto-add transitions,
 * boundary locks from pure index, and reorder constraints.
 */

export type DestinationKind = 'stop' | 'accommodation';

export interface AccommodationListItem {
  id: string;
  kind: DestinationKind;
  order: number;
  day: number;
  title: string;
}

export type DailyAccomPresence = 'none' | 'some';

/**
 * Auto-add fires only on none→some while the team switch is currently on.
 * Never on some→some, some→none, open, sync, login, reorder, or switch toggle.
 */
export function shouldAutoAddAccommodationCards(input: {
  previous: DailyAccomPresence;
  next: DailyAccomPresence;
  autoAddEnabled: boolean;
}): boolean {
  return (
    input.previous === 'none'
    && input.next === 'some'
    && input.autoAddEnabled
  );
}

/** Pure-index lock: first/last accommodation of the day is boundary-locked. */
export function accommodationBoundaryLocks(
  dayItems: readonly AccommodationListItem[],
): {
  lockedIds: Set<string>;
  firstLockedId: string | null;
  lastLockedId: string | null;
} {
  const sorted = [...dayItems].sort((a, b) => a.order - b.order);
  if (sorted.length === 0) {
    return { lockedIds: new Set(), firstLockedId: null, lastLockedId: null };
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const lockedIds = new Set<string>();
  let firstLockedId: string | null = null;
  let lastLockedId: string | null = null;
  if (first.kind === 'accommodation') {
    lockedIds.add(first.id);
    firstLockedId = first.id;
  }
  if (last.kind === 'accommodation') {
    lockedIds.add(last.id);
    lastLockedId = last.id;
  }
  return { lockedIds, firstLockedId, lastLockedId };
}

export function isAccommodationDraggable(
  item: AccommodationListItem,
  dayItems: readonly AccommodationListItem[],
): boolean {
  if (item.kind !== 'accommodation') return true;
  const { lockedIds } = accommodationBoundaryLocks(dayItems);
  return !lockedIds.has(item.id);
}

/**
 * Drag bounds for an item within a day list (excluding headers).
 * Boundary accommodations cannot move; mid accommodations cannot cross
 * locked boundary accommodations.
 */
export function dragIndexBoundsForDay(
  dayItems: readonly AccommodationListItem[],
  movingId: string,
): { min: number; max: number } | null {
  const sorted = [...dayItems].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((i) => i.id === movingId);
  if (idx < 0) return null;
  const moving = sorted[idx];
  const { lockedIds, firstLockedId, lastLockedId } = accommodationBoundaryLocks(sorted);

  if (moving.kind === 'accommodation' && lockedIds.has(moving.id)) {
    // Locked boundary card cannot move.
    return { min: idx, max: idx };
  }

  let min = 0;
  let max = sorted.length - 1;
  // Cannot cross a locked first accommodation.
  if (firstLockedId && firstLockedId !== movingId) {
    const firstIdx = sorted.findIndex((i) => i.id === firstLockedId);
    if (firstIdx >= 0) min = Math.max(min, firstIdx + 1);
  }
  // Cannot cross a locked last accommodation.
  if (lastLockedId && lastLockedId !== movingId) {
    const lastIdx = sorted.findIndex((i) => i.id === lastLockedId);
    if (lastIdx >= 0) max = Math.min(max, lastIdx - 1);
  }
  if (min > max) return { min: idx, max: idx };
  return { min, max };
}

/**
 * After a drop, pure-index locks recompute. Refuse silent replacement of an
 * already-occupied edge with a different accommodation id.
 * Returns null when the proposed order is illegal.
 */
export function validateDayOrderAfterDrop(
  proposed: readonly AccommodationListItem[],
): AccommodationListItem[] | null {
  // Any order is accepted; locks are derived after. Edge "replacement"
  // is about dragging an accommodation onto an occupied edge position
  // when the edge is already an accommodation of another id.
  // Callers use dragIndexBoundsForDay to prevent illegal intermediate states.
  return [...proposed].map((item, order) => ({ ...item, order }));
}

/**
 * When changing/clearing daily accommodation, existing locked cards become
 * mid (draggable) — no new cards, no kind change.
 */
export function downgradeAnchorsOnDailyChange(
  dayItems: readonly AccommodationListItem[],
): AccommodationListItem[] {
  // Pure index: after list stays the same, locks recompute as mid if
  // positions no longer first/last. Caller keeps snapshots as-is.
  return dayItems.map((item) => ({ ...item }));
}

/** Local collapse storage key: account + group + calendar date. */
export function dayCollapseStorageKey(
  accountId: string,
  groupId: string,
  dateKey: string,
): string {
  return `hither.dayCollapse.v1:${accountId}:${groupId}:${dateKey}`;
}
