import {
  alignMeetTimeToTripDay,
  clampDateNotBeforeToday,
  minutesUntil,
  meetCountdownShort,
  startOfTodayLocal,
} from '../utils/meetTime';

describe('alignMeetTimeToTripDay', () => {
  it('moves the date to the destination trip day while preserving hour and minute', () => {
    const original = new Date(2026, 6, 31, 14, 45, 37, 900);

    const aligned = alignMeetTimeToTripDay(original, '2026-07-31', 2);

    expect(aligned.getFullYear()).toBe(2026);
    expect(aligned.getMonth()).toBe(7);
    expect(aligned.getDate()).toBe(1);
    expect(aligned.getHours()).toBe(14);
    expect(aligned.getMinutes()).toBe(45);
    expect(aligned.getSeconds()).toBe(0);
    expect(aligned.getMilliseconds()).toBe(0);
  });

  it('uses day one and leaves the original date intact when departure date is invalid', () => {
    const original = new Date(2026, 11, 20, 9, 5, 12, 300);

    const aligned = alignMeetTimeToTripDay(original, 'not-a-date', 0);

    expect(aligned.getFullYear()).toBe(2026);
    expect(aligned.getMonth()).toBe(11);
    expect(aligned.getDate()).toBe(20);
    expect(aligned.getHours()).toBe(9);
    expect(aligned.getMinutes()).toBe(5);
    expect(aligned.getSeconds()).toBe(0);
  });
});

describe('clampDateNotBeforeToday', () => {
  it('leaves today and future dates unchanged', () => {
    const now = new Date(2026, 6, 18, 15, 30, 0, 0);
    const todayMorning = new Date(2026, 6, 18, 8, 0, 0, 0);
    const tomorrow = new Date(2026, 6, 19, 9, 0, 0, 0);
    expect(clampDateNotBeforeToday(todayMorning, now).getTime()).toBe(todayMorning.getTime());
    expect(clampDateNotBeforeToday(tomorrow, now).getTime()).toBe(tomorrow.getTime());
  });

  it('bumps calendar days before today up to today while keeping clock time', () => {
    const now = new Date(2026, 6, 18, 15, 30, 0, 0);
    const yesterday = new Date(2026, 6, 17, 14, 45, 0, 0);
    const clamped = clampDateNotBeforeToday(yesterday, now);
    expect(clamped.getFullYear()).toBe(2026);
    expect(clamped.getMonth()).toBe(6);
    expect(clamped.getDate()).toBe(18);
    expect(clamped.getHours()).toBe(14);
    expect(clamped.getMinutes()).toBe(45);
  });

  it('startOfTodayLocal is midnight local', () => {
    const now = new Date(2026, 6, 18, 15, 30, 12, 500);
    const start = startOfTodayLocal(now);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(start.getDate()).toBe(18);
  });
});

describe('minutesUntil', () => {
  it('returns a positive count for a future meetAt', () => {
    const now = new Date('2026-07-09T10:00:00Z');
    expect(minutesUntil('2026-07-09T10:15:00Z', now)).toBe(15);
  });

  it('returns a negative count for a past meetAt (overdue)', () => {
    const now = new Date('2026-07-09T10:20:00Z');
    expect(minutesUntil('2026-07-09T10:00:00Z', now)).toBe(-20);
  });

  it('returns 0 exactly at the meet time', () => {
    const now = new Date('2026-07-09T10:00:00Z');
    expect(minutesUntil('2026-07-09T10:00:00Z', now)).toBe(0);
  });

  it('rounds toward zero for partial minutes', () => {
    const now = new Date('2026-07-09T10:00:00Z');
    expect(minutesUntil('2026-07-09T10:00:59Z', now)).toBe(0);
    expect(minutesUntil('2026-07-09T09:59:01Z', now)).toBe(-0);
  });
});

describe('meetCountdownShort', () => {
  const now = new Date('2026-07-09T10:00:00Z');
  it('shows minutes under an hour', () => {
    expect(meetCountdownShort('2026-07-09T10:45:00Z', now)).toBe('45分');
    expect(meetCountdownShort('2026-07-09T10:00:00Z', now)).toBe('0分');
  });
  it('shows compact hr at or over an hour', () => {
    expect(meetCountdownShort('2026-07-09T11:30:00Z', now)).toBe('1hr30');
    expect(meetCountdownShort('2026-07-09T12:05:00Z', now)).toBe('2hr5');
    expect(meetCountdownShort('2026-07-09T15:00:00Z', now)).toBe('5hr');
  });
  it('shows days when at or over 24 hours', () => {
    expect(meetCountdownShort('2026-07-10T22:00:00Z', now)).toBe('1d12hr');
    expect(meetCountdownShort('2026-07-11T10:00:00Z', now)).toBe('2d');
  });
  it('marks overdue', () => {
    expect(meetCountdownShort('2026-07-09T09:55:00Z', now)).toBe('遲5');
    expect(meetCountdownShort('2026-07-09T08:30:00Z', now)).toBe('遲1hr30');
    expect(meetCountdownShort('2026-07-07T22:00:00Z', now)).toBe('遲1d12hr');
  });
});
