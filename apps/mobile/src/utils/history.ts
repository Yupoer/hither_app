import type { Destination, DestinationArrival, VisitedWaypoint } from '../types';
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

function sortTimestamp(item: HistoryWaypoint): number | null {
  const value = item.sortTimestamp ?? item.arrivedAt;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dayKeyFromIso(iso: string | null): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'unknown' : localDayKey(date);
}

/**
 * Groups visited waypoints into one block per local calendar day (most
 * recent day first), each block's items sorted chronologically (earliest
 * arrival first — a "what happened this day, in order" reading).
 */
export function groupHistoryByDay(items: HistoryWaypoint[]): HistoryDayGroup[] {
  const byDay = new Map<string, HistoryWaypoint[]>();
  for (const item of items) {
    const day = dayKeyFromIso(item.sortTimestamp ?? item.arrivedAt);
    const list = byDay.get(day);
    if (list) list.push(item);
    else byDay.set(day, [item]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return a < b ? 1 : a > b ? -1 : 0;
    })
    .map(([day, dayItems]) => ({
      day,
      items: [...dayItems].sort(
        (a, b) => (sortTimestamp(a) ?? Number.MAX_SAFE_INTEGER)
          - (sortTimestamp(b) ?? Number.MAX_SAFE_INTEGER),
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
  const days =
    typeof tripDays === 'number' && tripDays > 0 ? Math.floor(tripDays) : null;

  return destinations
    .filter((dest) => {
      // History is the main-team journey ledger. Subgroup-only stops have a
      // separate scoped history and must not become synthetic main-team rows.
      if (dest.subgroupId) return false;
      if (arrivedDestinationIds.has(dest.id)) return false;
      // Completed / closed stops leave the active carousel; always surface
      // them in history even when the trip has no departure-date gate.
      if (dest.closedAt) return true;
      // No date gate → only closed stops are synthetic (arrivals come from DB).
      if (current == null) return false;
      if (dest.day == null) return false;
      const day = dest.day;
      // Fully past trip: every remaining open stop is historical.
      if (days != null && current > days) return true;
      // Before/during trip: only days strictly before today.
      if (current <= 0) return false;
      return day < current;
    })
    .map((dest) => {
      const status: HistoryStatus = dest.closedAt ? 'missed' : 'incomplete';
      const arrivedAt =
        dest.closedAt
        ?? endOfTripDayIso(departureDate, dest.day || 1)
        ?? new Date().toISOString();
      return {
        id: `synthetic:${dest.id}`,
        userId,
        destinationId: dest.id,
        name: dest.title,
        coordinates: dest.coordinates,
        arrivedAt,
        sortTimestamp: arrivedAt,
        status,
        synthetic: true,
      } satisfies HistoryWaypoint;
    });
}

export function historyFromDestinationArrivals(
  arrivals: DestinationArrival[],
  destinations: Destination[],
  options: { viewerId?: string | null; isGroupLeader: boolean },
): HistoryWaypoint[] {
  const destinationById = new Map(destinations.map((destination) => [destination.id, destination]));
  return arrivals
    .filter((arrival) => options.isGroupLeader || arrival.userId === options.viewerId)
    .flatMap((arrival) => {
      const destination = destinationById.get(arrival.destinationId);
      if (!destination?.closedAt || destination.subgroupId) return [];
      return [{
        id: "arrival:" + arrival.id,
        userId: arrival.userId,
        destinationId: arrival.destinationId,
        name: destination.title,
        coordinates: destination.coordinates,
        // A leader correction deliberately keeps arrivedAt null. Sort by the
        // destination's close time, but let the UI show that physical time is
        // unknown instead of inventing one.
        arrivedAt: arrival.arrivedAt,
        sortTimestamp: arrival.arrivedAt ?? destination.closedAt ?? null,
        timeUnknown: arrival.arrivedAt == null,
        status: "arrived",
      } satisfies HistoryWaypoint];
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
