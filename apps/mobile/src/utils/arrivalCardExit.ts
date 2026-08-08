/**
 * Gathering-card exit after all-arrived / stop complete (#149).
 *
 * Hold the arrival effect 3.2s, then fade/slide the whole card for 440ms,
 * then allow removal from the active list. Idempotent per destination id.
 *
 * Personal-arrival flash (1.6s) and completion hold (3.2s) share the same
 * celebrate UI id — completion must cancel any earlier clear timer.
 */

export const ARRIVAL_EFFECT_HOLD_MS = 3_200;
export const ARRIVAL_CARD_EXIT_MS = 440;
/** Brief center-check flash on personal arrival (not the completion hold). */
export const PERSONAL_ARRIVAL_CELEBRATE_MS = 1_600;

export type CelebrateClearStore = Map<string, ReturnType<typeof setTimeout>>;

/**
 * Arm a single clear-timer per destination. Replacing cancels the previous
 * timer so personal 1.6s cannot fire after a 3.2s completion hold starts.
 */
export function armCelebrateClearTimer(
  store: CelebrateClearStore,
  destinationId: string,
  ms: number,
  onClear: () => void,
): void {
  const prev = store.get(destinationId);
  if (prev != null) clearTimeout(prev);
  const timer = setTimeout(() => {
    store.delete(destinationId);
    onClear();
  }, ms);
  store.set(destinationId, timer);
}

/** Cancel personal/completion celebrate clear for one destination. */
export function cancelCelebrateClearTimer(
  store: CelebrateClearStore,
  destinationId: string,
): void {
  const prev = store.get(destinationId);
  if (prev != null) clearTimeout(prev);
  store.delete(destinationId);
}

export function clearAllCelebrateClearTimers(store: CelebrateClearStore): void {
  for (const timer of store.values()) clearTimeout(timer);
  store.clear();
}

export type ArrivalCardExitPhase = 'hold' | 'exit' | 'done';

export function arrivalCardExitPhase(elapsedMs: number): ArrivalCardExitPhase {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'hold';
  if (elapsedMs < ARRIVAL_EFFECT_HOLD_MS) return 'hold';
  if (elapsedMs < ARRIVAL_EFFECT_HOLD_MS + ARRIVAL_CARD_EXIT_MS) return 'exit';
  return 'done';
}

export type ArrivalCardExitRecord = {
  destinationId: string;
  /** Snapshot so the card can render after closedAt filters it out. */
  startedAtMs: number;
  phase: ArrivalCardExitPhase;
  /**
   * Carousel index when exit began — keep the completed card in place through
   * hold/exit so siblings do not jump (#149 multi-card order).
   */
  indexAtStart: number;
};

/**
 * Start exit for a completed destination. Returns null if already tracked
 * (duplicate complete / refresh must not restart the sequence).
 */
export function beginArrivalCardExit(
  existing: ReadonlyMap<string, ArrivalCardExitRecord>,
  destinationId: string,
  nowMs: number,
  indexAtStart = 0,
): ArrivalCardExitRecord | null {
  if (existing.has(destinationId)) return null;
  return {
    destinationId,
    startedAtMs: nowMs,
    phase: 'hold',
    indexAtStart: Math.max(0, Math.floor(indexAtStart)),
  };
}

/**
 * Advance phase from wall-clock elapsed time. Pure — callers schedule timers.
 */
export function advanceArrivalCardExit(
  record: ArrivalCardExitRecord,
  nowMs: number,
): ArrivalCardExitRecord {
  const phase = arrivalCardExitPhase(nowMs - record.startedAtMs);
  if (phase === record.phase) return record;
  return { ...record, phase };
}

/**
 * Index to record when a card begins exit — must come from the full visible
 * carousel (open + already-exiting), never open-only. Open-only indices
 * collide when two cards close while the first is still in hold (#149).
 */
export function resolveExitIndexAtStart(
  visibleOrder: readonly string[],
  destinationId: string,
  fallbackLength: number,
): number {
  const idx = visibleOrder.indexOf(destinationId);
  return idx >= 0 ? idx : Math.max(0, fallbackLength);
}

/**
 * Advance the tracked carousel order after open/exit membership changes.
 * Exiting cards stay ranked until their exit record is removed (done).
 */
export function nextVisibleCarouselOrder(
  previousOrder: readonly string[],
  openIds: readonly string[],
  exitingIds: readonly string[],
): string[] {
  const openSet = new Set(openIds);
  const exitingSet = new Set(exitingIds);
  const keep = previousOrder.filter((id) => openSet.has(id) || exitingSet.has(id));
  for (const id of openIds) {
    if (!keep.includes(id)) keep.push(id);
  }
  for (const id of exitingIds) {
    if (!keep.includes(id)) keep.push(id);
  }
  return keep;
}

/**
 * Merge open destinations with cards still in hold/exit so closed_at cannot
 * skip the animation by filtering them out immediately.
 *
 * Re-inserts each exiting card at its original carousel index (not appended)
 * so completing a middle card keeps siblings stable through hold/exit.
 * When available, `visibleOrder` is the current full carousel order. It is the
 * source of truth after an earlier exit finishes because immutable start
 * indices no longer account for that removed card.
 */
export function mergeExitingDestinations<T extends { id: string }>(
  openDestinations: readonly T[],
  exitingSnapshots: ReadonlyMap<string, T>,
  exitRecords: ReadonlyMap<string, ArrivalCardExitRecord>,
  visibleOrder?: readonly string[],
): T[] {
  const openIds = new Set(openDestinations.map((d) => d.id));
  const merged = [...openDestinations];
  const activeExits: { id: string; snap: T; index: number }[] = [];
  for (const [id, record] of exitRecords) {
    if (record.phase === 'done') continue;
    if (openIds.has(id)) continue;
    const snap = exitingSnapshots.get(id);
    if (!snap) continue;
    activeExits.push({ id, snap, index: record.indexAtStart });
  }

  // A completed earlier exit can disappear before a later exit finishes. In
  // that state its immutable start index is one slot too far right. Rebuild
  // from the tracked full visible order so only the completed card is removed.
  if (visibleOrder && visibleOrder.length > 0) {
    const itemsById = new Map<string, T>();
    for (const destination of openDestinations) {
      itemsById.set(destination.id, destination);
    }
    for (const item of activeExits) {
      itemsById.set(item.id, item.snap);
    }

    const orderedIds: string[] = [];
    const seen = new Set<string>();
    const addIfActive = (id: string) => {
      if (seen.has(id) || !itemsById.has(id)) return;
      seen.add(id);
      orderedIds.push(id);
    };
    for (const id of visibleOrder) addIfActive(id);
    // New destinations can arrive without being in the previous tracked
    // order; retain their current open order rather than dropping them.
    for (const destination of openDestinations) addIfActive(destination.id);
    for (const item of activeExits) addIfActive(item.id);
    return orderedIds.map((id) => itemsById.get(id)!);
  }

  const toInsert: { snap: T; index: number }[] = [];
  for (const item of activeExits) {
    toInsert.push({ snap: item.snap, index: item.index });
  }
  // Ascending original index so earlier cards land first, then later ones.
  toInsert.sort((a, b) => a.index - b.index);
  for (const item of toInsert) {
    const idx = Math.max(0, Math.min(item.index, merged.length));
    merged.splice(idx, 0, item.snap);
  }
  return merged;
}
