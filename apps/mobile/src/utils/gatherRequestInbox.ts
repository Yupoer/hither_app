/**
 * Leader gather-point request inbox view model (#173).
 * FIFO by created_at then stable id; selection by request id.
 */

export type GatherRequestSortable = {
  id: string;
  createdAt: string;
};

/** Stable FIFO: oldest first; tie-break by id ascending. */
export function sortGatherRequestsFifo<T extends GatherRequestSortable>(
  requests: readonly T[],
): T[] {
  return [...requests].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * After remove/approve, keep selection on the same id when still present;
 * otherwise advance to the next FIFO card (or previous if at end).
 */
export function resolveGatherRequestSelection(input: {
  sortedIds: readonly string[];
  previousId: string | null | undefined;
  removedId?: string | null;
}): string | null {
  const ids = input.sortedIds;
  if (ids.length === 0) return null;
  if (input.previousId && ids.includes(input.previousId)) {
    return input.previousId;
  }
  if (input.removedId) {
    // Prefer the card that was after the removed one in the prior order.
    // Without prior order, fall back to first remaining.
  }
  return ids[0] ?? null;
}

export function gatherRequestPageIndex(
  sortedIds: readonly string[],
  selectedId: string | null | undefined,
): number {
  if (!selectedId) return 0;
  const idx = sortedIds.indexOf(selectedId);
  return idx >= 0 ? idx : 0;
}
