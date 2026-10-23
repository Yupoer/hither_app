import type { TranslationKey } from '../i18n';
import type { NavCommandKind } from './gatherCommand';
import { getOperationErrorMessage } from './operationError';

/** Map known Postgres / RPC exception text to i18n keys (server keeps EN contract). */
const ARRIVAL_RPC_ERRORS: Array<{ needle: string; key: TranslationKey }> = [
  { needle: 'future destination cannot be completed', key: 'arrival.errFuture' },
  { needle: 'cannot mark this member', key: 'arrival.errCannotMark' },
  { needle: 'destination outside member scope', key: 'arrival.errOutsideScope' },
  { needle: 'paused destination requires an existing arrival', key: 'arrival.errPausedUndo' },
];

export function arrivalErrorMessage(
  error: unknown,
  t: (key: TranslationKey) => string,
): string {
  const raw = error instanceof Error ? error.message
    : error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  for (const { needle, key } of ARRIVAL_RPC_ERRORS) {
    if (raw.includes(needle)) return t(key);
  }
  return getOperationErrorMessage(error);
}

/** Short ETA like the design's "4 min" / "now" / "2 hr". */
export function shortEta(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr`;
}

/** Expanded metrics: big number + small unit (e.g. 334.7 + km). */
export function splitDistanceParts(distanceM: number | null): { value: string; unit: string } {
  if (distanceM == null) return { value: '—', unit: '' };
  if (distanceM < 1000) return { value: String(Math.round(distanceM)), unit: 'm' };
  return { value: (distanceM / 1000).toFixed(1), unit: 'km' };
}

/** Expanded metrics: big number + small unit (e.g. 66 + hr). */
export function splitEtaParts(seconds: number | null): { value: string; unit: string } {
  if (seconds == null) return { value: '—', unit: '' };
  const m = Math.round(seconds / 60);
  if (m < 1) return { value: 'now', unit: '' };
  if (m < 60) return { value: String(m), unit: 'min' };
  return { value: String(Math.floor(m / 60)), unit: 'hr' };
}

/**
 * Expanded gathering-card line: "第 N 天 · M月D號" when a trip departure date
 * exists (aligned with DestinationReorderList day headers).
 * Date-only ISO is parsed at local noon to avoid TZ day-shift.
 */
export function formatTripDayLine(
  dayNum: number,
  departureDate: string | null | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const day = Math.max(1, dayNum || 1);
  const dayPart = t('map.tripDay', { day });
  if (!departureDate) return dayPart;
  const raw = departureDate.trim();
  const base = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(base.getTime())) return dayPart;
  base.setDate(base.getDate() + (day - 1));
  const datePart = t('map.tripDayDate', {
    month: base.getMonth() + 1,
    day: base.getDate(),
  });
  return `${dayPart} · ${datePart}`;
}

/** Localized nav command label from kind (tests keep zh on resolveNavCommand.label). */
export function navCommandDisplayLabel(
  kind: NavCommandKind,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  switch (kind) {
    case 'leader_start':
      return t('nav.leaderStart');
    case 'leader_stop':
      return t('nav.leaderStop');
    case 'leader_mark_complete':
      return t('nav.leaderComplete');
    case 'member_navigating':
      return t('nav.memberNavigating');
    case 'member_waiting_complete':
      return t('nav.memberWaitingComplete');
    case 'member_request_start':
      return t('nav.memberRequestStart');
    default:
      return '';
  }
}
