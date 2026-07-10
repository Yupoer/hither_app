/** Minutes until meetAt (negative = overdue). Rounds toward zero. */
export function minutesUntil(meetAtIso: string, now: Date): number {
  const diffMs = new Date(meetAtIso).getTime() - now.getTime();
  return Math.trunc(diffMs / 60000);
}

/**
 * Compact live countdown for the gather-time square (max ~4 glyphs): shows time
 * REMAINING, not the clock time. `1h30` when ≥1h away, `45分` under the hour,
 * `遲5` once overdue. Local-time based via the caller's `now`.
 */
export function meetCountdownShort(meetAtIso: string, now: Date): string {
  const m = minutesUntil(meetAtIso, now);
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  if (m >= 0) return `${m}分`;
  const over = Math.abs(m);
  return over >= 60 ? `遲${Math.floor(over / 60)}h` : `遲${over}`;
}
