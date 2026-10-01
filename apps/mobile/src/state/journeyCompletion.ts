import type { CoreOperation } from '../types/coreData';
import { enqueueDestinationComplete } from './coreDataSync';

/** Shared foreground/background completion; the outbox owns durable deduplication. */
export async function enqueueJourneyCompletion(input: {
  groupId: string;
  destinationId: string;
  navigationSessionId: string | null;
  actorId: string;
  scopeSubgroupId?: string | null;
  leaderId?: string;
  navigationMemberIds: readonly string[];
  arrivedMemberIds: readonly string[];
  force?: boolean;
  isCurrent: () => boolean;
}): Promise<CoreOperation | null> {
  if (!input.actorId || input.actorId !== input.leaderId || !input.isCurrent()) return null;
  const arrived = new Set(input.arrivedMemberIds);
  if (!input.force && (!input.navigationSessionId || input.navigationMemberIds.length === 0
    || !input.navigationMemberIds.every(id => arrived.has(id)))) return null;
  return enqueueDestinationComplete({
    groupId: input.groupId,
    destinationId: input.destinationId,
    sessionId: input.navigationSessionId,
    actorId: input.actorId,
    subgroupId: input.scopeSubgroupId ?? null,
    isCurrent: input.isCurrent,
    reason: input.force ? 'forced' : 'all_arrived',
  });
}
