const mockEnqueue = jest.fn();
const mockGet = jest.fn();
const mockFlush = jest.fn(async () => undefined);
jest.mock('../state/coreDataSync', () => ({
  getCoreOperationOutbox: () => ({ enqueueArrival: mockEnqueue, getOperation: mockGet }),
  flushCoreOperationOutbox: () => mockFlush(),
}));
import { enqueueArrival, syncArrival } from '../state/arrivalSync';
import type { CoreOperation } from '../types/coreData';
const op = { id: 'receipt' } as CoreOperation;
beforeEach(() => jest.clearAllMocks());
it('preserves the session binding when saving an arrival locally', async () => {
  const destination = { id: 'stop', title: 'Park', coordinates: { latitude: 25, longitude: 121 }, order: 0, day: 1 };
  mockEnqueue.mockResolvedValue(op);
  await expect(enqueueArrival({ groupId: 'group', actorId: 'me', userId: 'me', destination,
    arrivedAt: '2026-09-19T00:00:00Z', completeSolo: false, navigationSessionId: 'trip' })).resolves.toBe(op);
  expect(mockEnqueue).toHaveBeenCalledWith('group', 'stop', expect.objectContaining({ navigationSessionId: 'trip', actorId: 'me' }));
});
it.each([
  ['pending', 'queued'], ['inflight', 'queued'], ['failed', 'retrying'], ['acked', 'acked'],
])('reports %s without pretending it was acknowledged', async (status, expected) => {
  mockGet.mockResolvedValue({ ...op, status });
  await expect(syncArrival(op)).resolves.toBe(expected);
  expect(mockFlush).toHaveBeenCalledTimes(1);
});
it('does not turn a removed row into an acknowledgement and preserves conflict classification', async () => {
  mockGet.mockResolvedValue(null);
  await expect(syncArrival(op)).resolves.toBe('removed');
  mockGet.mockResolvedValue({ ...op, status: 'conflict', conflictResult: { code: 'invalid_transition', message: 'session ended' } });
  await expect(syncArrival(op)).rejects.toMatchObject({ name: 'ArrivalSyncConflict', code: 'invalid_transition', message: 'session ended' });
});

it('captures automatic arrival using the original GPS sample and never completes a stop', async () => {
  const { enqueueAutomaticArrival } = require('../state/arrivalSync');
  mockEnqueue.mockResolvedValue(op);
  await enqueueAutomaticArrival({ groupId: 'group', actorId: 'me', navigationSessionId: 'trip',
    destination: { id: 'stop' }, sampledAtMs: Date.parse('2026-10-23T01:00:00Z'), deviceId: 'device' });
  expect(mockEnqueue).toHaveBeenCalledWith('group', 'stop', expect.objectContaining({
    actorId: 'me', userId: 'me', source: 'automatic', navigationSessionId: 'trip',
    arrivedAt: '2026-10-23T01:00:00.000Z', occurredAt: '2026-10-23T01:00:00.000Z', completeSolo: false,
  }));
});

it('uses the effective false ACK to remove stale personal, team and native arrival', () => {
  const { projectArrivals, projectPersonalArrivals, personalArrivalEvent } = require('../state/arrivalSync');
  const stale = [{ id: 'remote', groupId: 'group', destinationId: 'stop', userId: 'me',
    navigationSessionId: 'trip', arrivedAt: '2026-10-23T01:00:00Z', source: 'automatic', markedBy: 'me' }];
  const receipt = { ...op, groupId: 'group', actorId: 'me', entityId: 'stop', operationType: 'record_arrival',
    status: 'acked', createdAt: 1, updatedAt: 2, payload: { actorId: 'me', userId: 'me',
      navigationSessionId: 'trip', arrived: true, source: 'automatic', occurredAt: '2026-10-23T01:00:00Z',
      arrivalDisposition: 'leader_corrected', effectiveArrival: { sessionId: 'trip', destinationId: 'stop',
        userId: 'me', arrived: false, arrivedAt: null, source: 'leader_correction', markedBy: 'leader',
        updatedAt: '2026-10-23T01:01:00Z' } } };
  expect(projectArrivals(stale, [receipt], 'me', 'trip')).toEqual([]);
  expect(projectPersonalArrivals(stale, [receipt], 'me', 'trip')).toEqual([]);
  expect(personalArrivalEvent(stale, [receipt], 'me', 'stop', 'trip')).toEqual({ correctionAtMs: Date.parse('2026-10-23T01:01:00Z') });
  const newer = [{ ...stale[0], source: 'leader_correction', arrivedAt: null, markedBy: 'leader', updatedAt: '2026-10-23T01:02:00Z' }];
  expect(projectArrivals(newer, [receipt], 'me', 'trip')).toEqual(newer);
});

it('a newer remote false correction overrides an older true receipt in every projection', () => {
  const { projectArrivals, projectPersonalArrivals, personalArrivalEvent } = require('../state/arrivalSync');
  const receipt = { ...op, groupId: 'group', actorId: 'me', entityId: 'stop', operationType: 'record_arrival',
    status: 'acked', payload: { actorId: 'me', userId: 'me', navigationSessionId: 'trip', source: 'automatic',
      effectiveArrival: { sessionId: 'trip', destinationId: 'stop', userId: 'me', arrived: true,
        arrivedAt: '2026-10-23T01:00:00Z', source: 'automatic', markedBy: 'me', updatedAt: '2026-10-23T01:01:00Z' } } };
  const corrections = [{ sessionId: 'trip', destinationId: 'stop', userId: 'me', arrived: false,
    arrivedAt: null, source: 'leader_correction', markedBy: 'leader', updatedAt: '2026-10-23T01:02:00Z' }];
  expect(projectArrivals([], [receipt], 'me', 'trip', false, corrections)).toEqual([]);
  expect(projectPersonalArrivals([], [receipt], 'me', 'trip', corrections)).toEqual([]);
  expect(personalArrivalEvent([], [receipt], 'me', 'stop', 'trip', corrections)).toEqual({ correctionAtMs: Date.parse('2026-10-23T01:02:00Z') });
});

it('retains submillisecond correction versions independently of later GPS and sequence', () => {
  const { personalArrivalEvent, projectPersonalArrivals } = require('../state/arrivalSync');
  const correction = { sessionId: 'trip', destinationId: 'stop', userId: 'me', arrived: false,
    arrivedAt: null, source: 'leader_correction', markedBy: 'leader', updatedAt: '2026-10-23T01:00:00.123456Z' };
  const receipt = { ...op, groupId: 'group', actorId: 'me', entityId: 'stop', operationType: 'record_arrival',
    sequence: 42, createdAt: 1, status: 'acked', payload: { actorId: 'me', userId: 'me',
      navigationSessionId: 'trip', arrived: true, source: 'automatic', occurredAt: '2026-10-23T02:00:00Z',
      effectiveArrival: correction } };
  const laterCorrection = { ...correction, arrived: true, updatedAt: '2026-10-23T01:00:00.123457Z' };
  const event = personalArrivalEvent([], [receipt], 'me', 'stop', 'trip');
  expect(event).toEqual({ correctionAtMs: Date.parse('2026-10-23T01:00:00.123Z') + 0.456 });
  const later = personalArrivalEvent([], [receipt], 'me', 'stop', 'trip', [laterCorrection]);
  expect(later.correctionAtMs).toBeGreaterThan(event.correctionAtMs);
  expect(later).toEqual({ correctionAtMs: Date.parse('2026-10-23T01:00:00.123Z') + 0.457 });
  expect(projectPersonalArrivals([], [receipt], 'me', 'trip', [laterCorrection])).toEqual([
    expect.objectContaining({ source: 'leader_correction', updatedAt: laterCorrection.updatedAt }),
  ]);
  expect(personalArrivalEvent([], [receipt], 'me', 'stop', 'other-trip', [laterCorrection])).toBeUndefined();
  const newerFalse = { ...correction, updatedAt: '2026-10-23T01:00:00.123458Z' };
  expect(projectPersonalArrivals([], [receipt], 'me', 'trip', [newerFalse, laterCorrection])).toEqual([]);
});

it('exposes remote true correction authority without fabricating a personal GPS receipt', () => {
  const { personalArrivalEvent } = require('../state/arrivalSync');
  const remote = [{ destinationId: 'stop', userId: 'me', navigationSessionId: 'trip',
    source: 'leader_correction', arrivedAt: null, updatedAt: '2026-10-23T01:00:00.123456+00:00' }];
  expect(personalArrivalEvent(remote, [], 'me', 'stop', 'trip')).toEqual({
    correctionAtMs: Date.parse('2026-10-23T01:00:00.123Z') + 0.456,
  });
});

it('keeps an effective correction authoritative over a later unacknowledged GPS event', () => {
  const { personalArrivalEvent, projectPersonalArrivals } = require('../state/arrivalSync');
  const correction = { sessionId: 'trip', destinationId: 'stop', userId: 'me', arrived: false,
    arrivedAt: null, source: 'leader_correction', markedBy: 'leader', updatedAt: '2026-10-23T00:00:00Z' };
  const receipt = { ...op, groupId: 'group', actorId: 'me', entityId: 'stop', operationType: 'record_arrival',
    sequence: 1, createdAt: 1, status: 'acked', payload: { actorId: 'me', userId: 'me',
      navigationSessionId: 'trip', arrived: true, source: 'automatic', occurredAt: '2026-10-23T01:00:00Z',
      effectiveArrival: correction } };
  const later = { ...receipt, id: 'later', sequence: 2, status: 'pending', payload: { ...receipt.payload,
    effectiveArrival: undefined, occurredAt: '2026-10-23T02:00:00Z' } };
  expect(projectPersonalArrivals([], [receipt, later], 'me', 'trip')).toEqual([]);
  expect(personalArrivalEvent([], [receipt, later], 'me', 'stop', 'trip')).toEqual({
    correctionAtMs: Date.parse(correction.updatedAt),
  });
});


it.each([true, false])('replaces a retained raw leader ACK arrived=%s with the newer correction', arrived => {
  const { projectArrivals, personalArrivalEvent } = require('../state/arrivalSync');
  const receipt = { ...op, groupId: 'group', actorId: 'me', entityId: 'stop', operationType: 'leader_correct_arrival',
    status: 'acked', sequence: 1, payload: { actorId: 'me', targetUserId: 'me', sessionId: 'trip', arrived,
      correctedAt: '2026-10-23T01:00:00.123456Z' } };
  const newer = { sessionId: 'trip', destinationId: 'stop', userId: 'me', arrived: !arrived,
    arrivedAt: null, source: 'leader_correction', markedBy: 'other-device', updatedAt: '2026-10-23T01:00:00.123457Z' };
  const projected = projectArrivals([], [receipt], 'me', 'trip', false, [newer]);
  expect(projected.some((row: { userId: string }) => row.userId === 'me')).toBe(!arrived);
  expect(personalArrivalEvent([], [receipt], 'me', 'stop', 'trip', [newer])).toEqual({
    correctionAtMs: Date.parse('2026-10-23T01:00:00.123Z') + 0.457,
  });
  expect(projectArrivals([], [{ ...receipt, status: 'pending' }], 'me', 'trip', false, [newer])
    .some((row: { userId: string }) => row.userId === 'me')).toBe(arrived);
  expect(personalArrivalEvent([], [receipt], 'me', 'stop', 'trip')).toEqual({
    correctionAtMs: Date.parse('2026-10-23T01:00:00.123Z') + 0.456,
  });
});
