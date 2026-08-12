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
  previousSortedIds?: readonly string[];
}): string | null {
  const ids = input.sortedIds;
  if (ids.length === 0) return null;
  if (input.previousId && ids.includes(input.previousId)) {
    return input.previousId;
  }
  const removed =
    input.removedId
    ?? (input.previousId && !ids.includes(input.previousId) ? input.previousId : null);
  const prior = input.previousSortedIds;
  if (removed && prior && prior.length > 0) {
    const removedIndex = prior.indexOf(removed);
    if (removedIndex >= 0) {
      const nextId = prior[removedIndex + 1];
      if (nextId && ids.includes(nextId)) return nextId;
      for (let i = removedIndex - 1; i >= 0; i -= 1) {
        const prevId = prior[i];
        if (prevId && ids.includes(prevId)) return prevId;
      }
    }
  }
  return ids[0] ?? null;
}

/** After a failed optimistic remove, re-select the failed card when it is back. */
export function rollbackGatherRequestSelection(input: {
  sortedIds: readonly string[];
  failedId: string;
  fallbackId?: string | null;
}): string | null {
  if (input.sortedIds.includes(input.failedId)) return input.failedId;
  if (input.fallbackId && input.sortedIds.includes(input.fallbackId)) {
    return input.fallbackId;
  }
  return resolveGatherRequestSelection({
    sortedIds: input.sortedIds,
    previousId: input.failedId,
    removedId: input.failedId,
  });
}

/**
 * Put a snapshot row back into the inbox after optimistic remove + failed resolve.
 * Dedupes by id and re-applies FIFO sort so offline recovery does not leave a gap.
 */
export function restoreGatherRequestAfterFailedResolve<T extends GatherRequestSortable>(input: {
  current: readonly T[];
  snapshot: T;
}): T[] {
  const without = input.current.filter((row) => row.id !== input.snapshot.id);
  return sortGatherRequestsFifo([...without, input.snapshot]);
}

/**
 * Public recovery path when resolve RPC fails (and server reload may also fail):
 * restore the removed card locally and re-select it when present.
 */
export function recoverGatherRequestAfterFailedResolve<T extends GatherRequestSortable>(input: {
  currentRequests: readonly T[];
  removedSnapshot: T;
  failedId: string;
  fallbackSelectedId?: string | null;
}): { requests: T[]; selectedId: string | null } {
  const requests = restoreGatherRequestAfterFailedResolve({
    current: input.currentRequests,
    snapshot: input.removedSnapshot,
  });
  const selectedId = rollbackGatherRequestSelection({
    sortedIds: requests.map((row) => row.id),
    failedId: input.failedId,
    fallbackId: input.fallbackSelectedId,
  });
  return { requests, selectedId };
}

export function gatherRequestPageIndex(
  sortedIds: readonly string[],
  selectedId: string | null | undefined,
): number {
  if (!selectedId) return 0;
  const idx = sortedIds.indexOf(selectedId);
  return idx >= 0 ? idx : 0;
}
