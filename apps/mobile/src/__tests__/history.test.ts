import { groupHistoryByDay } from '../utils/history';
import type { VisitedWaypoint } from '../types';

function wp(id: string, arrivedAt: string): VisitedWaypoint {
  return { id, name: `Stop ${id}`, coordinates: { latitude: 0, longitude: 0 }, arrivedAt };
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
