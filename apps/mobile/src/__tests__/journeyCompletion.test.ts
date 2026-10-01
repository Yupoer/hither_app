const mockComplete = jest.fn(async (..._args: unknown[]) => ({ id: 'durable-completion', status: 'pending' }));
jest.mock('../state/coreDataSync', () => ({ enqueueDestinationComplete: (...args: unknown[]) => mockComplete(...args) }));
import { enqueueJourneyCompletion } from '../state/journeyCompletion';

const input = { actorId: 'leader', leaderId: 'leader', groupId: 'group', destinationId: 'stop',
  navigationSessionId: 'original-session', scopeSubgroupId: 'lane',
  navigationMemberIds: ['leader'], arrivedMemberIds: ['leader'], isCurrent: () => true };
beforeEach(() => jest.clearAllMocks());

test('solo and fully arrived scoped teams enqueue the same session-bound completion', async () => {
  await expect(enqueueJourneyCompletion(input)).resolves.toMatchObject({ id: 'durable-completion' });
  expect(mockComplete).toHaveBeenCalledWith({ groupId: 'group', destinationId: 'stop',
    sessionId: 'original-session', subgroupId: 'lane', actorId: 'leader', isCurrent: input.isCurrent, reason: 'all_arrived' });
  await enqueueJourneyCompletion({ ...input, navigationMemberIds: ['leader', 'member'], arrivedMemberIds: ['member', 'leader', 'outsider'] });
  expect(mockComplete).toHaveBeenCalledTimes(2);
});

test.each([
  { actorId: 'member' }, { actorId: '' }, { leaderId: undefined },
  { isCurrent: () => false }, { navigationSessionId: null },
  { navigationMemberIds: [] }, { navigationMemberIds: ['leader', 'missing'] },
])('does not auto-complete invalid authority, stale session or incomplete counts: %j', async patch => {
  await expect(enqueueJourneyCompletion({ ...input, ...patch })).resolves.toBeNull();
  expect(mockComplete).not.toHaveBeenCalled();
});

test('explicit leader force completion allows zero arrivals and no active session', async () => {
  await enqueueJourneyCompletion({ ...input, force: true, navigationSessionId: null,
    scopeSubgroupId: undefined, navigationMemberIds: [], arrivedMemberIds: [] });
  expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({ sessionId: null, subgroupId: null }));
  await expect(enqueueJourneyCompletion({ ...input, force: true, actorId: 'member' })).resolves.toBeNull();
  expect(mockComplete).toHaveBeenCalledTimes(1);
});
