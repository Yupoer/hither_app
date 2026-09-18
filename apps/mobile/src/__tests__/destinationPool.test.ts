import type { Destination } from '../types';
import { filterActiveDestinations, nextOrderedDestination, promoteDestinationWithinDay } from '../utils/tripDay';
import { buildOpenReorderPayload } from '../utils/openReorderSlots';
import { legalDragIndicesForList, orderAfterDragMove, type ReorderListEntry } from '../utils/accommodationSemantics';
import { formatDistance } from '../utils/geo';
import { deriveActiveGatheringFromGroup, groupStateFromSnapshotParts } from '../utils/activeGatheringState';
import type { Group } from '../types';

const places: Destination[] = [
  { id: 'pool', title: 'Pool', day: null, order: 0, coordinates: { latitude: 25, longitude: 121 } },
  { id: 'first', title: 'First', day: 1, order: 1, coordinates: { latitude: 25, longitude: 121 } },
  { id: 'next', title: 'Next', day: 1, order: 2, coordinates: { latitude: 25, longitude: 121 } },
];

it('retains pool identity in reorders but excludes it from navigation with or without dates', () => {
  expect(filterActiveDestinations(places, null, null).map(d => d.id)).toEqual(['first', 'next']);
  expect(nextOrderedDestination(places)?.id).toBe('first');
  expect(filterActiveDestinations([places[0]], '2026-01-01', 1, new Date('2026-01-01'))).toEqual([]);
  expect(buildOpenReorderPayload(places)[0]).toMatchObject({ id: 'pool', day: null });
  expect(promoteDestinationWithinDay(places, 'next').map(d => [d.id, d.day])).toEqual([
    ['pool', null], ['next', 1], ['first', 1],
  ]);
});

it('keeps the pool in offline snapshots without making it a pending gathering', () => {
  const group = { id: 'group', journeyStatus: 'paused' } as Group;
  const gathering = deriveActiveGatheringFromGroup(group, places);
  expect(gathering.pointStatuses).not.toHaveProperty('pool');
  const snapshot = groupStateFromSnapshotParts(group, places, gathering);
  expect(snapshot.destinations).toHaveLength(3);
  expect(snapshot.nextDestination?.id).toBe('first');
  expect(groupStateFromSnapshotParts(group, [places[0]], gathering).nextDestination).toBeUndefined();
});

it('offers pool and empty-day drag boundaries without moving fixed headers or hotels into the pool', () => {
  const order: ReorderListEntry[] = [
    { type: 'header', id: 'pool-header', day: 0 },
    { type: 'dest', id: 'pool', day: 0, kind: 'stop' },
    { type: 'header', id: 'day1', day: 1 },
    { type: 'header', id: 'day2', day: 2 },
  ];
  expect(legalDragIndicesForList(order, 'pool')).toEqual(expect.arrayContaining([3, 4]));
  expect(legalDragIndicesForList(order, 'pool')).not.toContain(0);
  expect(legalDragIndicesForList(order, 'day1')).toEqual([2]);
  expect(orderAfterDragMove(order, 1, 4).map(d => d.id)).toEqual(['pool-header', 'day1', 'day2', 'pool']);
});

it.each([[0, '0 m'], [999, '999 m'], [999.9, '1000 m'], [1000, '1.0 km'], [1001, '1.0 km']])(
  'formats raw distance %s at the kilometre boundary', (metres, expected) => {
    expect(formatDistance(metres as number)).toBe(expected);
  },
);
