import { exchangeGroup, type AcceptedLocationReceipt, type GroupRefreshExchange } from '../api/services/GroupSyncService';
import { requireUserId } from '../api/services/_helpers';
import type { GroupRecoverySnapshot } from '../api/services/GroupService';
import { getCoreOperationOutbox } from './coreDataSync';
import { exchangeLocationOutbox, type LocationFlushResult } from './locationOutbox';
import { captureLocationAccess } from './locationPrivacy';
import type { CoreOutboxFlushResult } from './coreOperationOutbox';
import type { CoreOperation } from '../types/coreData';

type ExchangeReply = Awaited<ReturnType<typeof exchangeGroup>>;
export type GroupSyncResult = ExchangeReply & { core: CoreOutboxFlushResult; location: LocationFlushResult };
const flights = new Map<string, Promise<GroupSyncResult>>();
const serial = new Map<string, Promise<unknown>>();
const listeners = new Set<(actorId: string, recovery: GroupRecoverySnapshot, pendingRefreshes: ExchangeReply['pendingRefreshes']) => void>();
const receipts = new Map<string, AcceptedLocationReceipt>();

export function subscribeGroupSyncSnapshots(listener: (actorId: string, recovery: GroupRecoverySnapshot, pendingRefreshes: ExchangeReply['pendingRefreshes']) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getAcceptedLocationReceipt(actorId: string, groupId: string, capturedAt: number): AcceptedLocationReceipt | undefined {
  const receipt = receipts.get(JSON.stringify([actorId, groupId]));
  return receipt?.capturedAt === capturedAt ? receipt : undefined;
}

export async function syncGroup(input: { groupId: string; refresh?: GroupRefreshExchange; maxCoreEntries?: number; maxLocationEntries?: number }): Promise<GroupSyncResult> {
  const actorId = await requireUserId();
  const lane = JSON.stringify([actorId, input.groupId]);
  const key = JSON.stringify([lane, input.refresh ?? {}, input.maxCoreEntries ?? 20, input.maxLocationEntries ?? 50]);
  const existing = flights.get(key);
  if (existing) return existing;
  const run = async () => {
    if (await requireUserId() !== actorId) throw new Error('account_changed');
    let reply: ExchangeReply | undefined;
    let location: LocationFlushResult | undefined;
    let attempted = false;
    const send = async (operations: CoreOperation[]) => {
      attempted = true;
      location = await exchangeLocationOutbox(input.groupId, actorId, async events => {
        const access = events.length ? await captureLocationAccess(input.groupId, true) : null;
        const permittedEvents = access ? events : [];
        reply = await exchangeGroup({ groupId: input.groupId, actorId, operations, events: permittedEvents,
          refresh: input.refresh ?? {}, signal: access?.signal });
        return { ...reply.locationResult,
          rejected: [...reply.locationResult.rejected, ...events.filter(event => !permittedEvents.includes(event))
            .map(event => ({ id: event.id, reason: access === null ? 'local_location_access_denied' : 'retryable' }))] };
      }, input.maxLocationEntries);
      if (!reply) throw new Error('group_sync_response_missing');
      return reply.coreResults;
    };
    const core = await getCoreOperationOutbox().flush(input.maxCoreEntries ?? 20, input.groupId, send);
    if (!attempted) await send([]);
    if (!reply || !location) throw new Error('group_sync_response_missing');
    if (await requireUserId() !== actorId) throw new Error('account_changed');
    for (const receipt of reply.locationReceipts) {
      const key = JSON.stringify([actorId, input.groupId]);
      if (receipt.capturedAt >= (receipts.get(key)?.capturedAt ?? -Infinity)) receipts.set(key, receipt);
    }
    for (const listener of listeners) listener(actorId, reply.recovery, reply.pendingRefreshes);
    return { ...reply, core, location };
  };
  const previous = serial.get(lane) ?? Promise.resolve();
  const flight = previous.then(run, run);
  serial.set(lane, flight);
  flights.set(key, flight);
  try { return await flight; } finally {
    if (flights.get(key) === flight) flights.delete(key);
    if (serial.get(lane) === flight) serial.delete(lane);
  }
}

export async function syncQueuedGroups(maxCoreEntries?: number): Promise<CoreOutboxFlushResult> {
  const groups = await getCoreOperationOutbox().pendingGroupIds();
  const result: CoreOutboxFlushResult = { sent: 0, conflicts: 0, duplicates: 0, remaining: 0, retryScheduled: 0 };
  for (const groupId of groups) {
    const { core } = await syncGroup({ groupId, maxCoreEntries });
    result.sent += core.sent; result.conflicts += core.conflicts; result.duplicates += core.duplicates;
    result.remaining += core.remaining; result.retryScheduled += core.retryScheduled;
    result.paused ||= core.paused;
  }
  return result;
}
