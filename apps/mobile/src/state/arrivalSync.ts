import { getCoreOperationOutbox, flushCoreOperationOutbox } from './coreDataSync';
import type { Destination, DestinationArrival } from '../types';
import type { CoreOperation } from '../types/coreData';

/** The existing SQLite outbox is also the local arrival/history projection. */
export async function enqueueArrival(input: {
  groupId: string; actorId: string; userId: string; destination: Destination;
  arrivedAt: string; completeSolo: boolean;
}): Promise<CoreOperation> {
  return getCoreOperationOutbox().enqueueArrival(input.groupId, input.destination.id, {
    actorId: input.actorId, userId: input.userId, destination: input.destination,
    arrivedAt: input.arrivedAt, completeSolo: input.completeSolo,
  });
}

export async function syncArrival(operation: CoreOperation): Promise<void> {
  await flushCoreOperationOutbox();
  const current = await getCoreOperationOutbox().getOperation(operation.id);
  if (current?.status === 'conflict') {
    throw Object.assign(new Error(current.conflictResult?.message ?? '無法標記抵達'), { name: 'ArrivalSyncConflict' });
  }
}

export function projectArrivals(remote: DestinationArrival[], operations: CoreOperation[], actorId: string): DestinationArrival[] {
  const result = [...remote];
  for (const op of operations) {
    if (op.operationType !== 'record_arrival' || op.status === 'conflict' || op.payload.actorId !== actorId) continue;
    if (result.some(a => a.destinationId === op.entityId && a.userId === op.payload.userId)) continue;
    result.push({ id: op.id, groupId: op.groupId, destinationId: op.entityId,
      userId: op.payload.userId as string, arrivedAt: op.payload.arrivedAt as string,
      source: 'manual', markedBy: actorId });
  }
  return result;
}

export function pendingSoloDestinationIds(operations: CoreOperation[], actorId: string): Set<string> {
  return new Set(operations.filter(op => op.operationType === 'record_arrival'
    && op.status !== 'conflict' && op.payload.actorId === actorId && op.payload.completeSolo === true)
    .map(op => op.entityId));
}
