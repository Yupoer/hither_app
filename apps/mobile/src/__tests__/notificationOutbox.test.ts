jest.mock('../api/supabase', () => ({ supabase: {} }));
jest.mock('../api/demo', () => ({ isDemoGroup: () => false }));
jest.mock('../api/services/_helpers', () => ({ requireLocalActorId: jest.fn(async () => 'actor') }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'command-id' }));
jest.mock('../state/coreDataSync', () => ({
  getCoreOperationOutbox: () => ({ enqueueMutation: mockEnqueue }),
  flushCoreOperationOutbox: () => mockFlush(),
}));
const mockEnqueue = jest.fn(async () => ({}));
const mockFlush = jest.fn(async () => { throw new Error('offline'); });
import { sendCommand } from '../api/services/NotificationService';

it('persists notifications offline with actor binding, a stable id and five-minute expiry', async () => {
  const before = Date.now();
  await expect(sendCommand('group', 'need_restroom', 'message')).resolves.toBeUndefined();
  expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
    operationId: 'command-id', actorId: 'actor', groupId: 'group', operationType: 'send_command',
    payload: expect.objectContaining({ type: 'need_restroom', message: 'message' }),
  }));
  const queued = mockEnqueue.mock.calls[0] as unknown as [{ payload: { expiresAt: string } }];
  expect(Date.parse(queued[0].payload.expiresAt) - before).toBeGreaterThanOrEqual(300_000);
  expect(Date.parse(queued[0].payload.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
});
