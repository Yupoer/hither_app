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
  navigationSessionAliases?: readonly string[];
  /** Physical event time, distinct from server receipt time. */
  occurredAt?: string;
  deviceId?: string;
  source?: 'automatic' | 'manual';
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
    ...(input.navigationSessionAliases ? { navigationSessionAliases: input.navigationSessionAliases } : {}),
    occurredAt,
    source: input.source ?? 'manual',
    ...(deviceId ? { deviceId } : {}),
  });
}

export function enqueueAutomaticArrival(input: {
  groupId: string; actorId: string; destination: Destination;
  navigationSessionId: string; navigationSessionAliases?: readonly string[]; sampledAtMs: number; deviceId?: string;
}): Promise<CoreOperation> {
  const occurredAt = new Date(input.sampledAtMs).toISOString();
  return enqueueArrival({ ...input, userId: input.actorId, source: 'automatic',
    arrivedAt: occurredAt, occurredAt, completeSolo: false });
}

export type EffectiveArrival = {
  sessionId: string; destinationId: string; userId: string; arrived: boolean;
  arrivedAt: string | null; source: DestinationArrival['source'] | null;
  markedBy: string | null; updatedAt?: string;
};

export function effectiveArrivalForOperation(op: CoreOperation): EffectiveArrival | null {
  if (op.status !== 'acked') return null;
  const value = op.payload.effectiveArrival;
  if (!value || typeof value !== 'object') {
    const sessionId = op.payload.navigationSessionId ?? op.payload.sessionId;
    const userId = op.payload.targetUserId ?? op.payload.userId;
    if ((op.operationType !== 'leader_correct_arrival' && op.payload.source !== 'leader_correction')
      || typeof sessionId !== 'string' || typeof userId !== 'string'
      || typeof op.payload.arrived !== 'boolean' || typeof op.payload.correctedAt !== 'string') return null;
    return { sessionId, destinationId: op.entityId, userId, arrived: op.payload.arrived,
      arrivedAt: null, source: 'leader_correction', markedBy: op.actorId ?? null,
      updatedAt: op.payload.correctedAt };
  }
  const row = value as Record<string, unknown>;
  if (typeof row.sessionId !== 'string' || typeof row.destinationId !== 'string'
    || typeof row.userId !== 'string' || typeof row.arrived !== 'boolean') return null;
  return { sessionId: row.sessionId, destinationId: row.destinationId, userId: row.userId,
    arrived: row.arrived, arrivedAt: typeof row.arrivedAt === 'string' ? row.arrivedAt : null,
    source: row.source === 'automatic' || row.source === 'manual' || row.source === 'leader_correction' ? row.source : null,
    markedBy: typeof row.markedBy === 'string' ? row.markedBy : null,
    ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}) };
}

/** Server correction versions retain PostgreSQL's fractional milliseconds. */
export function serverTimestampMs(value: string): number {
  const milliseconds = Date.parse(value);
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1];
  return milliseconds + (fraction && fraction.length > 3 ? Number(`0.${fraction.slice(3)}`) : 0);
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
  preservePersonalReceipt = false,
  corrections: readonly EffectiveArrival[] = [],
): DestinationArrival[] {
  // A new ACTIVE session starts with an empty personal projection. Historical
  // rows without a session remain available to the history surface, but are
  // never reused as the current session's tag/count.
  let result = sessionScope == null
    ? [...remote]
    : remote.filter((arrival) => belongsToSession(arrival.navigationSessionId, sessionScope));
  const authoritativeCorrections = [...corrections, ...operations
    .filter(op => (op.actorId ?? op.payload.actorId) === actorId)
    .map(effectiveArrivalForOperation).filter((row): row is EffectiveArrival => row?.source === 'leader_correction')];
  for (const correction of authoritativeCorrections.sort((a, b) =>
    serverTimestampMs(a.updatedAt ?? '') - serverTimestampMs(b.updatedAt ?? ''))) {
    if (sessionScope != null && !belongsToSession(correction.sessionId, sessionScope)) continue;
    const existing = result.find(row => row.destinationId === correction.destinationId
      && row.userId === correction.userId && row.navigationSessionId === correction.sessionId);
    if (existing?.updatedAt && correction.updatedAt
      && serverTimestampMs(existing.updatedAt) > serverTimestampMs(correction.updatedAt)) continue;
    result = result.filter(row => row.destinationId !== correction.destinationId
      || row.userId !== correction.userId || row.navigationSessionId !== correction.sessionId);
    if (correction.arrived) result.push({ id: `correction:${correction.sessionId}:${correction.userId}`,
      groupId: remote[0]?.groupId ?? operations[0]?.groupId ?? '', destinationId: correction.destinationId,
      userId: correction.userId, navigationSessionId: correction.sessionId, arrivedAt: correction.arrivedAt,
      source: 'leader_correction', markedBy: correction.markedBy ?? correction.userId, updatedAt: correction.updatedAt });
  }
  const eventOrder = (op: CoreOperation): number => {
    const occurredAt = typeof op.payload.occurredAt === 'string'
      ? Date.parse(op.payload.occurredAt)
      : Number.NaN;
    return Number.isFinite(occurredAt) ? occurredAt : (op.sequence ?? op.createdAt);
  };
  for (const op of [...operations].sort((a, b) => typeof a.sequence === 'number' && typeof b.sequence === 'number'
    ? a.sequence - b.sequence
    : eventOrder(a) - eventOrder(b) || a.createdAt - b.createdAt)) {
    const personalReceipt = op.operationType === 'record_arrival'
      && (op.actorId ?? op.payload.actorId) === actorId
      && op.payload.actorId === actorId && op.payload.userId === actorId
      && op.payload.source !== 'leader_correction';
    // A server rejection settles transport; it cannot erase a saved personal event.
    // Team projections still exclude rejected intent, including leader corrections.
    if (op.status === 'conflict' && !(preservePersonalReceipt && personalReceipt)) continue;
    const effective = effectiveArrivalForOperation(op);
    if (effective && (op.actorId ?? op.payload.actorId) === actorId) {
      if (sessionScope != null && !belongsToSession(effective.sessionId, sessionScope)) continue;
      const correction = authoritativeCorrections.filter(row => row.destinationId === effective.destinationId
        && row.userId === effective.userId && row.sessionId === effective.sessionId)
        .sort((a, b) => serverTimestampMs(b.updatedAt ?? '') - serverTimestampMs(a.updatedAt ?? '')).at(0);
      if (correction?.updatedAt && (!effective.updatedAt
        || serverTimestampMs(correction.updatedAt) >= serverTimestampMs(effective.updatedAt))) continue;
      const matches = (row: DestinationArrival) => row.destinationId === effective.destinationId
        && row.userId === effective.userId && row.navigationSessionId === effective.sessionId;
      const current = result.find(matches);
      if (current?.updatedAt && effective.updatedAt
        && serverTimestampMs(current.updatedAt) > serverTimestampMs(effective.updatedAt)) continue;
      result = result.filter(row => !matches(row));
      if (effective.arrived && effective.source) result.push({
        id: op.id, groupId: op.groupId, destinationId: effective.destinationId, userId: effective.userId,
        navigationSessionId: effective.sessionId, arrivedAt: effective.arrivedAt,
        source: effective.source, markedBy: effective.markedBy ?? effective.userId,
        ...(effective.updatedAt ? { updatedAt: effective.updatedAt } : {}),
      });
      continue;
    }
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
    if (op.operationType !== 'record_arrival' || op.payload.actorId !== actorId
      || (op.actorId != null && op.actorId !== actorId)) continue;
    if (sessionScope != null && !belongsToSession(op.payload.navigationSessionId, sessionScope)) continue;
    if (op.payload.source === 'automatic' && authoritativeCorrections.some(row => row.destinationId === op.entityId
      && row.userId === op.payload.userId && row.sessionId === op.payload.navigationSessionId)) continue;
    if (op.payload.arrived === false) {
      result = result.filter(a => a.destinationId !== op.entityId || a.userId !== op.payload.userId
        || (a.navigationSessionId ?? null) !== (op.payload.navigationSessionId ?? null));
      continue;
    }
    if (result.some(a => a.destinationId === op.entityId && a.userId === op.payload.userId
      && (a.navigationSessionId ?? null) === (op.payload.navigationSessionId ?? null))) continue;
    result.push({ id: op.id, groupId: op.groupId, destinationId: op.entityId,
      userId: op.payload.userId as string,
      arrivedAt: typeof op.payload.arrivedAt === 'string' ? op.payload.arrivedAt : null,
      source: op.payload.source === 'automatic' ? 'automatic' : 'manual', markedBy: actorId,
      ...(typeof op.payload.navigationSessionId === 'string'
        ? { navigationSessionId: op.payload.navigationSessionId }
        : {}),
    });
  }
  return result;
}

/** Personal UI/history only; never use rejected receipts for team completion. */
export function projectPersonalArrivals(
  remote: DestinationArrival[], operations: CoreOperation[], actorId: string,
  sessionScope?: ArrivalSessionScope, corrections: readonly EffectiveArrival[] = [],
): DestinationArrival[] {
  return projectArrivals(remote, operations, actorId, sessionScope, true, corrections);
}

/** Stable personal arrival/undo event time for native resume authority. */
export function personalArrivalEvent(
  remote: DestinationArrival[], operations: CoreOperation[], actorId: string,
  destinationId: string, sessionScope: ArrivalSessionScope, corrections: readonly EffectiveArrival[] = [],
): { atMs?: number; sequence?: number; correctionAtMs?: number } | undefined {
  const latest = operations.filter(op => op.operationType === 'record_arrival'
    && op.entityId === destinationId && op.payload.actorId === actorId
    && op.payload.userId === actorId && (op.actorId ?? actorId) === actorId
    && op.payload.source !== 'leader_correction'
    && belongsToSession(op.payload.navigationSessionId, sessionScope))
    .sort((a, b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt)).at(-1);
  const correctionVersions = [
    ...corrections.filter(row => row.destinationId === destinationId && row.userId === actorId
      && belongsToSession(row.sessionId, sessionScope)),
    ...operations.filter(op => (op.actorId ?? op.payload.actorId) === actorId)
      .map(effectiveArrivalForOperation).filter((row): row is EffectiveArrival => row != null
        && row.destinationId === destinationId && row.userId === actorId
        && belongsToSession(row.sessionId, sessionScope)),
    ...remote.filter(row => row.destinationId === destinationId && row.userId === actorId
      && belongsToSession(row.navigationSessionId, sessionScope)),
  ].filter(row => row.source === 'leader_correction' && row.updatedAt)
    .map(row => serverTimestampMs(row.updatedAt!)).filter(Number.isFinite);
  if (correctionVersions.length > 0) return { correctionAtMs: Math.max(...correctionVersions) };
  if (latest && effectiveArrivalForOperation(latest)?.arrived) {
    const effectiveRows = projectPersonalArrivals(remote, operations, actorId, sessionScope, corrections);
    const row = effectiveRows.find(item => item.destinationId === destinationId && item.userId === actorId);
    const atMs = row?.source !== 'leader_correction' && row?.arrivedAt ? Date.parse(row.arrivedAt) : Number.NaN;
    return Number.isFinite(atMs) ? { atMs } : undefined;
  }
  if (latest) {
    const eventTime = typeof latest.payload.occurredAt === 'string'
      ? Date.parse(latest.payload.occurredAt) : latest.createdAt;
    return Number.isFinite(eventTime) ? { atMs: eventTime,
      ...(typeof latest.sequence === 'number' ? { sequence: latest.sequence } : {}) } : undefined;
  }
  const times = remote.filter(row => row.destinationId === destinationId && row.userId === actorId
    && belongsToSession(row.navigationSessionId, sessionScope) && row.source !== 'leader_correction')
    .map(row => typeof row.arrivedAt === 'string' ? Date.parse(row.arrivedAt) : Number.NaN)
    .filter(Number.isFinite);
  return times.length > 0 ? { atMs: Math.max(...times) } : undefined;
}

export function personalArrivalEventTimeMs(
  remote: DestinationArrival[], operations: CoreOperation[], actorId: string,
  destinationId: string, sessionScope: ArrivalSessionScope,
): number | undefined {
  return personalArrivalEvent(remote, operations, actorId, destinationId, sessionScope)?.atMs;
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
