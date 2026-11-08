type GatherRequestSortable = {
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
