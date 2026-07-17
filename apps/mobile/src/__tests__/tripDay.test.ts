import {
  currentTripDayNumber,
  filterActiveDestinations,
  nextOrderedDestination,
  positionForAppendOnDay,
  resolveAddDay,
  resolveVisibleStartDay,
} from '../utils/tripDay';
import type { Destination } from '../types';

function dest(
  id: string,
  day: number,
  order: number,
  closedAt?: string,
): Destination {
  return {
    id,
    title: id,
    day,
    order,
    coordinates: { latitude: 0, longitude: 0 },
    closedAt,
  };
}

describe('currentTripDayNumber', () => {
  it('returns null when departure or tripDays missing', () => {
    expect(currentTripDayNumber(null, 3, new Date(2026, 6, 17, 12))).toBeNull();
    expect(currentTripDayNumber('2026-07-16', null, new Date(2026, 6, 17, 12))).toBeNull();
  });

  it('maps 16–18 trip: day1=16, day2=17, day3=18', () => {
    const dep = '2026-07-16';
    expect(currentTripDayNumber(dep, 3, new Date(2026, 6, 15, 18))).toBe(0);
    expect(currentTripDayNumber(dep, 3, new Date(2026, 6, 16, 9))).toBe(1);
    expect(currentTripDayNumber(dep, 3, new Date(2026, 6, 17, 15))).toBe(2);
    expect(currentTripDayNumber(dep, 3, new Date(2026, 6, 18, 23))).toBe(3);
    expect(currentTripDayNumber(dep, 3, new Date(2026, 6, 19, 0))).toBe(4);
  });
});

describe('resolveAddDay / resolveVisibleStartDay', () => {
  it('adds to current day mid-trip and day 1 before start', () => {
    const dep = '2026-07-16';
    expect(resolveAddDay(dep, 3, new Date(2026, 6, 17, 12))).toBe(2);
    expect(resolveAddDay(dep, 3, new Date(2026, 6, 15, 12))).toBe(1);
    expect(resolveAddDay(null, 3, new Date(2026, 6, 17, 12))).toBe(1);
  });

  it('starts reorder headers at current day mid-trip', () => {
    expect(resolveVisibleStartDay('2026-07-16', 3, new Date(2026, 6, 17, 12))).toBe(2);
    expect(resolveVisibleStartDay('2026-07-16', 3, new Date(2026, 6, 15, 12))).toBe(1);
  });
});

describe('filterActiveDestinations', () => {
  const list = [
    dest('d1a', 1, 0),
    dest('d1b', 1, 1),
    dest('d2a', 2, 2),
    dest('d3a', 3, 3),
    dest('closed', 2, 4, '2026-07-17T10:00:00.000Z'),
  ];

  it('hides past days and closed stops mid-trip', () => {
    const active = filterActiveDestinations(
      list,
      '2026-07-16',
      3,
      new Date(2026, 6, 17, 12),
    );
    expect(active.map((d) => d.id)).toEqual(['d2a', 'd3a']);
  });

  it('shows all open stops before trip starts', () => {
    const active = filterActiveDestinations(
      list,
      '2026-07-16',
      3,
      new Date(2026, 6, 15, 12),
    );
    expect(active.map((d) => d.id)).toEqual(['d1a', 'd1b', 'd2a', 'd3a']);
  });

  it('returns empty after trip ends', () => {
    const active = filterActiveDestinations(
      list,
      '2026-07-16',
      3,
      new Date(2026, 6, 20, 12),
    );
    expect(active).toEqual([]);
  });

  it('shows all open when date gate disabled', () => {
    const active = filterActiveDestinations(list, null, null, new Date(2026, 6, 17, 12));
    expect(active.map((d) => d.id)).toEqual(['d1a', 'd1b', 'd2a', 'd3a']);
  });
});

describe('nextOrderedDestination', () => {
  it('returns first by day then order, not input order', () => {
    const list = [dest('later', 2, 5), dest('first', 1, 9), dest('mid', 2, 1)];
    expect(nextOrderedDestination(list)?.id).toBe('first');
  });
});

describe('positionForAppendOnDay', () => {
  it('appends after last stop of target day and shifts later rows', () => {
    const existing = [
      { id: 'a', order: 0, day: 1 },
      { id: 'b', order: 1, day: 1 },
      { id: 'c', order: 2, day: 2 },
      { id: 'd', order: 3, day: 3 },
    ];
    // Append on day 2 → after c (order 2) → position 3; d shifts.
    const plan = positionForAppendOnDay(existing, 2);
    expect(plan.position).toBe(3);
    expect(plan.shiftIds).toEqual(['d']);
  });

  it('inserts first of empty day after earlier days', () => {
    const existing = [
      { id: 'a', order: 0, day: 1 },
      { id: 'd', order: 1, day: 3 },
    ];
    const plan = positionForAppendOnDay(existing, 2);
    expect(plan.position).toBe(1);
    expect(plan.shiftIds).toEqual(['d']);
  });
});
