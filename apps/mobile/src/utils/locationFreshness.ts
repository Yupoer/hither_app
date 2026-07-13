export type LocationFreshness =
  | { unit: 'missing' | 'justNow' | 'stale' }
  | { unit: 'minutes' | 'hours'; value: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const STALE_MS = 24 * HOUR_MS;

export function locationFreshness(
  lastUpdated: string | undefined,
  nowMs: number,
): LocationFreshness {
  if (!lastUpdated) return { unit: 'missing' };

  const updatedMs = Date.parse(lastUpdated);
  if (!Number.isFinite(updatedMs)) return { unit: 'missing' };

  const ageMs = Math.max(0, nowMs - updatedMs);
  if (ageMs >= STALE_MS) return { unit: 'stale' };
  if (ageMs < MINUTE_MS) return { unit: 'justNow' };
  if (ageMs < HOUR_MS) return { unit: 'minutes', value: Math.floor(ageMs / MINUTE_MS) };
  return { unit: 'hours', value: Math.floor(ageMs / HOUR_MS) };
}
