export interface LocationRefreshMemberSnapshot {
  userId: string;
  status?: string | null;
  lastUpdated?: string | null;
}

export type LocationRefreshResponseStatus = 'all' | 'partial' | 'none';

export interface LocationRefreshResponseResult {
  status: LocationRefreshResponseStatus;
  expectedUserIds: string[];
  respondedUserIds: string[];
}

export function expectedLocationRefreshRecipientIds(
  members: readonly LocationRefreshMemberSnapshot[],
  requesterId: string | null | undefined,
): string[] {
  return members
    .filter((member) => member.userId !== requesterId && member.status !== 'offline')
    .map((member) => member.userId);
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function assessLocationRefreshResponses({
  members,
  expectedUserIds,
  baselineLastUpdated,
  requestedAtMs,
}: {
  members: readonly LocationRefreshMemberSnapshot[];
  expectedUserIds: readonly string[];
  baselineLastUpdated: ReadonlyMap<string, string | null | undefined>;
  requestedAtMs: number;
}): LocationRefreshResponseResult {
  const expected = [...expectedUserIds];
  const respondedUserIds = expected.filter((userId) => {
    const member = members.find((candidate) => candidate.userId === userId);
    const currentMs = timestampMs(member?.lastUpdated);
    const baselineMs = timestampMs(baselineLastUpdated.get(userId));
    return currentMs != null
      && currentMs >= requestedAtMs
      && (baselineMs == null || currentMs > baselineMs);
  });
  const status: LocationRefreshResponseStatus = respondedUserIds.length === expected.length
    ? 'all'
    : respondedUserIds.length === 0
      ? 'none'
      : 'partial';
  return { status, expectedUserIds: expected, respondedUserIds };
}

export async function waitForLocationRefreshResponses({
  getMembers,
  expectedUserIds,
  baselineLastUpdated,
  requestedAtMs,
  timeoutMs = 8_000,
  pollIntervalMs = 250,
  now = () => Date.now(),
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  getMembers: () => readonly LocationRefreshMemberSnapshot[];
  expectedUserIds: readonly string[];
  baselineLastUpdated: ReadonlyMap<string, string | null | undefined>;
  requestedAtMs: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<LocationRefreshResponseResult> {
  const deadline = now() + Math.max(0, timeoutMs);
  while (true) {
    const result = assessLocationRefreshResponses({
      members: getMembers(),
      expectedUserIds,
      baselineLastUpdated,
      requestedAtMs,
    });
    if (result.status === 'all' || now() >= deadline) return result;
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
}
