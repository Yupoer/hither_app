/**
 * Map route-editor reorder updates onto absolute position slots.
 *
 * The editor only lists open stops (zero-based relative indices). Closed and
 * exit-hold carousel snapshots must never contribute slots — otherwise the same
 * drag can persist animation-timing-dependent collisions with historical rows.
 *
 * Route flush must pass the full open itinerary (all days), not the carousel
 * day-gated subset — otherwise past-day rows are omitted from the write and
 * day labels appear to "shift" after 完成.
 */

export type OpenReorderUpdate = {
  id: string;
  position: number;
  day: number;
};

export type OpenSlotSource = {
  id: string;
  order: number;
  day?: number;
};

/**
 * Absolute position slots reserved by the current open itinerary snapshot,
 * sorted by existing order (stable historical reservation for closed rows).
 */
export function openPositionSlotsFromOpenDestinations(
  openDestinations: readonly OpenSlotSource[],
): number[] {
  return [...openDestinations]
    .sort((a, b) => a.order - b.order)
    .map((destination) => destination.order);
}

/**
 * Remap editor-relative updates onto open-only absolute slots.
 * Index i of the ordered update list gets openSlots[i].
 * Updates must be sorted in the intended final sequence (day, then order).
 */
export function mapOpenReorderToPersistedPositions<T extends OpenReorderUpdate>(
  updates: readonly T[],
  openSlots: readonly number[],
): T[] {
  return updates.map((update, index) => ({
    ...update,
    position: openSlots[index] ?? update.position,
  }));
}

/**
 * Build a flush-safe reorder payload from a full open draft:
 * sort by day then order → relative indices → map onto locked open slots.
 */
export function buildOpenReorderPayload<T extends {
  id: string;
  order: number;
  day?: number;
  kind?: string;
  stayAnchor?: boolean;
  meetAt?: string;
}>(
  openDraft: readonly T[],
): {
  id: string;
  position: number;
  day: number;
  stayAnchor?: boolean;
  meetAt?: string;
}[] {
  const sorted = [...openDraft].sort((a, b) => {
    if ((a.day || 1) !== (b.day || 1)) return (a.day || 1) - (b.day || 1);
    return a.order - b.order;
  });
  const openSlots = openPositionSlotsFromOpenDestinations(sorted);
  const relative = sorted.map((d, index) => ({
    id: d.id,
    position: index,
    day: d.day || 1,
    stayAnchor: d.kind === 'accommodation' ? Boolean(d.stayAnchor) : undefined,
    meetAt: d.meetAt,
  }));
  return mapOpenReorderToPersistedPositions(relative, openSlots);
}
