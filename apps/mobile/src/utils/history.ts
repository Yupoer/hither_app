import type { VisitedWaypoint } from '../types';

export interface HistoryDayGroup {
  /** Local calendar day the block covers, e.g. "2026-07-10". */
  day: string;
  items: VisitedWaypoint[];
}

function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Groups visited waypoints into one block per local calendar day (most
 * recent day first), each block's items sorted chronologically (earliest
 * arrival first — a "what happened this day, in order" reading).
 */
export function groupHistoryByDay(items: VisitedWaypoint[]): HistoryDayGroup[] {
  const byDay = new Map<string, VisitedWaypoint[]>();
  for (const item of items) {
    const day = localDayKey(item.arrivedAt);
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
