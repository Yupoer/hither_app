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
