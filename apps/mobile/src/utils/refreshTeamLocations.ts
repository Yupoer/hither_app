import { assessLocationRefreshResponses, type LocationRefreshMemberSnapshot } from './locationRefreshResponse';
import { requestWithDeadline } from './requestDeadline';

/** Shared by the member button and headless integration tests. No GPS prerequisite for reads. */
export async function refreshTeamLocations(input: {
  pull: () => Promise<boolean>;
  uploadSelf: () => Promise<unknown>;
  requestPeers: () => Promise<{ accepted: boolean; retryAfterSeconds: number; recipientIds: string[]; requestedAt?: string }>;
  getMembers: () => readonly LocationRefreshMemberSnapshot[];
  /** Reads durable exact-version ACKs; ordinary newer GPS is not a response. */
  getAcknowledgedRecipientIds?: (requestedAt: string) => Promise<string[]>;
  exchange?: (input: { requestPeers?: boolean; requestedAt?: string }) => Promise<{
    pulled: boolean;
    request: { accepted: boolean; retryAfterSeconds: number; recipientIds: string[]; requestedAt?: string } | null;
    acknowledgedIds: string[];
  }>;
  cooling: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** server time minus local time, learned from the authoritative group read. */
  serverTimeOffsetMs?: number;
}) {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const baselineLastUpdated = new Map(input.getMembers().map(m => [m.userId, m.uploadedAt ?? m.lastUpdated]));
  const bounded = <T>(work: Promise<T>, timeoutMs = 10_000) => requestWithDeadline(() => work, timeoutMs);
  const firstExchange = input.exchange ? bounded(input.exchange({ requestPeers: !input.cooling })) : null;
  const firstPull = (firstExchange ? firstExchange.then(reply => reply.pulled) : bounded(input.pull())).catch(() => false);
  // Include permission/session/storage waits, not only the native sensor timeout.
  const self = bounded(input.uploadSelf(), 35_000).then(value => Boolean(value), () => false);
  const request = firstExchange ? firstExchange.then(reply => reply.request).catch(() => null)
    : input.cooling ? Promise.resolve(null) : bounded(input.requestPeers()).catch(() => null);
  const result = await request;
  const serverDeadline = result?.requestedAt && input.serverTimeOffsetMs != null
    ? Date.parse(result.requestedAt) + 60_000 - input.serverTimeOffsetMs : NaN;
  const cooldownUntil = result
    ? Number.isFinite(serverDeadline) ? serverDeadline : now() + result.retryAfterSeconds * 1000
    : null;
  const expectedUserIds = result?.accepted ? result.recipientIds : [];
  // Server request version is independent of this device's clock.
  const requestedAtMs = result?.requestedAt ? Date.parse(result.requestedAt) : 0;
  let acknowledgementsAvailable = result?.accepted === true && expectedUserIds.length === 0;
  let acknowledgedRecipientIds: string[] = [];
  const readAcknowledgements = async () => {
    if (expectedUserIds.length && result?.requestedAt && (input.exchange || input.getAcknowledgedRecipientIds)) {
      // Missing/unavailable receipt endpoint is unknown, never an inferred ACK.
      try {
        acknowledgedRecipientIds = input.exchange
          ? (await bounded(input.exchange({ requestedAt: result.requestedAt }))).acknowledgedIds
          : await bounded(input.getAcknowledgedRecipientIds!(result.requestedAt));
        acknowledgementsAvailable = true;
      } catch {
        acknowledgementsAvailable = false;
      }
    }
  };
  if (expectedUserIds.length && result?.requestedAt && (input.exchange || input.getAcknowledgedRecipientIds)) {
    const deadline = now() + (input.timeoutMs ?? 20_000);
    while (true) {
      await readAcknowledgements();
      if (!acknowledgementsAvailable || expectedUserIds.every(id => acknowledgedRecipientIds.includes(id)) || now() >= deadline) break;
      await sleep(Math.min(2_000, Math.max(0, deadline - now())));
    }
  }
  const initialPulled = await firstPull;
  const selfUploaded = await self;
  const finalExchange = input.exchange
    ? await bounded(input.exchange({ requestedAt: result?.requestedAt })).catch(() => null) : null;
  const pulled = input.exchange ? finalExchange?.pulled === true : await bounded(input.pull()).catch(() => false);
  if (finalExchange) {
    acknowledgedRecipientIds = finalExchange.acknowledgedIds;
    acknowledgementsAvailable = result?.accepted === true;
  } else await readAcknowledgements();
  return {
    cooldownUntil, acknowledgementsAvailable,
    requestUnavailable: !input.cooling && result == null,
    pulled, initialPulled, selfUploaded, request: result,
    ...assessLocationRefreshResponses({ members: input.getMembers(), expectedUserIds, baselineLastUpdated, requestedAtMs, acknowledgedRecipientIds }),
  };
}
