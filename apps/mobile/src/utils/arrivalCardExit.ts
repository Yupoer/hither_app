/**
 * Gathering-card exit after all-arrived / stop complete (#149).
 *
 * Hold the arrival effect 3.2s, then fade/slide the whole card for 440ms,
 * then allow removal from the active list. Idempotent per destination id.
 */

export const ARRIVAL_EFFECT_HOLD_MS = 3_200;
export const ARRIVAL_CARD_EXIT_MS = 440;

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
};

/**
 * Start exit for a completed destination. Returns null if already tracked
 * (duplicate complete / refresh must not restart the sequence).
 */
export function beginArrivalCardExit(
  existing: ReadonlyMap<string, ArrivalCardExitRecord>,
  destinationId: string,
  nowMs: number,
): ArrivalCardExitRecord | null {
  if (existing.has(destinationId)) return null;
  return {
    destinationId,
    startedAtMs: nowMs,
    phase: 'hold',
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
 * Merge open destinations with cards still in hold/exit so closed_at cannot
 * skip the animation by filtering them out immediately.
 */
export function mergeExitingDestinations<T extends { id: string }>(
  openDestinations: readonly T[],
  exitingSnapshots: ReadonlyMap<string, T>,
  exitRecords: ReadonlyMap<string, ArrivalCardExitRecord>,
): T[] {
  const openIds = new Set(openDestinations.map((d) => d.id));
  const merged = [...openDestinations];
  for (const [id, record] of exitRecords) {
    if (record.phase === 'done') continue;
    if (openIds.has(id)) continue;
    const snap = exitingSnapshots.get(id);
    if (snap) merged.push(snap);
  }
  return merged;
}
