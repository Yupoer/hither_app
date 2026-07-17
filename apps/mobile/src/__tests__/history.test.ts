import {
  groupHistoryByDay,
  mergeHistoryWithPastStops,
  pastStopsForHistory,
} from '../utils/history';
import type { Destination, VisitedWaypoint } from '../types';

function wp(id: string, arrivedAt: string): VisitedWaypoint {
  return { id, name: `Stop ${id}`, coordinates: { latitude: 0, longitude: 0 }, arrivedAt };
}

function dest(
  id: string,
  day: number,
  closedAt?: string,
): Destination {
  return {
    id,
    title: id,
    day,
    order: day,
    coordinates: { latitude: 1, longitude: 2 },
    closedAt,
  };
}

// Kept mid-day UTC (not near midnight) so the local-day bucketing this
// function does is stable across any reasonable test-runner timezone.
describe('groupHistoryByDay', () => {
  it('groups by local calendar day, most recent day first', () => {
    const groups = groupHistoryByDay([
      wp('a', '2026-07-10T12:00:00.000Z'),
      wp('b', '2026-07-08T12:00:00.000Z'),
      wp('c', '2026-07-10T13:00:00.000Z'),
    ]);
    expect(groups.map((g) => g.day)[0]).not.toBe(groups.map((g) => g.day)[1]);
    expect(groups[0].items.map((i) => i.id).sort()).toEqual(['a', 'c']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['b']);
  });

  it('sorts items within a day chronologically (earliest first)', () => {
    const groups = groupHistoryByDay([
      wp('late', '2026-07-10T15:00:00.000Z'),
      wp('early', '2026-07-10T11:00:00.000Z'),
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual(['early', 'late']);
  });

  it('returns nothing for an empty history', () => {
    expect(groupHistoryByDay([])).toEqual([]);
  });
});

describe('pastStopsForHistory / mergeHistoryWithPastStops', () => {
  const now = new Date(2026, 6, 17, 12); // Jul 17 local
  const departureDate = '2026-07-16';
  const tripDays = 3;

  it('projects past-day open stops as incomplete', () => {
    const synthetic = pastStopsForHistory(
      [dest('day1', 1), dest('day2', 2)],
      {
        departureDate,
        tripDays,
        now,
        arrivedDestinationIds: new Set(),
        userId: 'u1',
      },
    );
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0].destinationId).toBe('day1');
    expect(synthetic[0].status).toBe('incomplete');
    expect(synthetic[0].synthetic).toBe(true);
  });

  it('projects closed stops without arrival as missed', () => {
    const synthetic = pastStopsForHistory(
      [dest('closed', 2, '2026-07-17T08:00:00.000Z')],
      {
        departureDate,
        tripDays,
        now,
        arrivedDestinationIds: new Set(),
      },
    );
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0].status).toBe('missed');
  });

  it('skips destinations the viewer already arrived at', () => {
    const synthetic = pastStopsForHistory(
      [dest('day1', 1)],
      {
        departureDate,
        tripDays,
        now,
        arrivedDestinationIds: new Set(['day1']),
      },
    );
    expect(synthetic).toEqual([]);
  });

  it('merges real arrivals with synthetic past stops', () => {
    const visited: VisitedWaypoint[] = [
      {
        id: 'v1',
        destinationId: 'arrived-day1',
        name: 'Arrived',
        coordinates: { latitude: 0, longitude: 0 },
        arrivedAt: '2026-07-16T10:00:00.000Z',
      },
    ];
    const merged = mergeHistoryWithPastStops(
      visited,
      [dest('arrived-day1', 1), dest('missed-day1', 1), dest('today', 2)],
      { departureDate, tripDays, now, userId: 'u1' },
    );
    expect(merged.map((m) => m.destinationId).sort()).toEqual([
      'arrived-day1',
      'missed-day1',
    ]);
    const arrived = merged.find((m) => m.destinationId === 'arrived-day1');
    const missed = merged.find((m) => m.destinationId === 'missed-day1');
    expect(arrived?.status).toBe('arrived');
    expect(missed?.status).toBe('incomplete');
  });
});
