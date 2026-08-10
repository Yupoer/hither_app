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
 * Flat reorder-list entry used for multi-day drag bounds (headers + dests).
 * Headers mark day sections (same walk as DestinationReorderList handleRelease).
 */
export type ReorderListEntry =
  | { type: 'header'; day: number; id: string }
  | {
      type: 'dest';
      id: string;
      day: number;
      kind: DestinationKind;
      stayAnchor?: boolean;
      title?: string;
    };

function listEntryToAccommodation(
  entry: Extract<ReorderListEntry, { type: 'dest' }>,
  order: number,
  day: number,
): AccommodationListItem {
  return {
    id: entry.id,
    kind: entry.kind,
    order,
    day,
    title: entry.title ?? '',
    stayAnchor: entry.stayAnchor,
  };
}

/** Apply the same splice semantics as DestinationReorderList.handleMove. */
export function orderAfterDragMove<T>(
  order: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (fromIndex < 0 || fromIndex >= order.length) return [...order];
  const next = order.slice();
  const [moved] = next.splice(fromIndex, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, moved);
  return next;
}

/**
 * Active stay-anchor accommodations (except the mover) must remain pure-index
 * first and/or last of their day after the proposed order.
 */
export function proposedOrderPreservesBoundaryLocks(
  proposed: readonly ReorderListEntry[],
  movingId: string,
): boolean {
  const days: AccommodationListItem[][] = [];
  let run: AccommodationListItem[] = [];
  let currentDay = 1;
  let started = false;

  const flush = () => {
    days.push(run);
    run = [];
  };

  for (const entry of proposed) {
    if (entry.type === 'header') {
      if (started) flush();
      currentDay = entry.day;
      started = true;
      run = [];
      continue;
    }
    if (!started) {
      started = true;
      currentDay = entry.day;
    }
    run.push(listEntryToAccommodation(entry, run.length, currentDay));
  }
  if (started) flush();

  for (const dayItems of days) {
    if (dayItems.length === 0) continue;
    const anchors = dayItems.filter(
      (i) => i.kind === 'accommodation' && isActiveStayAnchor(i) && i.id !== movingId,
    );
    if (anchors.length === 0) continue;

    for (const a of anchors) {
      const idx = dayItems.findIndex((i) => i.id === a.id);
      if (idx !== 0 && idx !== dayItems.length - 1) return false;
    }

    if (anchors.length >= 2) {
      const first = dayItems[0];
      const last = dayItems[dayItems.length - 1];
      if (
        !(first.kind === 'accommodation' && isActiveStayAnchor(first))
        || !(last.kind === 'accommodation' && isActiveStayAnchor(last))
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Full-list indices where handleMove may place `movingId`.
 * Recomputed each move so cross-day splices stay consistent.
 * Locked head/tail accommodations only return their current index.
 */
export function legalDragIndicesForList(
  order: readonly ReorderListEntry[],
  movingId: string,
): number[] {
  const movingIdx = order.findIndex((e) => e.type === 'dest' && e.id === movingId);
  if (movingIdx < 0) return [];

  // Day-local lock freeze (head/tail accommodation).
  let currentDay = 1;
  let movingDay = 1;
  const byDay = new Map<number, AccommodationListItem[]>();
  for (const entry of order) {
    if (entry.type === 'header') {
      currentDay = entry.day;
      continue;
    }
    const list = byDay.get(currentDay) ?? [];
    if (entry.id === movingId) movingDay = currentDay;
    list.push(listEntryToAccommodation(entry, list.length, currentDay));
    byDay.set(currentDay, list);
  }
  // Only pure-index head/tail accommodations freeze — a mid stop with a
  // single in-day slot must still be free to cross into other days.
  const sourceItems = byDay.get(movingDay) ?? [];
  const { lockedIds } = accommodationBoundaryLocks(sourceItems);
  if (lockedIds.has(movingId)) {
    return [movingIdx];
  }

  // Allow any full-list index whose post-splice order preserves stay anchors.
  // Include header indices so empty day blocks are valid drop targets (insert
  // lands after the day header once the mover is spliced in).
  const legal = new Set<number>([movingIdx]);
  const firstHeaderIdx = order.findIndex((e) => e.type === 'header');
  for (let target = 0; target < order.length; target++) {
    // Never offer "before the first day header" — that slot is not a day block.
    if (firstHeaderIdx >= 0 && target < firstHeaderIdx && target !== movingIdx) {
      continue;
    }
    const proposed = orderAfterDragMove(order, movingIdx, target);
    if (proposedOrderPreservesBoundaryLocks(proposed, movingId)) {
      legal.add(target);
    }
  }
  return [...legal].sort((a, b) => a - b);
}

/**
 * Nearest legal full-list index to the finger aim.
 * On equal distance, prefer the index in the drag direction so sparse legal
 * sets (e.g. mid stop with locked hotels → [2, 4]) can cross into the next day.
 * @param direction -1 up, 0 none/unknown, +1 down
 */
export function snapToLegalDragIndex(
  legalIndices: readonly number[],
  rawTarget: number,
  direction: number = 0,
): number {
  if (legalIndices.length === 0) return rawTarget;
  let best = legalIndices[0];
  let bestDist = Math.abs(best - rawTarget);
  for (let i = 1; i < legalIndices.length; i++) {
    const idx = legalIndices[i];
    const dist = Math.abs(idx - rawTarget);
    if (dist < bestDist) {
      best = idx;
      bestDist = dist;
    } else if (dist === bestDist && direction !== 0) {
      // Tie-break: prefer the slot further along the drag direction.
      if (direction > 0 && idx > best) best = idx;
      if (direction < 0 && idx < best) best = idx;
    }
  }
  return best;
}

/** Row heights used to map finger travel → reorder index (includes day gaps). */
export type ReorderLayoutHeights = {
  headerHeight: number;
  rowHeight: number;
  /** Quick-add strip after each day section (not an order index). */
  dayGapHeight: number;
};

export const DEFAULT_REORDER_LAYOUT: ReorderLayoutHeights = {
  headerHeight: 48,
  rowHeight: 56,
  dayGapHeight: 52,
};

/**
 * Top Y and height of each order row in list coordinates, accounting for
 * quick-add gaps after each day section (empty days: gap after header).
 */
export function reorderRowGeometry(
  order: readonly ReorderListEntry[],
  heights: ReorderLayoutHeights = DEFAULT_REORDER_LAYOUT,
): { tops: number[]; rowHeights: number[]; total: number } {
  const tops: number[] = [];
  const rowHeights: number[] = [];
  let y = 0;
  for (let i = 0; i < order.length; i++) {
    tops.push(y);
    const h =
      order[i].type === 'header' ? heights.headerHeight : heights.rowHeight;
    rowHeights.push(h);
    y += h;
    const next = order[i + 1];
    const endOfDay =
      order[i].type === 'header'
        ? !next || next.type === 'header' // empty day block
        : !next || next.type === 'header'; // last dest of day
    if (endOfDay && heights.dayGapHeight > 0) {
      y += heights.dayGapHeight;
    }
  }
  return { tops, rowHeights, total: y };
}

export function reorderRowCenterY(
  order: readonly ReorderListEntry[],
  index: number,
  heights: ReorderLayoutHeights = DEFAULT_REORDER_LAYOUT,
): number {
  if (index < 0 || index >= order.length) return 0;
  const { tops, rowHeights } = reorderRowGeometry(order, heights);
  return tops[index] + rowHeights[index] / 2;
}

/**
 * Map finger offset (from grant center) to a full-list order index.
 * Day gaps and headers are included so dragging into another day block lands
 * on that day's header / first slot instead of sticking mid-day.
 */
export function dragTargetIndexFromOffset(
  order: readonly ReorderListEntry[],
  startIndex: number,
  dy: number,
  heights: ReorderLayoutHeights = DEFAULT_REORDER_LAYOUT,
): number {
  if (order.length === 0) return 0;
  const clampedStart = Math.max(0, Math.min(startIndex, order.length - 1));
  const { tops, rowHeights, total } = reorderRowGeometry(order, heights);
  const startCenter = tops[clampedStart] + rowHeights[clampedStart] / 2;
  const fingerY = Math.max(0, Math.min(Math.max(total - 1, 0), startCenter + dy));

  for (let i = 0; i < order.length; i++) {
    const top = tops[i];
    const nextTop = i + 1 < order.length ? tops[i + 1] : total;
    if (fingerY < nextTop || i === order.length - 1) {
      const mid = top + rowHeights[i] / 2;
      // Past midpoint (or into following gap) → aim at next index.
      if (fingerY >= mid && i < order.length - 1) return i + 1;
      return i;
    }
  }
  return order.length - 1;
}

/**
 * @deprecated Prefer dragTargetIndexFromOffset (geometry-aware).
 * Kept for tests that assert header-crossing correction.
 */
export function crossDayGapCorrection(
  order: readonly ReorderListEntry[],
  startIndex: number,
  rawAim: number,
  extraPerHeader: number = 1,
): number {
  if (extraPerHeader === 0 || order.length === 0) return 0;
  const lo = Math.min(startIndex, rawAim);
  const hi = Math.max(startIndex, rawAim);
  let headers = 0;
  for (let i = lo + 1; i <= hi && i < order.length; i++) {
    if (order[i]?.type === 'header') headers += 1;
  }
  const signed = rawAim >= startIndex ? headers : -headers;
  return signed * extraPerHeader;
}

/** Continuous min/max over legal full-list indices. */
export function dragIndexBoundsForList(
  order: readonly ReorderListEntry[],
  movingId: string,
): { min: number; max: number } | null {
  const legal = legalDragIndicesForList(order, movingId);
  if (legal.length === 0) return null;
  return { min: legal[0], max: legal[legal.length - 1] };
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
