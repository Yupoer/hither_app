import {
  arrivalErrorMessage,
  formatTripDayLine,
  navCommandDisplayLabel,
  shortEta,
  splitDistanceParts,
  splitEtaParts,
} from '../utils/mapFormatters';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

describe('map formatters', () => {
  it('formats short ETAs on minute and hour boundaries', () => {
    expect([29, 31, 59 * 60, 60 * 60 - 1, 60 * 60, 150 * 60].map(shortEta))
      .toEqual(['now', '1 min', '59 min', '1 hr', '1 hr', '2 hr']);
  });

  it('splits distance into a numeral and unit for the expanded card', () => {
    expect(splitDistanceParts(null)).toEqual({ value: '—', unit: '' });
    expect(splitDistanceParts(999.4)).toEqual({ value: '999', unit: 'm' });
    expect(splitDistanceParts(334_700)).toEqual({ value: '334.7', unit: 'km' });
  });

  it('splits ETA into a numeral and unit for the expanded card', () => {
    expect(splitEtaParts(null)).toEqual({ value: '—', unit: '' });
    expect(splitEtaParts(20)).toEqual({ value: 'now', unit: '' });
    expect(splitEtaParts(12 * 60)).toEqual({ value: '12', unit: 'min' });
    expect(splitEtaParts(66 * 3600)).toEqual({ value: '66', unit: 'hr' });
  });

  it('adds the calendar date to the trip-day line only when a departure date exists', () => {
    expect(formatTripDayLine(2, null, t)).toBe('map.tripDay(day=2)');
    expect(formatTripDayLine(0, undefined, t)).toBe('map.tripDay(day=1)');
    expect(formatTripDayLine(3, '2026-12-30', t)).toBe('map.tripDay(day=3) · map.tripDayDate(month=1,day=1)');
    expect(formatTripDayLine(1, 'not a date', t)).toBe('map.tripDay(day=1)');
  });

  it('maps known arrival RPC errors to localized copy and falls back to the shared mapper', () => {
    expect(arrivalErrorMessage(new Error('ERROR: future destination cannot be completed'), t)).toBe('arrival.errFuture');
    expect(arrivalErrorMessage({ message: 'paused destination requires an existing arrival' }, t))
      .toBe('arrival.errPausedUndo');
    expect(arrivalErrorMessage(new Error('something else'), t)).not.toMatch(/^arrival\./);
  });

  it('labels every navigation command kind', () => {
    expect(navCommandDisplayLabel('leader_start', t)).toBe('nav.leaderStart');
    expect(navCommandDisplayLabel('member_request_start', t)).toBe('nav.memberRequestStart');
    expect(navCommandDisplayLabel('unknown' as never, t)).toBe('');
  });
});
