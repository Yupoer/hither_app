import { assessLocationRefreshResponses, waitForLocationRefreshResponses, type LocationRefreshMemberSnapshot } from './locationRefreshResponse';

/** Shared by the member button and headless integration tests. No GPS prerequisite for reads. */
export async function refreshTeamLocations(input: {
  pull: () => Promise<boolean>;
  uploadSelf: () => Promise<unknown>;
  requestPeers: () => Promise<{ accepted: boolean; retryAfterSeconds: number; recipientIds: string[]; requestedAt?: string }>;
  getMembers: () => readonly LocationRefreshMemberSnapshot[];
  cooling: boolean;
  timeoutMs?: number;
}) {
  const baselineLastUpdated = new Map(input.getMembers().map(m => [m.userId, m.lastUpdated]));
  const firstPull = input.pull().catch(() => false);
  const self = input.uploadSelf().then(value => Boolean(value), () => false);
  const request = input.cooling ? Promise.resolve(null) : input.requestPeers().catch(() => null);
  const result = await request;
  const expectedUserIds = result?.accepted ? result.recipientIds : [];
  // Legacy servers lack requestedAt: compare against the baseline, not this device's clock.
  const requestedAtMs = result?.requestedAt ? Date.parse(result.requestedAt) : 0;
  if (expectedUserIds.length) {
    await waitForLocationRefreshResponses({
      getMembers: input.getMembers, expectedUserIds, baselineLastUpdated, requestedAtMs,
      timeoutMs: input.timeoutMs ?? 20_000,
    });
  }
  const initialPulled = await firstPull;
  const selfUploaded = await self;
  const pulled = await input.pull().catch(() => false);
  return {
    pulled, initialPulled, selfUploaded, request: result,
    ...assessLocationRefreshResponses({ members: input.getMembers(), expectedUserIds, baselineLastUpdated, requestedAtMs }),
  };
}
