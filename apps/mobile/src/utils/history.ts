import type { Destination, VisitedWaypoint } from '../types';
import {
  currentTripDayNumber,
  endOfTripDayIso,
  localDayKey,
} from './tripDay';

export type HistoryStatus = 'arrived' | 'missed' | 'incomplete';

export interface HistoryWaypoint extends VisitedWaypoint {
  /** Display/completion status; arrived when omitted or explicit. */
  status?: HistoryStatus;
  /** Synthetic rows are projected from past itinerary stops, not DB rows. */
  synthetic?: boolean;
}

export interface HistoryDayGroup {
  /** Local calendar day the block covers, e.g. "2026-07-10". */
  day: string;
  items: HistoryWaypoint[];
}

function dayKeyFromIso(iso: string): string {
  return localDayKey(new Date(iso));
}

/**
 * Groups visited waypoints into one block per local calendar day (most
 * recent day first), each block's items sorted chronologically (earliest
 * arrival first — a "what happened this day, in order" reading).
 */
export function groupHistoryByDay(items: HistoryWaypoint[]): HistoryDayGroup[] {
  const byDay = new Map<string, HistoryWaypoint[]>();
  for (const item of items) {
    const day = dayKeyFromIso(item.arrivedAt);
    const list = byDay.get(day);
    if (list) list.push(item);
    else byDay.set(day, [item]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, dayItems]) => ({
      day,
      items: [...dayItems].sort(
        (a, b) => new Date(a.arrivedAt).getTime() - new Date(b.arrivedAt).getTime(),
      ),
    }));
}

/**
 * Past trip-day (or closed) stops that the viewer never arrived at, projected
 * into history with 未抵達 / 未完成 status.
 */
export function pastStopsForHistory(
  destinations: Destination[],
  options: {
    departureDate?: string | null;
    tripDays?: number | null;
    now?: Date;
    /** Destination ids the viewer already has an arrival/visited row for. */
    arrivedDestinationIds: Set<string>;
    userId?: string;
  },
): HistoryWaypoint[] {
  const {
    departureDate,
    tripDays,
    now = new Date(),
    arrivedDestinationIds,
    userId,
  } = options;

  const current = currentTripDayNumber(departureDate, tripDays, now);
  // No date gate → nothing synthetic (history stays arrival-only).
  if (current == null) return [];

  const days =
    typeof tripDays === 'number' && tripDays > 0 ? Math.floor(tripDays) : null;

  return destinations
    .filter((dest) => {
      if (arrivedDestinationIds.has(dest.id)) return false;
      const day = dest.day || 1;
      // Fully past trip: every remaining open stop is historical.
      if (days != null && current > days) return true;
      // Closed stops always leave the active list; surface if not arrived.
      if (dest.closedAt) return true;
      // Before/during trip: only days strictly before today.
      if (current <= 0) return false;
      return day < current;
    })
    .map((dest) => {
      const status: HistoryStatus = dest.closedAt ? 'missed' : 'incomplete';
      const arrivedAt =
        dest.closedAt ??
        endOfTripDayIso(departureDate, dest.day || 1);
      return {
        id: `synthetic:${dest.id}`,
        userId,
        destinationId: dest.id,
        name: dest.title,
        coordinates: dest.coordinates,
        arrivedAt,
        status,
        synthetic: true,
      } satisfies HistoryWaypoint;
    });
}

/**
 * Merge real arrival rows with synthetic past/closed misses. Real rows win
 * when the same destination appears in both.
 */
export function mergeHistoryWithPastStops(
  visited: HistoryWaypoint[],
  destinations: Destination[],
  options: {
    departureDate?: string | null;
    tripDays?: number | null;
    now?: Date;
    userId?: string;
  },
): HistoryWaypoint[] {
  const arrivedDestinationIds = new Set<string>();
  for (const item of visited) {
    if (item.destinationId) arrivedDestinationIds.add(item.destinationId);
  }

  const arrived: HistoryWaypoint[] = visited.map((item) => ({
    ...item,
    status: item.status ?? 'arrived',
  }));

  const synthetic = pastStopsForHistory(destinations, {
    ...options,
    arrivedDestinationIds,
  });

  return [...arrived, ...synthetic];
}
