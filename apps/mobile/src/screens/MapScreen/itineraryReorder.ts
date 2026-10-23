import type { Destination } from '../../types';
import { alignMeetTimeToTripDay } from '../../utils/meetTime';
import {
  mapOpenReorderToPersistedPositions,
  openPositionSlotsFromOpenDestinations,
} from '../../utils/openReorderSlots';
import { openDestinationsForReorder } from '../../utils/tripDay';

export interface ReorderUpdate {
  id: string;
  position: number;
  day: number | null;
  stayAnchor?: boolean;
}

/** Full open list (all trip days) reserves the write slots; never day-gate them. */
function slotsFor(base: readonly Destination[], updates: readonly ReorderUpdate[]): ReorderUpdate[] {
  return mapOpenReorderToPersistedPositions(
    updates,
    openPositionSlotsFromOpenDestinations(openDestinationsForReorder([...base])),
  );
}

/** Apply editor reorder updates to a list: slot remap, day moves, meet times follow their day. */
export function applyReorderUpdates(
  base: readonly Destination[],
  updates: readonly ReorderUpdate[],
  departureDate: string | null | undefined,
): Destination[] {
  const next = base.map((destination) => ({ ...destination }));
  for (const update of slotsFor(base, updates)) {
    const destination = next.find((item) => item.id === update.id);
    if (!destination) continue;
    destination.order = update.position;
    destination.day = update.day;
    if (update.day == null) destination.meetAt = undefined;
    if (update.stayAnchor !== undefined) destination.stayAnchor = update.stayAnchor;
    const original = base.find((item) => item.id === update.id);
    if (departureDate && update.day != null && original?.meetAt && (original.day || 1) !== update.day) {
      destination.meetAt = alignMeetTimeToTripDay(new Date(original.meetAt), departureDate, update.day)
        .toISOString();
    }
  }
  return next.sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.order - b.order);
}

/** The reorder payload for an immediate durable write, with meet times moved to their new day. */
export function persistedReorderUpdates(
  base: readonly Destination[],
  updates: readonly ReorderUpdate[],
  departureDate: string | null | undefined,
): (ReorderUpdate & { meetAt?: string })[] {
  return slotsFor(base, updates).map((update) => {
    const original = base.find((destination) => destination.id === update.id);
    if (update.day == null || !departureDate || !original?.meetAt || original.day === update.day) {
      return { ...update };
    }
    return {
      ...update,
      meetAt: alignMeetTimeToTripDay(new Date(original.meetAt), departureDate, update.day).toISOString(),
    };
  });
}
