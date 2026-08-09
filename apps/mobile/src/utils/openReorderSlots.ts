/**
 * Map route-editor reorder updates onto absolute position slots.
 *
 * The editor only lists open stops (zero-based relative indices). Closed and
 * exit-hold carousel snapshots must never contribute slots — otherwise the same
 * drag can persist animation-timing-dependent collisions with historical rows.
 */

export type OpenReorderUpdate = {
  id: string;
  position: number;
  day: number;
};

export type OpenSlotSource = {
  id: string;
  order: number;
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
