import { getCoreOperationOutbox, flushCoreOperationOutbox } from './coreDataSync';
import type { Destination, DestinationArrival } from '../types';
import type { CoreOperation } from '../types/coreData';

async function getArrivalDeviceId(): Promise<string | undefined> {
  try {
    // Lazy-load the native SecureStore seam. This keeps the local-first
    // projection usable in Jest/older clients where that Expo module is not
    // transformed, while production still uses the persisted device id.
    const service = require('../api/services/LiveActivityService') as {
      getOrCreateLiveActivityDeviceId: () => Promise<string>;
    };
    return await service.getOrCreateLiveActivityDeviceId();
  } catch {
    return undefined;
  }
}

/** The existing SQLite outbox is also the local arrival/history projection. */
export async function enqueueArrival(input: {
  groupId: string; actorId: string; userId: string; destination: Destination;
  arrivedAt: string | null; completeSolo: boolean;
  navigationSessionId?: string | null;
  /** Physical event time, distinct from server receipt time. */
  occurredAt?: string;
  deviceId?: string;
}): Promise<CoreOperation> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  let deviceId = input.deviceId;
  if (!deviceId) {
    deviceId = await getArrivalDeviceId();
  }
  return getCoreOperationOutbox().enqueueArrival(input.groupId, input.destination.id, {
    actorId: input.actorId, userId: input.userId, destination: input.destination,
    arrivedAt: input.arrivedAt, completeSolo: input.completeSolo,
    navigationSessionId: input.navigationSessionId ?? null,
    occurredAt,
    ...(deviceId ? { deviceId } : {}),
  });
}

export type ArrivalSyncStatus = 'acked' | 'queued' | 'retrying' | 'removed';

/** One active session, or the local/server aliases for the same session. */
export type ArrivalSessionScope = string | readonly string[];

function belongsToSession(
  value: unknown,
  scope: ArrivalSessionScope,
): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return Array.isArray(scope) ? scope.includes(value) : value === scope;
}

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

export function projectArrivals(
  remote: DestinationArrival[],
  operations: CoreOperation[],
  actorId: string,
  sessionScope?: ArrivalSessionScope,
): DestinationArrival[] {
  // A new ACTIVE session starts with an empty personal projection. Historical
  // rows without a session remain available to the history surface, but are
  // never reused as the current session's tag/count.
  let result = sessionScope == null
    ? [...remote]
    : remote.filter((arrival) => belongsToSession(arrival.navigationSessionId, sessionScope));
  const eventOrder = (op: CoreOperation): number => {
    const occurredAt = typeof op.payload.occurredAt === 'string'
      ? Date.parse(op.payload.occurredAt)
      : Number.NaN;
    return Number.isFinite(occurredAt) ? occurredAt : (op.sequence ?? op.createdAt);
  };
  for (const op of [...operations].sort((a, b) => eventOrder(a) - eventOrder(b)
    || (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt))) {
    if (op.status === 'conflict') continue;
    const isLeaderCorrection = op.operationType === 'leader_correct_arrival'
      || (op.operationType === 'record_arrival' && op.payload.source === 'leader_correction');
    if (isLeaderCorrection) {
      // Corrections are authored drafts. Never project a correction from a
      // different signed-in account after an account switch.
      if (op.actorId !== actorId) continue;
      const targetUserId = typeof op.payload.targetUserId === 'string'
        ? op.payload.targetUserId
        : typeof op.payload.userId === 'string'
          ? op.payload.userId
          : null;
      if (!targetUserId) continue;
      const correctionSession = op.payload.navigationSessionId ?? op.payload.sessionId;
      if (sessionScope != null && !belongsToSession(correctionSession, sessionScope)) continue;
      result = result.filter(a => a.destinationId !== op.entityId || a.userId !== targetUserId);
      if (op.payload.arrived !== false) {
        result.push({
          id: op.id,
          groupId: op.groupId,
          destinationId: op.entityId,
          userId: targetUserId,
          arrivedAt: null,
          source: 'leader_correction',
          markedBy: op.actorId ?? (typeof op.payload.actorId === 'string' ? op.payload.actorId : actorId),
          ...(typeof correctionSession === 'string'
            ? { navigationSessionId: correctionSession }
            : {}),
        });
      }
      continue;
    }
    if (op.operationType !== 'record_arrival' || op.payload.actorId !== actorId) continue;
    if (sessionScope != null && !belongsToSession(op.payload.navigationSessionId, sessionScope)) continue;
    if (op.payload.arrived === false) {
      result = result.filter(a => a.destinationId !== op.entityId || a.userId !== op.payload.userId);
      continue;
    }
    if (result.some(a => a.destinationId === op.entityId && a.userId === op.payload.userId)) continue;
    result.push({ id: op.id, groupId: op.groupId, destinationId: op.entityId,
      userId: op.payload.userId as string,
      arrivedAt: typeof op.payload.arrivedAt === 'string' ? op.payload.arrivedAt : null,
      source: 'manual', markedBy: actorId,
      ...(typeof op.payload.navigationSessionId === 'string'
        ? { navigationSessionId: op.payload.navigationSessionId }
        : {}),
    });
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
