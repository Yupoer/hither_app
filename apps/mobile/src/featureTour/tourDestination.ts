/**
 * Single source of truth for which gathering destination the tour explains.
 * Plan filters, expand, availability, and measured refs must all use this id.
 */

export interface TourDestinationPickInput {
  /** Ordered active destinations in the carousel. */
  destinationIds: readonly string[];
  /** Currently selected carousel index (may point at shared target). */
  selectedIndex: number;
  /** Optional preferred id (e.g. shared navigation target). */
  preferredId?: string | null;
}

/**
 * Pick one destination for the whole tour plan.
 * Preference: preferredId if present in list → selectedIndex → first.
 */
export function pickTourDestinationId(input: TourDestinationPickInput): string | null {
  const ids = input.destinationIds;
  if (!ids.length) return null;
  if (input.preferredId && ids.includes(input.preferredId)) {
    return input.preferredId;
  }
  const idx = Math.max(0, Math.min(input.selectedIndex, ids.length - 1));
  return ids[idx] ?? ids[0] ?? null;
}

export function tourDestinationIndex(
  destinationIds: readonly string[],
  tourDestinationId: string | null,
): number {
  if (!tourDestinationId) return 0;
  const idx = destinationIds.indexOf(tourDestinationId);
  return idx >= 0 ? idx : 0;
}
