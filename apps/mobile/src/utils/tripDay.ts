import type { Destination } from '../types';

/**
 * Parse a date-only ISO (`YYYY-MM-DD`) or full ISO string as a local calendar
 * day at noon, matching formatTripDayLine / alignMeetTimeToTripDay so TZ day
 * shifts do not move the trip window.
 */
export function parseDateOnlyLocal(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Local calendar day key, e.g. "2026-07-17". */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Trip-day clock from local device date.
 *
 * - `null` — no departure/tripDays; date gate disabled
 * - `0` — before trip start
 * - `1..tripDays` — in progress
 * - `> tripDays` — after trip end
 */
export function currentTripDayNumber(
  departureDate: string | null | undefined,
  tripDays: number | null | undefined,
  now: Date = new Date(),
): number | null {
  const days = typeof tripDays === 'number' && tripDays > 0 ? Math.floor(tripDays) : null;
  const start = parseDateOnlyLocal(departureDate ?? null);
  if (!days || !start) return null;

  const tripStart = startOfLocalDay(start);
  const tripEnd = new Date(tripStart);
  tripEnd.setDate(tripEnd.getDate() + days - 1);
  const today = startOfLocalDay(now);

  if (today < tripStart) return 0;
  if (today > tripEnd) return days + 1;

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((today.getTime() - tripStart.getTime()) / msPerDay) + 1;
}

/** Day number to assign when adding a stop (1 when gate off / before start). */
export function resolveAddDay(
  departureDate: string | null | undefined,
  tripDays: number | null | undefined,
  now: Date = new Date(),
): number {
  const current = currentTripDayNumber(departureDate, tripDays, now);
  if (current == null || current <= 0) return 1;
  const days = typeof tripDays === 'number' && tripDays > 0 ? Math.floor(tripDays) : 1;
  if (current > days) return days;
  return current;
}

/** First visible day header in the reorder list (1 when gate off / before start). */
export function resolveVisibleStartDay(
  departureDate: string | null | undefined,
  tripDays: number | null | undefined,
  now: Date = new Date(),
): number {
  const current = currentTripDayNumber(departureDate, tripDays, now);
  if (current == null || current <= 0) return 1;
  const days = typeof tripDays === 'number' && tripDays > 0 ? Math.floor(tripDays) : 1;
  if (current > days) return days + 1; // no remaining days
  return current;
}

export function sortDestinationsByDayOrder(destinations: Destination[]): Destination[] {
  return [...destinations].sort((a, b) => {
    const dayA = a.day || 1;
    const dayB = b.day || 1;
    if (dayA !== dayB) return dayA - dayB;
    return a.order - b.order;
  });
}

/**
 * Active itinerary for carousel / sheet / reorder: open stops on today and
 * future trip days. Past days are hidden (they surface in history instead).
 */
export function filterActiveDestinations(
  destinations: Destination[],
  departureDate: string | null | undefined,
  tripDays: number | null | undefined,
  now: Date = new Date(),
): Destination[] {
  const open = destinations.filter((dest) => !dest.closedAt);
  const current = currentTripDayNumber(departureDate, tripDays, now);

  // Gate off or trip not started → all open stops.
  if (current == null || current <= 0) {
    return sortDestinationsByDayOrder(open);
  }

  const days = typeof tripDays === 'number' && tripDays > 0 ? Math.floor(tripDays) : 1;
  // Trip fully over → nothing active.
  if (current > days) return [];

  return sortDestinationsByDayOrder(
    open.filter((dest) => (dest.day || 1) >= current),
  );
}

/** First stop in itinerary order (day, then position). */
export function nextOrderedDestination(
  destinations: Destination[],
): Destination | undefined {
  return sortDestinationsByDayOrder(destinations)[0];
}

export interface AppendPositionPlan {
  /** Position to assign the new stop. */
  position: number;
  /** Existing stop ids that must be shifted +1 (position >= insert). */
  shiftIds: string[];
}

/**
 * Insert at the end of `targetDay`. Later stops (same day after last, or any
 * later day) shift right so day order stays contiguous.
 */
export function positionForAppendOnDay(
  existing: { id: string; order: number; day: number }[],
  targetDay: number,
): AppendPositionPlan {
  const day = Math.max(1, targetDay || 1);
  const sameDay = existing.filter((d) => (d.day || 1) === day);
  let insertPosition: number;
  if (sameDay.length > 0) {
    insertPosition = Math.max(...sameDay.map((d) => d.order)) + 1;
  } else {
    const earlier = existing.filter((d) => (d.day || 1) < day);
    insertPosition =
      earlier.length > 0 ? Math.max(...earlier.map((d) => d.order)) + 1 : 0;
  }
  const shiftIds = existing
    .filter((d) => d.order >= insertPosition)
    .sort((a, b) => b.order - a.order) // high → low so shifts do not collide
    .map((d) => d.id);
  return { position: insertPosition, shiftIds };
}

/** Calendar Date for a trip day number (local noon). */
export function dateForTripDay(
  departureDate: string | null | undefined,
  day: number,
): Date | null {
  const start = parseDateOnlyLocal(departureDate ?? null);
  if (!start) return null;
  const d = new Date(start);
  d.setDate(d.getDate() + Math.max(1, day || 1) - 1);
  return d;
}

/** End-of-day local timestamp ISO for synthetic history sorting on a trip day. */
export function endOfTripDayIso(
  departureDate: string | null | undefined,
  day: number,
): string {
  const base = dateForTripDay(departureDate, day);
  if (!base) return new Date().toISOString();
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 0);
  return end.toISOString();
}
