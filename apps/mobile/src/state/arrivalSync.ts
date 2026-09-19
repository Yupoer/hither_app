import { getCoreOperationOutbox, flushCoreOperationOutbox } from './coreDataSync';
import type { Destination, DestinationArrival } from '../types';
import type { CoreOperation } from '../types/coreData';

/** The existing SQLite outbox is also the local arrival/history projection. */
export async function enqueueArrival(input: {
  groupId: string; actorId: string; userId: string; destination: Destination;
  arrivedAt: string; completeSolo: boolean;
  navigationSessionId?: string | null;
}): Promise<CoreOperation> {
  return getCoreOperationOutbox().enqueueArrival(input.groupId, input.destination.id, {
    actorId: input.actorId, userId: input.userId, destination: input.destination,
    arrivedAt: input.arrivedAt, completeSolo: input.completeSolo,
    navigationSessionId: input.navigationSessionId ?? null,
  });
}

export type ArrivalSyncStatus = 'acked' | 'queued' | 'retrying' | 'removed';

export async function syncArrival(operation: CoreOperation): Promise<ArrivalSyncStatus> {
  await flushCoreOperationOutbox();
  const current = await getCoreOperationOutbox().getOperation(operation.id);
  if (current?.status === 'conflict') {
    throw Object.assign(new Error(current.conflictResult?.message ?? '無法標記抵達'),
      current.conflictResult, { name: 'ArrivalSyncConflict' });
  }
  if (!current) return 'removed';
  if (current.status === 'acked') return 'acked';
  return current.status === 'failed' ? 'retrying' : 'queued';
}

export function projectArrivals(remote: DestinationArrival[], operations: CoreOperation[], actorId: string): DestinationArrival[] {
  let result = [...remote];
  for (const op of [...operations].sort((a, b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt))) {
    if (op.operationType !== 'record_arrival' || op.status === 'conflict'
      || op.payload.actorId !== actorId) continue;
    if (op.payload.arrived === false) {
      result = result.filter(a => a.destinationId !== op.entityId || a.userId !== op.payload.userId);
      continue;
    }
    if (result.some(a => a.destinationId === op.entityId && a.userId === op.payload.userId)) continue;
    result.push({ id: op.id, groupId: op.groupId, destinationId: op.entityId,
      userId: op.payload.userId as string, arrivedAt: op.payload.arrivedAt as string,
      source: 'manual', markedBy: actorId });
  }
  return result;
}

export function pendingSoloDestinationIds(operations: CoreOperation[], actorId: string): Set<string> {
  const latest = new Map<string, CoreOperation>();
  for (const op of [...operations].sort((a, b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt))) {
    if (op.operationType === 'record_arrival' && op.status !== 'conflict' && op.payload.actorId === actorId) {
      latest.set(`${op.entityId}:${op.payload.userId}`, op);
    }
  }
  return new Set([...latest.values()].filter(op => op.payload.arrived !== false && op.payload.completeSolo === true)
    .map(op => op.entityId));
}
