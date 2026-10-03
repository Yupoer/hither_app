import { refreshTeamLocations } from '../utils/refreshTeamLocations';
const requestedAt = '2026-10-03T12:30:13.000Z';
const request = { accepted: true, retryAfterSeconds: 60, recipientIds: ['peer'], requestedAt };
it('counts exact version ACKs separately from newer ordinary location samples', async () => {
  let clock = 1_000;
  const getAcknowledgedRecipientIds = jest.fn(async () => clock < 5_000 ? [] : ['peer']);
  const result = await refreshTeamLocations({
    pull: async () => true, uploadSelf: async () => true, requestPeers: async () => request,
    getMembers: () => [{ userId: 'peer', uploadedAt: '2026-10-03T12:30:59Z' }],
    cooling: false, now: () => clock, sleep: async ms => { clock += ms; }, getAcknowledgedRecipientIds,
  });
  expect(clock).toBe(5_000); expect(getAcknowledgedRecipientIds).toHaveBeenCalledWith(requestedAt);
  expect(result.respondedUserIds).toEqual(['peer']); expect(result.cooldownUntil).toBe(61_000);
  expect(result.acknowledgementsAvailable).toBe(true);
});
it('does not extend cooldown by GPS upload and recipient waits', async () => {
  let clock = 1_000; let release!: (value: boolean) => void;
  const run = refreshTeamLocations({
    pull: async () => true, uploadSelf: () => new Promise(resolve => { release = resolve; }),
    requestPeers: async () => request, getMembers: () => [], cooling: false,
    getAcknowledgedRecipientIds: async () => [], now: () => clock, sleep: async ms => { clock += ms; },
  });
  await new Promise(resolve => setTimeout(resolve, 0)); clock = 36_000; release(true);
  const result = await run;
  expect(result.cooldownUntil).toBe(61_000); expect(result.respondedUserIds).toEqual([]);
  expect(result.selfUploaded).toBe(true);
});
it('does not infer an ACK from a fresh position when the receipt service is unavailable', async () => {
  let clock = 0;
  const result = await refreshTeamLocations({
    pull: async () => true, uploadSelf: async () => true, requestPeers: async () => request,
    getMembers: () => [{ userId: 'peer', uploadedAt: '2026-10-03T12:31:00Z' }],
    getAcknowledgedRecipientIds: async () => { throw new Error('offline'); },
    cooling: false, now: () => clock, timeoutMs: 4_000, sleep: async ms => { clock += ms; },
  });
  expect(result.respondedUserIds).toEqual([]); expect(result.status).toBe('none');
  expect(result.acknowledgementsAvailable).toBe(false); expect(result.pulled).toBe(true);
});

it('separates a failed peer request from a server-enforced cooldown', async () => {
  const result = await refreshTeamLocations({
    pull: async () => true, uploadSelf: async () => true,
    requestPeers: async () => { throw new Error('offline'); }, getMembers: () => [], cooling: false,
  });
  expect(result.requestUnavailable).toBe(true);
  expect(result.cooldownUntil).toBeNull();
  expect(result.pulled).toBe(true);
});
it('does not require an ACK service when the server invited no recipients', async () => {
  const getAcknowledgedRecipientIds = jest.fn(async () => []);
  const result = await refreshTeamLocations({
    pull: async () => true, uploadSelf: async () => true,
    requestPeers: async () => ({ ...request, recipientIds: [] }), getMembers: () => [], cooling: false,
    getAcknowledgedRecipientIds,
  });
  expect(result.expectedUserIds).toEqual([]);
  expect(result.acknowledgementsAvailable).toBe(true);
  expect(getAcknowledgedRecipientIds).not.toHaveBeenCalled();
});

it('maps the server cooldown deadline into local time without adding RPC delay', async () => {
  let clock = 1_000;
  const result = await refreshTeamLocations({
    pull: async () => true, uploadSelf: async () => true,
    requestPeers: async () => { clock = 7_000; return { ...request, recipientIds: [] }; },
    getMembers: () => [], cooling: false, now: () => clock,
    serverTimeOffsetMs: Date.parse(requestedAt) - 1_000,
  });
  expect(result.cooldownUntil).toBe(61_000);
});
