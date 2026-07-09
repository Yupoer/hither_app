import { minutesUntil } from '../utils/meetTime';

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
