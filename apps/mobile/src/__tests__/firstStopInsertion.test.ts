import { insertFirstStop } from '../utils/firstStopInsertion';
import { projectOperationDestinations } from '../state/coreOperationProjection';
import { resolveAddDay } from '../utils/tripDay';
import type { Destination } from '../types';
import type { CoreOperation } from '../types/coreData';

const stop = (id: string, order: number, patch: Partial<Destination> = {}): Destination => ({
  id, title: id, order, day: 2, kind: 'stop', coordinates: { latitude: 25, longitude: 121 }, ...patch,
});

it('puts a new stop after history/start stay, before open stops, without crossing scopes', () => {
  const history = stop('history', 0, { closedAt: '2026-10-01T00:00:00Z' });
  const start = stop('start', 1, { kind: 'accommodation', stayAnchor: true });
  const subgroup = stop('subgroup', 2, { subgroupId: 'sub' });
  const previousDay = stop('day-1', 2, { day: 1 });
  const original = [history, start, stop('a', 2), stop('b', 3), subgroup, previousDay];
  const result = insertFirstStop(original, stop('new', 99));
  expect(result.filter(item => !item.subgroupId && item.day === 2).sort((a,b) => a.order-b.order).map(item => item.id))
    .toEqual(['history', 'start', 'new', 'a', 'b']);
  expect(result.find(item => item.id === 'history')).toBe(history);
  expect(result.find(item => item.id === 'subgroup')).toBe(subgroup);
  expect(result.find(item => item.id === 'day-1')).toBe(previousDay);
  expect(original.find(item => item.id === 'a')?.order).toBe(2);
});

it('handles empty days, a single starting stay and a locked tail without duplicating replay', () => {
  expect(insertFirstStop([], stop('new', 99))[0].order).toBe(0);
  const start = stop('start', 0, { kind: 'accommodation', stayAnchor: true });
  const tail = stop('tail', 1, { kind: 'accommodation', stayAnchor: true });
  expect(insertFirstStop([start], stop('new', 99)).find(item => item.id === 'new')?.order).toBe(1);
  const result = insertFirstStop([start, tail], stop('new', 99));
  expect(result.sort((a,b) => a.order-b.order).map(item => item.id)).toEqual(['start', 'new', 'tail']);
  expect(insertFirstStop(result, stop('new', 99))).toBe(result);
});

it('reprojects pending quick-add ahead of server rows, but keeps ordinary add appended', () => {
  const operation: CoreOperation = { id: 'op', groupId: 'group', entityType: 'itinerary', entityVersion: 1,
    attempts: 0, nextAttemptAt: 0, conflictResult: null, updatedAt: 1, operationType: 'add_destination', entityId: 'group', status: 'pending', sequence: 1,
    createdAt: 1, payload: { destinationId: 'new', title: 'New', latitude: 25, longitude: 121,
      day: 2, placement: 'firstStop' } };
  const projected = projectOperationDestinations([stop('old', 0)], [operation]);
  expect(projected.find(item => item.id === 'new')?.order).toBe(0);
  expect(projected.find(item => item.id === 'old')?.order).toBe(1);
  expect(projectOperationDestinations(projected, [operation])).toEqual(projected);
  expect(projectOperationDestinations([stop('old', 0)], [{ ...operation,
    payload: { ...operation.payload, placement: undefined } }]).find(item => item.id === 'new')?.order).toBe(1);
});

it('uses day 1 before departure, today during travel and the last day after travel', () => {
  expect(resolveAddDay('2026-10-02', 3, new Date('2026-10-01T12:00:00'))).toBe(1);
  expect(resolveAddDay('2026-10-02', 3, new Date('2026-10-03T12:00:00'))).toBe(2);
  expect(resolveAddDay('2026-10-02', 3, new Date('2026-10-10T12:00:00'))).toBe(3);
  expect(resolveAddDay(null, null)).toBe(1);
});
