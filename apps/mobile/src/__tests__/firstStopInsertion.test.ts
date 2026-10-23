import { insertFirstStop } from '../utils/firstStopInsertion';
import { projectOperationDestinations, projectOperationGroupState } from '../state/coreOperationProjection';
import { resolveAddDay } from '../utils/tripDay';
import type { Destination, GroupState } from '../types';
import type { CoreOperation } from '../types/coreData';

const stop = (id: string, order: number, patch: Partial<Destination> = {}): Destination => ({
  id, title: id, order, day: 2, kind: 'stop', coordinates: { latitude: 25, longitude: 121 }, ...patch,
});
const groupState = (destinations: Destination[]): GroupState => ({
  group: { id: 'group', name: 'Trip', inviteCode: 'TRIP', createdBy: 'actor',
    journeyStatus: 'paused', stragglerAlerts: false, stragglerThresholdM: 200 },
  members: [], subgroups: [], destinations,
});

const pending = (sequence: number, operationType: CoreOperation['operationType'], payload: CoreOperation['payload']): CoreOperation => ({
  id: `op-${sequence}`, groupId: 'group', entityType: 'itinerary', entityId: 'group', entityVersion: 0,
  attempts: 0, nextAttemptAt: 0, conflictResult: null, updatedAt: sequence, operationType,
  status: 'pending', sequence, createdAt: sequence, payload,
});

const firstStopAdd = (sequence: number, id: string) => pending(sequence, 'add_destination', {
  destinationId: id, title: id, latitude: 25, longitude: 121, day: 2, placement: 'firstStop',
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

it.each([{}, { day: 3 }, { subgroupId: 'sub' }, { kind: 'accommodation', stayAnchor: true }])(
  'replays reorder, first-stop add and later scope edits without changing the durable projection, patch=%j', patch => {
    const base = groupState([
      stop('a', 0), stop('b', 1), stop('other-day', 0, { day: 3 }), stop('other-scope', 0, { subgroupId: 'sub' }),
    ]);
    const operations = [pending(1, 'reorder_destinations', { updates: [
      { id: 'b', position: 0, day: 2 }, { id: 'a', position: 1, day: 2 },
    ] }), firstStopAdd(2, 'new'), pending(3, 'edit_destination', { destinationId: 'new', patch })];
    const projected = projectOperationGroupState(base, operations);
    expect(projected.destinations.find(item => item.id === 'new')).toMatchObject({ id: 'new', order: 0, ...patch });
    expect(projected.destinations.find(item => item.id === 'b')?.order).toBe(1);
    expect(projected.destinations.find(item => item.id === 'a')?.order).toBe(2);
    expect(projectOperationGroupState(projected, operations)).toEqual(projected);
    expect(projectOperationGroupState(projectOperationGroupState(projected, operations), operations)).toEqual(projected);
  },
);

it('replays multiple first-stop additions without order drift and lets a later reorder win', () => {
  const operations = [firstStopAdd(1, 'c'), firstStopAdd(2, 'd')];
  const first = projectOperationGroupState(groupState([stop('a', 0), stop('b', 1)]), operations);
  expect([...first.destinations].sort((a, b) => a.order - b.order).map(item => item.id)).toEqual(['d', 'c', 'a', 'b']);
  expect(projectOperationGroupState(first, operations)).toEqual(first);
  expect(projectOperationGroupState(projectOperationGroupState(first, operations), operations)).toEqual(first);
  const reordered = [...operations, pending(3, 'reorder_destinations', { updates: [
    { id: 'a', position: 0 }, { id: 'c', position: 1 }, { id: 'b', position: 2 }, { id: 'd', position: 3 },
  ] })];
  const final = projectOperationGroupState(first, reordered);
  expect(final.destinations.map(item => item.id)).toEqual(['a', 'c', 'b', 'd']);
  expect(projectOperationGroupState(final, reordered)).toEqual(final);
});

it.each([null, 2])('keeps the visible order of ordinary additions and other days on first-stop replay for day %s', day => {
  const quickAdd = firstStopAdd(2, 'quick');
  const operations = [pending(1, 'add_destination', { destinationId: 'ordinary', title: 'ordinary',
    latitude: 25, longitude: 121, day }), { ...quickAdd, payload: { ...quickAdd.payload, day } },
  pending(3, 'add_destination', { destinationId: 'last', title: 'last', latitude: 25, longitude: 121, day })];
  const otherDay = stop('other-day', 8, { day: day === null ? 2 : null });
  let projected = groupState([stop('a', 0, { day }), otherDay]);
  for (let replay = 0; replay < 3; replay += 1) {
    projected = projectOperationGroupState(projected, operations);
    expect(projected.destinations.filter(item => item.day === day).sort((a, b) => a.order - b.order).map(item => item.id))
      .toEqual(['quick', 'a', 'ordinary', 'last']);
    expect(projected.destinations.find(item => item.id === 'other-day')).toBe(otherDay);
  }
});

it('retains completed history, starting and ending stays, other scopes and existing server fields through replay', () => {
  const history = stop('history', 0, { closedAt: '2026-10-01T00:00:00Z' });
  const start = stop('start', 1, { kind: 'accommodation', stayAnchor: true });
  const tail = stop('tail', 4, { kind: 'accommodation', stayAnchor: true });
  const otherScope = stop('sub-stop', 0, { subgroupId: 'sub' });
  const operations = [pending(1, 'reorder_destinations', { updates: [
    { id: 'b', position: 2 }, { id: 'a', position: 3 },
  ] }), firstStopAdd(2, 'new'), pending(3, 'complete_destination', { destinationId: 'new' })];
  const fields = { emoji: 'X', markerColor: 'blue',
    meetAt: '2026-10-02T12:00:00Z', closedBySessionId: 'session' };
  const projected = projectOperationGroupState(groupState([history, start, stop('a', 2), stop('b', 3), tail, otherScope]), operations);
  const first = { ...projected, destinations: projected.destinations.map(item => item.id === 'new' ? { ...item, ...fields } : item) };
  expect(first.destinations.filter(item => !item.subgroupId).sort((a, b) => a.order - b.order).map(item => item.id))
    .toEqual(['history', 'start', 'new', 'b', 'a', 'tail']);
  expect(first.destinations.find(item => item.id === 'new')).toMatchObject({ title: 'new', ...fields, closedAt: new Date(3).toISOString() });
  expect(first.destinations.find(item => item.id === 'sub-stop')).toBe(otherScope);
  expect(projectOperationGroupState(first, operations)).toEqual(first);
});

it('replays group, member and daily stay metadata when destination effects are already represented', () => {
  const operations = [pending(1, 'set_trip_details', { tripDays: 4, departureDate: '2026-10-23' }),
    { ...pending(2, 'set_solo', { userId: 'actor', solo: true }), actorId: 'actor' },
    pending(3, 'set_daily_accommodation', { stayDate: '2026-10-23', day: 1,
      daily: { id: 'stay', groupId: 'group', stayDate: '2026-10-23', title: 'Hotel', coordinates: { latitude: 25, longitude: 121 } } })];
  const state = { ...groupState([stop('a', 0)]), projectedDestinationOperationIds: operations.map(op => op.id),
    members: [{ userId: 'actor', name: 'Actor', role: 'leader' as const, status: 'active' as const, solo: false }] };
  const projected = projectOperationGroupState(state, operations);
  expect(projected.destinations).toEqual(state.destinations);
  expect(projected.group).toMatchObject({ tripDays: 4, departureDate: '2026-10-23', accommodationAutoAdd: false });
  expect(projected.members[0].solo).toBe(true);
  expect(projected.dailyAccommodations).toEqual([expect.objectContaining({ id: 'stay', title: 'Hotel' })]);
});

it('uses day 1 before departure, today during travel and the last day after travel', () => {
  expect(resolveAddDay('2026-10-02', 3, new Date('2026-10-01T12:00:00'))).toBe(1);
  expect(resolveAddDay('2026-10-02', 3, new Date('2026-10-03T12:00:00'))).toBe(2);
  expect(resolveAddDay('2026-10-02', 3, new Date('2026-10-10T12:00:00'))).toBe(3);
  expect(resolveAddDay(null, null)).toBe(1);
});
