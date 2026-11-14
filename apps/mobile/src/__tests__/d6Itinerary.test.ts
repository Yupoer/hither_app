import { D6_DAY_PALETTE, d6DayRows, d6DropLabel, d6Reorder, d6TripDays, d6TripRange, type D6RouteRow } from '../screens/MapScreen/d6Itinerary';
import type { DailyAccommodation, Destination } from '../types';

const stop = (id: string, day: number | null, order: number): Destination => ({
  id, title: id, day, order, coordinates: { latitude: 25, longitude: 121 },
});

it('takes either date endpoint first and counts calendar days across a month', () => {
  const first = new Date(2026, 9, 31, 12);
  const second = new Date(2026, 10, 2, 12);
  expect(d6TripRange(second, first)).toEqual({ days: 3, departureDate: '2026-10-31' });
  expect(d6TripRange(first, first)).toEqual({ days: 1, departureDate: '2026-10-31' });
  const days = d6TripDays(first, 7, { 2: '#AABBCC' });
  expect(days[1]).toMatchObject({ number: 2, date: new Date(2026, 10, 1, 12), color: '#AABBCC' });
  expect(days[6].color).toBe(D6_DAY_PALETTE[0]);
});

it('deduplicates the daily stay source and identifies every older accommodation separately', () => {
  const [day] = d6TripDays(new Date(2026, 10, 1, 12), 1, {});
  const stay: DailyAccommodation = {
    id: 'stay', groupId: 'g', stayDate: '2026-11-01', title: 'Stay',
    coordinates: { latitude: 25, longitude: 121 }, sourceDestinationId: 'source',
  };
  const rows = d6DayRows([
    stop('source', 1, 0),
    { ...stop('older', 1, 1), kind: 'accommodation' },
    stop('open', 1, 2),
    { ...stop('history', 1, 3), closedAt: '2026-11-01T00:00:00Z' },
  ], day, [stay]);
  expect(rows.map((row) => row.id)).toEqual(['older', 'open', 'stay']);
  expect(rows[0]).toMatchObject({ isLegacyStay: true });
});

it('inserts a pool item at the requested stop while preserving other open days', () => {
  const history = { ...stop('history', 1, 2), closedAt: '2026-11-01T00:00:00Z' };
  expect(d6Reorder([
    stop('pool', null, 0), stop('first', 1, 1), history, stop('tail', 1, 3), stop('next', 2, 4),
  ], { ids: ['pool'], day: 1, beforeId: 'tail' })).toEqual([
    { id: 'first', day: 1, position: 0 },
    { id: 'pool', day: 1, position: 1 },
    { id: 'tail', day: 1, position: 2 },
    { id: 'next', day: 2, position: 3 },
  ]);
});

it('describes the two neighboring stops before a dragged stop is released and excludes accommodations', () => {
  const rows: D6RouteRow[] = ['A', 'B', 'C', 'D'].map((id, index) => ({ kind: 'destination', id, destination: stop(id, 1, index) }));
  rows.splice(2, 0, { kind: 'destination', id: 'hotel', isLegacyStay: true,
    destination: { ...stop('hotel', 1, 2), kind: 'accommodation' } });
  expect(d6DropLabel(rows, 'D', { kind: 'row', id: 'B', edge: 'below' }, true)).toBe('放在「B」與「C」之間');
  expect(d6DropLabel(rows, 'D', { kind: 'row', id: 'A', edge: 'above' }, false)).toBe('Before A');
  expect(d6DropLabel(rows, 'D', { kind: 'row', id: 'C', edge: 'below' }, false)).toBe('After C');
  expect(d6DropLabel(rows, 'D', { kind: 'day', day: 2 }, true)).toBe('移至第 2 天');
});
