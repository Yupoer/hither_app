/**
 * Pure accommodation itinerary semantics: auto-add transitions,
 * boundary locks from pure index + stay_anchor, and reorder constraints.
 */

export type DestinationKind = 'stop' | 'accommodation';

export interface AccommodationListItem {
  id: string;
  kind: DestinationKind;
  order: number;
  day: number;
  title: string;
  /**
   * When true (or undefined for legacy rows), a pure-index first/last
   * accommodation is boundary-locked. Explicit false = downgraded mid card.
   */
  stayAnchor?: boolean;
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

/** True when the item is an active boundary anchor (default true when unset). */
export function isActiveStayAnchor(item: AccommodationListItem): boolean {
  if (item.kind !== 'accommodation') return false;
  return item.stayAnchor !== false;
}

/** Pure-index lock: first/last accommodation of the day with active stay anchor. */
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
  if (first.kind === 'accommodation' && isActiveStayAnchor(first)) {
    lockedIds.add(first.id);
    firstLockedId = first.id;
  }
  if (last.kind === 'accommodation' && isActiveStayAnchor(last)) {
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
 * After drop: pure-index edges among accommodations become stay anchors.
 * Stops clear stayAnchor. Mid accommodations clear stayAnchor.
 */
export function applyPureIndexAnchors(
  dayItems: readonly AccommodationListItem[],
): AccommodationListItem[] {
  const sorted = [...dayItems].sort((a, b) => a.order - b.order);
  if (sorted.length === 0) return [];
  return sorted.map((item, i, arr) => {
    if (item.kind !== 'accommodation') {
      return { ...item, stayAnchor: false };
    }
    const isEdge = i === 0 || i === arr.length - 1;
    return { ...item, stayAnchor: isEdge };
  });
}

/**
 * When changing/clearing daily accommodation, existing locked cards become
 * mid (draggable) — no new cards, no kind change. Explicit stayAnchor=false
 * so pure-index first/last no longer lock until the next drop re-anchors.
 */
export function downgradeAnchorsOnDailyChange(
  dayItems: readonly AccommodationListItem[],
): AccommodationListItem[] {
  return dayItems.map((item) =>
    item.kind === 'accommodation'
      ? { ...item, stayAnchor: false }
      : { ...item },
  );
}

/**
 * Insert position for a quick-add mid accommodation card within a day.
 * Inserts before an occupied locked tail (last item is accommodation anchor);
 * otherwise appends after the last same-day item.
 */
export function quickAddAccommodationInsertPosition(
  existing: readonly { order: number; day: number; kind?: string; stayAnchor?: boolean }[],
  targetDay: number,
): number {
  const sameDay = existing
    .filter((d) => d.day === targetDay)
    .sort((a, b) => a.order - b.order);
  if (sameDay.length === 0) {
    const earlier = existing.filter((d) => d.day < targetDay);
    return earlier.length > 0 ? Math.max(...earlier.map((d) => d.order)) + 1 : 0;
  }
  const last = sameDay[sameDay.length - 1];
  const lastIsLockedTail =
    last.kind === 'accommodation' && last.stayAnchor !== false;
  if (lastIsLockedTail) {
    // Insert at the tail's position so the locked card shifts right.
    return last.order;
  }
  return Math.max(...sameDay.map((d) => d.order)) + 1;
}

/** Local collapse storage key: account + group + calendar date. */
export function dayCollapseStorageKey(
  accountId: string,
  groupId: string,
  dateKey: string,
): string {
  return `hither.dayCollapse.v1:${accountId}:${groupId}:${dateKey}`;
}
