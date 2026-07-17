import { formatCompactDurationFromMinutes } from './geo';

/** Local calendar start of today (00:00:00.000). */
export function startOfTodayLocal(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Clamp a date/time so its local calendar day is not before today.
 * Times earlier today are kept; only days before today are bumped to today
 * (preserving the original clock time of day).
 */
export function clampDateNotBeforeToday(value: Date, now: Date = new Date()): Date {
  const min = startOfTodayLocal(now);
  if (value.getTime() >= min.getTime()) return value;
  const next = new Date(value);
  next.setFullYear(min.getFullYear(), min.getMonth(), min.getDate());
  // If clock still lands before min (e.g. DST edge), pin to min.
  if (next.getTime() < min.getTime()) return min;
  return next;
}

/** Align a local clock time to a destination's date within the trip. */
export function alignMeetTimeToTripDay(
  value: Date,
  departureDate: string | null | undefined,
  day: number,
): Date {
  const aligned = new Date(value);
  aligned.setSeconds(0, 0);
  if (!departureDate) return aligned;

  const raw = departureDate.trim();
  const tripStart = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(tripStart.getTime())) return aligned;

  tripStart.setDate(tripStart.getDate() + Math.max(1, day || 1) - 1);
  aligned.setFullYear(tripStart.getFullYear(), tripStart.getMonth(), tripStart.getDate());
  return aligned;
}

/** Minutes until meetAt (negative = overdue). Rounds toward zero. */
export function minutesUntil(meetAtIso: string, now: Date): number {
  const diffMs = new Date(meetAtIso).getTime() - now.getTime();
  return Math.trunc(diffMs / 60000);
}

/**
 * Compact live countdown for the gather-time square: shows time REMAINING, not
 * the clock time. `1hr30` / `1d12hr` when ≥1h away, `45分` under the hour,
 * `遲5` / `遲1d` once overdue. Local-time based via the caller's `now`.
 */
export function meetCountdownShort(meetAtIso: string, now: Date): string {
  const m = minutesUntil(meetAtIso, now);
  if (m >= 60) return formatCompactDurationFromMinutes(m);
  if (m >= 0) return `${m}分`;
  const over = Math.abs(m);
  return over >= 60 ? `遲${formatCompactDurationFromMinutes(over)}` : `遲${over}`;
}
