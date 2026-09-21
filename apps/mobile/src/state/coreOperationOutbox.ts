import { operationWirePayload, rollbackItinerary, type ItineraryRollback } from './itineraryRollback';
/**
 * OTA-04 core operation outbox.
 *
 * Local optimistic state and outbox rows are written in ONE exclusive
 * transaction (no nested BEGIN). Replays preserve identity; stale versions
 * are retried automatically and invalid intent settles without a blocking UI.
 */

import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Destination } from '../types';
import type {
  ActiveGatheringState,
  ApplyCoreOperationResult,
  CoreConflictResult,
  CoreEntityType,
  CoreOperation,
  CoreOperationStatus,
  CoreOperationType,
  NavigationAnnouncementResponse,
  NavigationAnnouncementResponseKind,
} from '../types/coreData';
import {
  endGathering,
  isUsableActiveGatheringState,
  startGathering,
  switchGathering,
} from '../utils/activeGatheringState';
import {
  MemoryCoreDataDatabase,
  runCoreDataWriteLock,
  type CoreDataDatabase,
  type CoreSqlExecutor,
} from './coreDataStore';
import { getHitherDatabase } from './hitherDatabase';
import { classifyOperationError } from '../utils/operationError';
import { projectOperationDestinations } from './coreOperationProjection';

type OutboxListener = () => void;
const outboxListeners = new Set<OutboxListener>();

/** Subscribe to outbox mutations (enqueue / flush / conflict). */
export function subscribeCoreOutboxChanges(listener: OutboxListener): () => void {
  outboxListeners.add(listener);
  return () => {
    outboxListeners.delete(listener);
  };
}

function notifyCoreOutboxChanged(): void {
  for (const listener of outboxListeners) {
    try {
      listener();
    } catch {
      // Listener errors must not break outbox.
    }
  }
}

const MAX_BACKOFF_MS = 15 * 60 * 1_000;
const MAX_BATCH = 20;

export interface CoreOutboxFlushResult {
  sent: number;
  conflicts: number;
  duplicates: number;
  remaining: number;
  retryScheduled: number;
  /** No row was poisoned because the current account/session could not own it. */
  paused?: boolean;
}

export type CoreOperationSubmitter = (
  operation: CoreOperation,
) => Promise<ApplyCoreOperationResult>;

export interface CoreOperationOutboxDatabase {
  initialize(): Promise<void>;
  allocateSequence(actorId: string, groupId: string): Promise<number>;
  /** Allocate on the executor that also writes the local projection. */
  writeAllocateSequence(
    exec: CoreSqlExecutor,
    actorId: string,
    groupId: string,
  ): Promise<number>;
  insert(operation: CoreOperation): Promise<void>;
  /** Insert using an executor already inside an exclusive transaction. */
  writeInsert(exec: CoreSqlExecutor, operation: CoreOperation): Promise<void>;
  /** Update using an executor already inside an exclusive transaction. */
  writeUpdate(exec: CoreSqlExecutor, operation: CoreOperation): Promise<void>;
  /** Delete using an executor already inside an exclusive transaction. */
  writeDelete(exec: CoreSqlExecutor, id: string): Promise<void>;
  get(id: string): Promise<CoreOperation | null>;
  getDue(now: number, limit: number): Promise<CoreOperation[]>;
  update(operation: CoreOperation): Promise<void>;
  delete(id: string): Promise<void>;
  countPending(): Promise<number>;
  countPendingForEntity(
    groupId: string,
    entityType: CoreEntityType,
    entityId: string,
  ): Promise<number>;
  listByGroup(groupId: string): Promise<CoreOperation[]>;
  listAll(): Promise<CoreOperation[]>;
  listOpenByGroup(groupId: string): Promise<CoreOperation[]>;
  withExclusiveTransaction<T>(
    work: (exec: CoreSqlExecutor) => Promise<T>,
  ): Promise<T>;
}

interface OutboxRow {
  id: string;
  actor_id?: string | null;
  group_id: string;
  entity_type: string;
  entity_id: string;
  entity_version: number;
  operation_type: string;
  payload: string;
  sequence?: number | null;
  dependency_ids?: string | null;
  status: string;
  attempts: number;
  next_attempt_at: number;
  conflict_result: string | null;
  inflight_started_at?: number | null;
  last_error?: string | null;
  created_at: number;
  updated_at: number;
}

function rowToOperation(row: OutboxRow): CoreOperation {
  return {
    id: row.id,
    ...(row.actor_id ? { actorId: row.actor_id } : {}),
    groupId: row.group_id,
    entityType: row.entity_type as CoreEntityType,
    entityId: row.entity_id,
    entityVersion: row.entity_version,
    operationType: row.operation_type as CoreOperationType,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    sequence: row.sequence ?? 0,
    dependencyIds: row.dependency_ids ? (JSON.parse(row.dependency_ids) as string[]) : [],
    createdAt: row.created_at,
    status: row.status as CoreOperationStatus,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    conflictResult: row.conflict_result
      ? (JSON.parse(row.conflict_result) as CoreConflictResult)
      : null,
    ...(row.inflight_started_at == null ? {} : { inflightStartedAt: row.inflight_started_at }),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    updatedAt: row.updated_at,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sameOperationIntent(a: CoreOperation, b: CoreOperation): boolean {
  return a.actorId === b.actorId
    && a.groupId === b.groupId
    && a.entityType === b.entityType
    && a.entityId === b.entityId
    && a.entityVersion === b.entityVersion
    && a.operationType === b.operationType
    && stableJson(operationWirePayload(a.payload)) === stableJson(operationWirePayload(b.payload))
    && stableJson(a.dependencyIds ?? []) === stableJson(b.dependencyIds ?? []);
}

const ITINERARY_MUTATION_TYPES: readonly CoreOperationType[] = [
  'add_destination',
  'edit_destination',
  'delete_destination',
  'reorder_destinations',
  'set_destination_meet_time',
  'complete_destination',
];

function isItineraryMutation(operation: CoreOperation): boolean {
  return operation.entityType === 'itinerary'
    && ITINERARY_MUTATION_TYPES.includes(operation.operationType);
}

/**
 * Dependencies are generated by the local FIFO lane. On an idempotent retry a
 * caller normally does not know the generated dependency list, so compare the
 * caller's explicit dependencies only when it supplied any. Payload and all
 * mutation identity fields are always compared before local projection.
 */
function sameEnqueueIntent(existing: CoreOperation, incoming: CoreOperation): boolean {
  const normalizedIncoming = incoming.dependencyIds?.length
    ? incoming
    : { ...incoming, dependencyIds: existing.dependencyIds ?? [] };
  return sameOperationIntent(existing, normalizedIncoming);
}

function operationIdMismatch(): Error & { code: string } {
  return Object.assign(new Error('operation id is already bound to a different intent'), {
    code: 'operation_id_mismatch',
  });
}

/** Accept both the durable RPC's nested coordinates and old flat responses. */
function normalizeItineraryDestinations(value: unknown): Destination[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .map((row) => {
      const coordinates = row.coordinates && typeof row.coordinates === 'object'
        ? row.coordinates as Record<string, unknown>
        : null;
      const latitude = Number(coordinates?.latitude ?? row.latitude ?? 0);
      const longitude = Number(coordinates?.longitude ?? row.longitude ?? 0);
      const kind = row.kind === 'accommodation' ? 'accommodation' as const : 'stop' as const;
      return {
        id: String(row.id ?? ''),
        title: String(row.title ?? ''),
        order: Number(row.order ?? row.position ?? 0),
        day: typeof row.day === 'number' ? row.day : null,
        address: typeof row.address === 'string' ? row.address : undefined,
        coordinates: { latitude, longitude },
        meetAt: typeof row.meetAt === 'string' ? row.meetAt : undefined,
        meetRedMinutes: typeof row.meetRedMinutes === 'number' ? row.meetRedMinutes : undefined,
        closedAt: typeof row.closedAt === 'string' ? row.closedAt : undefined,
        closedBySessionId: typeof row.closedBySessionId === 'string' ? row.closedBySessionId : undefined,
        emoji: typeof row.emoji === 'string' ? row.emoji : null,
        markerColor: typeof row.markerColor === 'string' ? row.markerColor : null,
        subgroupId: typeof row.subgroupId === 'string' ? row.subgroupId : undefined,
        kind,
        stayAnchor: kind === 'accommodation' && row.stayAnchor === true,
        providerPlaceId: typeof row.providerPlaceId === 'string' ? row.providerPlaceId : undefined,
      };
    });
}

async function insertOutboxRow(
  exec: CoreSqlExecutor,
  operation: CoreOperation,
): Promise<void> {
  const existing = await exec.getFirstAsync<OutboxRow>(
    'SELECT * FROM core_operation_outbox WHERE id = ?',
    operation.id,
  );
  if (existing) {
    const current = rowToOperation(existing);
    if (!sameOperationIntent(current, operation)) throw operationIdMismatch();
    return;
  }
  await exec.runAsync(
    `INSERT INTO core_operation_outbox
       (id, actor_id, group_id, entity_type, entity_id, entity_version, operation_type,
        payload, sequence, dependency_ids, status, attempts, next_attempt_at,
        conflict_result, inflight_started_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    operation.id,
    operation.actorId ?? null,
    operation.groupId,
    operation.entityType,
    operation.entityId,
    operation.entityVersion,
    operation.operationType,
    JSON.stringify(operation.payload),
    operation.sequence ?? 0,
    JSON.stringify(operation.dependencyIds ?? []),
    operation.status,
    operation.attempts,
    operation.nextAttemptAt,
    operation.conflictResult ? JSON.stringify(operation.conflictResult) : null,
    operation.inflightStartedAt ?? null,
    operation.lastError ?? null,
    operation.createdAt,
    operation.updatedAt,
  );
}

/** Resource ordering, not one head-of-line queue for the entire group. */
export function operationResources(operation: CoreOperation): string[] {
  const prefix = `${operation.actorId ?? ''}:${operation.groupId}:`;
  const payload = operation.payload;
  const destinationId = payload.destinationId ?? payload.activeDestinationId;
  let resources: string[];
  if (operation.operationType === 'send_command') resources = [`command:${operation.id}`];
  else if (operation.operationType === 'record_arrival' || operation.operationType === 'leader_correct_arrival') {
    resources = [`arrival:${operation.entityId}:${payload.userId ?? payload.targetUserId}:${payload.navigationSessionId ?? payload.sessionId ?? ''}`];
  } else if (operation.entityType === 'active_gathering'
    || operation.operationType === 'complete_destination'
    || operation.operationType === 'delete_destination') {
    resources = [`journey:${payload.subgroupId ?? 'main'}`];
    if (destinationId) resources.push(`destination:${destinationId}`);
  } else if (operation.operationType === 'reorder_destinations' && Array.isArray(payload.updates) && payload.updates.length) {
    resources = payload.updates.map((item: { id?: string }) => `destination:${item.id}`);
  } else if (destinationId) resources = [`destination:${destinationId}`];
  else resources = [`${operation.entityType}:${operation.entityId}`];
  return resources.map(resource => prefix + resource);
}

function relatedOperations(a: CoreOperation, b: CoreOperation): boolean {
  const resources = new Set(operationResources(a));
  return operationResources(b).some(resource => resources.has(resource));
}

function isPrerequisite(prior: CoreOperation, next: CoreOperation): boolean {
  if (prior.actorId !== next.actorId || prior.groupId !== next.groupId) return false;
  if (relatedOperations(prior, next)) return true;
  return createsRequiredEntity(prior, next);
}

function createsRequiredEntity(prior: CoreOperation, next: CoreOperation): boolean {
  if (prior.actorId !== next.actorId || prior.groupId !== next.groupId) return false;
  if (prior.operationType === 'start_gathering' || prior.operationType === 'switch_gathering') {
    const session = next.payload.navigationSessionId ?? next.payload.sessionId;
    if (session && session === prior.payload.navigationRequestId) return true;
  }
  return prior.operationType === 'add_destination' && next.operationType === 'record_arrival'
    && prior.payload.destinationId === next.entityId;
}

function precedes(prior: CoreOperation, next: CoreOperation): boolean {
  return (prior.sequence && next.sequence)
    ? prior.sequence < next.sequence
    : prior.createdAt < next.createdAt;
}

/** Infer causal edges lost by the old single-predecessor FIFO, without rewriting wire identity. */
function dependsOn(next: CoreOperation, prior: CoreOperation): boolean {
  return prior.id !== next.id
    && (((next.dependencyIds ?? []).includes(prior.id) && isPrerequisite(prior, next))
      || (precedes(prior, next) && createsRequiredEntity(prior, next)));
}

function recoverableConflict(operation: CoreOperation): boolean {
  return operation.conflictResult?.code === 'stale_version'
    || operation.conflictResult?.code === 'dependency_missing'
    || operation.conflictResult?.code === 'unknown';
}

/**
 * Preserve causal/resource order while letting independent work proceed.
 * Terminal receipts do not own a lane; their causal descendants are settled
 * before scheduling. Missing dependencies may already be compacted acknowledgements.
 */
function dueHeads(
  operations: CoreOperation[],
  now: number,
  limit: number,
): CoreOperation[] {
  const blocked = new Set<string>();
  const heads: CoreOperation[] = [];
  const ordered = [...operations].sort((a, b) => {
      if ((a.sequence ?? 0) > 0 || (b.sequence ?? 0) > 0) {
        return (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt - b.createdAt;
      }
      return a.createdAt - b.createdAt;
    });
  for (const head of ordered) {
    if (head.status === 'acked' || head.status === 'conflict') continue;
    const resources = operationResources(head);
    const dependencyPending = operations.some(dependency =>
      dependency.status !== 'acked' && dependsOn(head, dependency));
    const resourceBlocked = resources.some(resource => blocked.has(resource));
    resources.forEach(resource => blocked.add(resource));
    if (dependencyPending || resourceBlocked) continue;
    const open = head.status === 'pending' || head.status === 'failed' || head.status === 'inflight';
    // Inflight is always replayable after a process restart, regardless of its
    // old attempt timestamp.
    if (open && (head.status === 'inflight' || head.nextAttemptAt <= now)) heads.push(head);
  }
  return heads.sort((a, b) => a.createdAt - b.createdAt).slice(0, limit);
}

export class MemoryCoreOperationOutboxDatabase implements CoreOperationOutboxDatabase {
  operations = new Map<string, CoreOperation>();
  sequences = new Map<string, number>();
  /** When true, next insert throws (atomicity tests). */
  failNextInsert = false;
  /** Linked core memory DB for shared rollback in tests. */
  linkedCore: {
    snapshots: Map<string, unknown>;
    gatherings: Map<string, unknown>;
    navResponses: Map<string, unknown>;
    cloneFrom?: () => void;
    restoreTo?: () => void;
  } | null = null;

  private txnSnapshot: Map<string, CoreOperation> | null = null;
  private sequenceSnapshot: Map<string, number> | null = null;

  async initialize(): Promise<void> {}

  async writeAllocateSequence(
    _exec: CoreSqlExecutor,
    actorId: string,
    groupId: string,
  ): Promise<number> {
    const key = `${actorId}:${groupId}`;
    const next = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, next);
    return next;
  }

  async allocateSequence(actorId: string, groupId: string): Promise<number> {
    return this.writeAllocateSequence(
      { runAsync: async () => undefined, getFirstAsync: async () => null },
      actorId,
      groupId,
    );
  }

  async writeInsert(_exec: CoreSqlExecutor, operation: CoreOperation): Promise<void> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error('forced outbox insert failure');
    }
    const existing = this.operations.get(operation.id);
    if (existing) {
      if (!sameOperationIntent(existing, operation)) throw operationIdMismatch();
      return;
    }
    this.operations.set(operation.id, operation);
  }

  async insert(operation: CoreOperation): Promise<void> {
    await this.writeInsert(
      { runAsync: async () => undefined, getFirstAsync: async () => null },
      operation,
    );
  }

  async get(id: string): Promise<CoreOperation | null> {
    return this.operations.get(id) ?? null;
  }

  async getDue(now: number, limit: number): Promise<CoreOperation[]> {
    return dueHeads([...this.operations.values()], now, limit);
  }

  async update(operation: CoreOperation): Promise<void> {
    this.operations.set(operation.id, operation);
  }

  async writeUpdate(_exec: CoreSqlExecutor, operation: CoreOperation): Promise<void> {
    await this.update(operation);
  }

  async delete(id: string): Promise<void> {
    this.operations.delete(id);
  }

  async writeDelete(_exec: CoreSqlExecutor, id: string): Promise<void> {
    await this.delete(id);
  }

  async countPending(): Promise<number> {
    return [...this.operations.values()].filter(
      (op) => op.status === 'pending' || op.status === 'failed' || op.status === 'inflight',
    ).length;
  }

  async countPendingForEntity(
    groupId: string,
    entityType: CoreEntityType,
    entityId: string,
  ): Promise<number> {
    return [...this.operations.values()].filter(
      (op) =>
        op.groupId === groupId
        && op.entityType === entityType
        && op.entityId === entityId
        && (op.status === 'pending' || op.status === 'failed' || op.status === 'inflight'),
    ).length;
  }

  async listByGroup(groupId: string): Promise<CoreOperation[]> {
    return [...this.operations.values()].filter((op) => op.groupId === groupId);
  }

  async listAll(): Promise<CoreOperation[]> {
    return [...this.operations.values()];
  }

  async listOpenByGroup(groupId: string): Promise<CoreOperation[]> {
    return [...this.operations.values()].filter(
      (op) =>
        op.groupId === groupId
        && (op.status === 'pending'
          || op.status === 'failed'
          || op.status === 'inflight'
          || op.status === 'conflict'),
    );
  }

  async withExclusiveTransaction<T>(
    work: (exec: CoreSqlExecutor) => Promise<T>,
  ): Promise<T> {
    this.txnSnapshot = new Map(this.operations);
    this.sequenceSnapshot = new Map(this.sequences);
    const exec: CoreSqlExecutor = {
      runAsync: async () => undefined,
      getFirstAsync: async () => null,
    };
    try {
      const result = await work(exec);
      this.txnSnapshot = null;
      this.sequenceSnapshot = null;
      return result;
    } catch (error) {
      if (this.txnSnapshot) {
        this.operations = this.txnSnapshot;
        this.txnSnapshot = null;
      }
      if (this.sequenceSnapshot) {
        this.sequences = this.sequenceSnapshot;
        this.sequenceSnapshot = null;
      }
      throw error;
    }
  }
}

export class SQLiteCoreOperationOutboxDatabase implements CoreOperationOutboxDatabase {
  constructor(
    private readonly openDatabase: () => Promise<SQLiteDatabase> = getHitherDatabase,
  ) {}

  async initialize(): Promise<void> {
    await this.openDatabase();
  }

  async writeAllocateSequence(
    exec: CoreSqlExecutor,
    actorId: string,
    groupId: string,
  ): Promise<number> {
    await exec.runAsync(
      `INSERT INTO core_operation_sequences(actor_id, group_id, next_sequence)
       VALUES (?, ?, 1)
       ON CONFLICT(actor_id, group_id) DO UPDATE SET
         next_sequence = core_operation_sequences.next_sequence + 1`,
      actorId,
      groupId,
    );
    const row = await exec.getFirstAsync<{ next_sequence: number }>(
      `SELECT next_sequence FROM core_operation_sequences
       WHERE actor_id = ? AND group_id = ?`,
      actorId,
      groupId,
    );
    return row?.next_sequence ?? 1;
  }

  async allocateSequence(actorId: string, groupId: string): Promise<number> {
    let sequence = 1;
    await this.withExclusiveTransaction(async (exec) => {
      sequence = await this.writeAllocateSequence(exec, actorId, groupId);
    });
    return sequence;
  }

  async writeInsert(exec: CoreSqlExecutor, operation: CoreOperation): Promise<void> {
    await insertOutboxRow(exec, operation);
  }

  async insert(operation: CoreOperation): Promise<void> {
    const database = await this.openDatabase();
    await insertOutboxRow(database as unknown as CoreSqlExecutor, operation);
  }

  async get(id: string): Promise<CoreOperation | null> {
    const database = await this.openDatabase();
    const row = await database.getFirstAsync<OutboxRow>(
      'SELECT * FROM core_operation_outbox WHERE id = ?',
      id,
    );
    return row ? rowToOperation(row) : null;
  }

  async getDue(now: number, limit: number): Promise<CoreOperation[]> {
    const database = await this.openDatabase();
    const rows = await database.getAllAsync<OutboxRow>(
      `SELECT * FROM core_operation_outbox
       WHERE status IN ('pending', 'failed', 'inflight', 'conflict')
       ORDER BY created_at ASC`,
    );
    return dueHeads(rows.map(rowToOperation), now, limit);
  }

  async update(operation: CoreOperation): Promise<void> {
    const database = await this.openDatabase();
    await this.writeUpdate(database as unknown as CoreSqlExecutor, operation);
  }

  async writeUpdate(exec: CoreSqlExecutor, operation: CoreOperation): Promise<void> {
    await exec.runAsync(
      `UPDATE core_operation_outbox
       SET status = ?, attempts = ?, next_attempt_at = ?,
           conflict_result = ?, entity_version = ?, updated_at = ?,
           payload = ?, actor_id = ?, sequence = ?, dependency_ids = ?,
           inflight_started_at = ?, last_error = ?
       WHERE id = ?`,
      operation.status,
      operation.attempts,
      operation.nextAttemptAt,
      operation.conflictResult ? JSON.stringify(operation.conflictResult) : null,
      operation.entityVersion,
      operation.updatedAt,
      JSON.stringify(operation.payload),
      operation.actorId ?? null,
      operation.sequence ?? 0,
      JSON.stringify(operation.dependencyIds ?? []),
      operation.inflightStartedAt ?? null,
      operation.lastError ?? null,
      operation.id,
    );
  }

  async delete(id: string): Promise<void> {
    const database = await this.openDatabase();
    await this.writeDelete(database as unknown as CoreSqlExecutor, id);
  }

  async writeDelete(exec: CoreSqlExecutor, id: string): Promise<void> {
    await exec.runAsync('DELETE FROM core_operation_outbox WHERE id = ?', id);
  }

  async countPending(): Promise<number> {
    const database = await this.openDatabase();
    const row = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM core_operation_outbox
       WHERE status IN ('pending', 'failed', 'inflight')`,
    );
    return row?.count ?? 0;
  }

  async countPendingForEntity(
    groupId: string,
    entityType: CoreEntityType,
    entityId: string,
  ): Promise<number> {
    const database = await this.openDatabase();
    const row = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM core_operation_outbox
       WHERE group_id = ? AND entity_type = ? AND entity_id = ?
         AND status IN ('pending', 'failed', 'inflight')`,
      groupId,
      entityType,
      entityId,
    );
    return row?.count ?? 0;
  }

  async listByGroup(groupId: string): Promise<CoreOperation[]> {
    const database = await this.openDatabase();
    const rows = await database.getAllAsync<OutboxRow>(
      `SELECT * FROM core_operation_outbox
       WHERE group_id = ?
       ORDER BY created_at ASC`,
      groupId,
    );
    return rows.map(rowToOperation);
  }

  async listAll(): Promise<CoreOperation[]> {
    const database = await this.openDatabase();
    const rows = await database.getAllAsync<OutboxRow>(
      'SELECT * FROM core_operation_outbox ORDER BY created_at ASC',
    );
    return rows.map(rowToOperation);
  }

  async listOpenByGroup(groupId: string): Promise<CoreOperation[]> {
    const database = await this.openDatabase();
    const rows = await database.getAllAsync<OutboxRow>(
      `SELECT * FROM core_operation_outbox
       WHERE group_id = ?
         AND status IN ('pending', 'failed', 'inflight', 'conflict')
       ORDER BY created_at ASC`,
      groupId,
    );
    return rows.map(rowToOperation);
  }

  async withExclusiveTransaction<T>(
    work: (exec: CoreSqlExecutor) => Promise<T>,
  ): Promise<T> {
    const database = await this.openDatabase();
    if (
      Platform.OS !== 'web'
      && typeof database.withExclusiveTransactionAsync === 'function'
    ) {
      let result!: T;
      await database.withExclusiveTransactionAsync(async (txn) => {
        result = await work(txn as unknown as CoreSqlExecutor);
      });
      return result;
    }
    let result!: T;
    await database.withTransactionAsync(async () => {
      result = await work(database as unknown as CoreSqlExecutor);
    });
    return result;
  }
}

function backoffMs(attempts: number, random = Math.random): number {
  const base = 1_000 * 2 ** Math.max(0, attempts - 1);
  // Full jitter avoids a group of devices retrying on the same wall-clock tick.
  return Math.min(MAX_BACKOFF_MS, Math.max(1, Math.floor(base * (0.5 + random()))));
}

function terminalErrorCode(error: unknown): CoreConflictResult['code'] | null {
  const classification = classifyOperationError(error, { mutation: true });
  switch (classification.kind) {
    case 'leader_role_rejected':
    case 'acl_service_access':
      return 'unauthorized';
    case 'version_conflict':
      return 'stale_version';
    case 'state_conflict':
      return 'invalid_transition';
    case 'validation':
    case 'quota':
      return 'validation';
    case 'storage':
      // Storage errors must be visible and actionable; retrying an unhealthy
      // local database forever would also block every FIFO successor.
      return 'unknown';
    case 'offline_transport':
    case 'timeout_ambiguous_outcome':
    case 'server_busy':
    case 'service_unavailable':
    case 'rate_limited':
    case 'session_missing_or_expired':
      return null;
    default:
      break;
  }
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (code === '42501' || code === '28000' || code === 'unauthorized'
    || code === 'permission_denied' || message.includes('permission denied')) return 'unauthorized';
  if (code === '22023' || code === 'P0002' || code === 'P0004'
    || code === '23503' || code === '23505' || code === '55000'
    || code === 'validation' || message.includes('invalid itinerary')) return 'validation';
  return null;
}

function isAuthenticationError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '').toLowerCase()
    : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return code === 'authentication_required'
    || code === '28000'
    || code === 'pgrst301'
    || code === 'pgrst302'
    || code === 'session_missing_or_expired'
    || message.includes('authentication required')
    || message.includes('session missing')
    || message.includes('jwt');
}

function isAuthenticationConflict(result: ApplyCoreOperationResult): boolean {
  return result.status === 'conflict'
    && (result.conflict.code === 'account_changed'
      || (result.conflict.code === 'unauthorized' && isAuthenticationError(result.conflict.message)));
}

export type CoreActorGuard = () => Promise<string | null>;

export interface EnqueueGatheringInput {
  operationId?: string;
  groupId: string;
  action: 'start' | 'switch' | 'end';
  nextDestinationId?: string | null;
  baseState: ActiveGatheringState;
  /** Destination id for start/switch when base has none selected. */
  activeDestinationId?: string | null;
  actorId?: string;
  navigationRequestId?: string;
  navigationSessionId?: string | null;
  expectedSessionStartedAt?: string | null;
  subgroupId?: string | null;
}

export interface EnqueueNavigationResponseInput {
  operationId?: string;
  groupId: string;
  sessionId: string;
  userId: string;
  response: NavigationAnnouncementResponseKind | null;
  baseVersion: number;
  actorId?: string;
}

export interface EnqueueCoreMutationInput {
  operationId?: string;
  actorId?: string;
  groupId: string;
  entityType: CoreEntityType;
  entityId: string;
  entityVersion?: number;
  operationType: CoreOperationType;
  payload: Record<string, unknown>;
  /** Optional local projection; it runs in the same SQLite transaction as op insert. */
  applyLocal?: (exec: CoreSqlExecutor, operation: CoreOperation) => Promise<void>;
  flushImmediately?: boolean;
}

export interface RecreateConflictOptions {
  latestServerVersion?: number;
  operationId?: string;
  /** Re-apply retained intent inside the same transaction as resolution. */
  applyLocal?: (exec: CoreSqlExecutor, operation: CoreOperation) => Promise<void>;
}

export function createCoreOperationOutbox(
  coreDb: CoreDataDatabase,
  outboxDb: CoreOperationOutboxDatabase,
  submit: CoreOperationSubmitter,
  now: () => number = Date.now,
  idFactory: () => string = () => Crypto.randomUUID(),
  actorGuard?: CoreActorGuard,
) {
  // Production uses one SQLite transaction for the snapshot and outbox. Link
  // the memory doubles too, so rollback tests cover the same boundary,
  // including a freshly allocated sequence when a later write fails.
  if (coreDb instanceof MemoryCoreDataDatabase
    && outboxDb instanceof MemoryCoreOperationOutboxDatabase) {
    coreDb.linkedOutbox = {
      operations: outboxDb.operations as Map<string, unknown>,
      sequences: outboxDb.sequences,
      snapshot: null,
      sequenceSnapshot: null,
    };
  }
  let serial = Promise.resolve();
  let initialization: Promise<void> | null = null;
  let currentActorGuard: CoreActorGuard | undefined = actorGuard;

  const setActorGuard = (guard: CoreActorGuard | undefined): void => {
    currentActorGuard = guard;
  };

  const runSerial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = serial.then(operation, operation);
    serial = next.then(() => undefined, () => undefined);
    return next;
  };

  // Transport may wait for network/auth recovery. Never hold the local
  // command lane across that wait; SQLite's shared writer gate owns mutations.
  let transportSerial = Promise.resolve();
  const runTransport = <T>(work: () => Promise<T>): Promise<T> => {
    const next = transportSerial.then(work, work);
    transportSerial = next.then(() => undefined, () => undefined);
    return next;
  };

  const initialize = (): Promise<void> => {
    if (!initialization) {
      initialization = (async () => {
        await coreDb.initialize();
        await outboxDb.initialize();
      })().catch((error) => {
        initialization = null;
        throw error;
      });
    }
    return initialization;
  };

  const withCoreWriteTransaction = <T>(
    work: (exec: CoreSqlExecutor) => Promise<T>,
  ): Promise<T> => runCoreDataWriteLock(() => coreDb.withExclusiveTransaction(work));

  const withOutboxWriteTransaction = <T>(
    work: (exec: CoreSqlExecutor) => Promise<T>,
  ): Promise<T> => runCoreDataWriteLock(() => outboxDb.withExclusiveTransaction(work));

  /**
   * ONE exclusive transaction: local state write + outbox insert.
   * Uses coreDb's exclusive txn so gathering writes use the same exec
   * (no nested BEGIN).
   */
  const writeLocalAndOutbox = async (
    applyLocal: (exec: CoreSqlExecutor) => Promise<void>,
    operation: CoreOperation,
  ): Promise<CoreOperation> => {
    const existingById = await outboxDb.get(operation.id);
    if (existingById) {
      if (!sameEnqueueIntent(existingById, operation)) throw operationIdMismatch();
      // Crucially, do not run applyLocal again. A reused operation id is an
      // idempotent storage retry, not permission to paint a second payload.
      return existingById;
    }
    await runCoreDataWriteLock(async () => {
      if (operation.actorId && currentActorGuard) {
        const actor = await currentActorGuard();
        if (actor !== operation.actorId) throw new Error('account_changed');
      }
      // Read the predecessor under the same writer gate, but outside the
      // SQLite transaction. The outbox and snapshot may share a connection;
      // opening a second SELECT while the snapshot transaction is exclusive
      // can deadlock on SQLite.
      const predecessors = operation.actorId
        ? (await outboxDb.listByGroup(operation.groupId))
          .filter((row) => row.actorId === operation.actorId
            && isPrerequisite(row, operation)
            && row.status !== 'acked' && row.status !== 'conflict')
        : [];
      operation.dependencyIds = [...new Set([...(operation.dependencyIds ?? []),
        ...predecessors.filter(row => row.id !== operation.id).map(row => row.id)])];
      const predecessor = isItineraryMutation(operation)
        ? (await outboxDb.listByGroup(operation.groupId))
          .filter((row) => row.actorId === operation.actorId
            && row.entityType === 'itinerary'
            && row.entityId === operation.entityId
            && isItineraryMutation(row)
            && isOpenOperation(row)
            && row.id !== operation.id)
          .sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0))[0]
        : undefined;
      return coreDb.withExclusiveTransaction(async (exec) => {
      const existingRow = await exec.getFirstAsync<OutboxRow>(
        'SELECT * FROM core_operation_outbox WHERE id = ?',
        operation.id,
      );
      if (existingRow) {
        const existing = rowToOperation(existingRow);
        if (!sameEnqueueIntent(existing, operation)) throw operationIdMismatch();
        operation.sequence = existing.sequence;
        operation.dependencyIds = existing.dependencyIds;
        return;
      }
      if (operation.actorId && !(operation.sequence && operation.sequence > 0)) {
        operation.sequence = await outboxDb.writeAllocateSequence(
          exec,
          operation.actorId,
          operation.groupId,
        );
      }
      if (isItineraryMutation(operation)) {
        // Every local itinerary command reserves the next predicted version
        // after its own actor/group predecessor. Do not read the current
        // snapshot here: a remote hydrate racing this enqueue must remain a
        // real stale-version conflict, never an implicit client-side rebase.
        if (predecessor) operation.entityVersion = predecessor.entityVersion + 1;
      }
      const before = isItineraryMutation(operation)
        ? await coreDb.readSnapshotInTransaction(exec, operation.groupId) : null;
      await applyLocal(exec);
      if (before) {
        const after = await coreDb.readSnapshotInTransaction(exec, operation.groupId);
        operation.payload = { ...operation.payload,
          _localRollback: { before: before.destinations, after: after?.destinations ?? before.destinations } };
      }
      await outboxDb.writeInsert(exec, operation);
      });
    });
    return operation;
  };

  const writeOutboxOnly = async (operation: CoreOperation): Promise<CoreOperation> => {
    const existingById = await outboxDb.get(operation.id);
    if (existingById) {
      if (!sameEnqueueIntent(existingById, operation)) throw operationIdMismatch();
      return existingById;
    }
    await runCoreDataWriteLock(async () => {
      if (operation.actorId && currentActorGuard) {
        const actor = await currentActorGuard();
        if (actor !== operation.actorId) throw new Error('account_changed');
      }
      const predecessors = operation.actorId
        ? (await outboxDb.listByGroup(operation.groupId))
          .filter((row) => row.actorId === operation.actorId
            && isPrerequisite(row, operation)
            && row.status !== 'acked' && row.status !== 'conflict')
        : [];
      operation.dependencyIds = [...new Set([...(operation.dependencyIds ?? []),
        ...predecessors.filter(row => row.id !== operation.id).map(row => row.id)])];
      return outboxDb.withExclusiveTransaction(async (exec) => {
      if (operation.actorId && !(operation.sequence && operation.sequence > 0)) {
        operation.sequence = await outboxDb.writeAllocateSequence(
          exec,
          operation.actorId,
          operation.groupId,
        );
      }
      await outboxDb.writeInsert(exec, operation);
      });
    });
    return operation;
  };

  const resolveActor = async (
    explicit: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<string | undefined> => {
    const payloadActor = typeof payload.actorId === 'string' && payload.actorId
      ? payload.actorId
      : undefined;
    if (currentActorGuard) {
      const guarded = await currentActorGuard();
      if (!guarded) {
        throw Object.assign(new Error('authentication_required_for_durable_operation'), {
          code: 'authentication_required',
        });
      }
      if ((explicit && explicit !== guarded) || (payloadActor && payloadActor !== guarded)) {
        throw Object.assign(new Error('operation actor does not match authenticated actor'), {
          code: 'account_changed',
        });
      }
      return guarded;
    }
    // Old actorless fixtures/callers may still omit a session guard. Once a
    // guard is installed, the authenticated actor above is always canonical.
    return explicit ?? payloadActor;
  };

  const isDurableOperation = (operation: CoreOperation): boolean =>
    Boolean(operation.actorId && (operation.sequence ?? 0) > 0);

  const isOpenOperation = (operation: CoreOperation): boolean =>
    operation.status === 'pending'
    || operation.status === 'failed'
    || operation.status === 'inflight';

  const dependencyChain = (
    rootId: string,
    rows: CoreOperation[],
  ): Set<string> => {
    const chain = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (!chain.has(row.id)
          && rows.some(prior => chain.has(prior.id) && dependsOn(row, prior))) {
          chain.add(row.id);
          changed = true;
        }
      }
    }
    return chain;
  };

  const assertResolutionActor = async (
    root: CoreOperation,
    rows: CoreOperation[],
    chain: Set<string>,
  ): Promise<string> => {
    if (!root.actorId || !currentActorGuard) {
      throw Object.assign(new Error('authentication_required_for_resolution'), {
        code: 'authentication_required',
      });
    }
    const actor = await currentActorGuard();
    if (!actor) {
      throw Object.assign(new Error('authentication_required_for_resolution'), {
        code: 'authentication_required',
      });
    }
    if (actor !== root.actorId) throw new Error('account_changed');
    for (const row of rows) {
      if (chain.has(row.id) && row.actorId !== actor) {
        throw new Error('account_changed');
      }
    }
    return actor;
  };

  const applyAcceptedEffects = async (
    exec: CoreSqlExecutor,
    operation: CoreOperation,
    result: Extract<ApplyCoreOperationResult, { status: 'accepted' | 'duplicate' }>,
    current: number,
    rowsBefore: CoreOperation[],
  ): Promise<void> => {
    const effects = result.effects
      ?? (result.entity && typeof result.entity === 'object'
        ? (result.entity as { effects?: Record<string, unknown> }).effects
        : undefined);
    const aliases = effects?.destinationIdAliases;
    const aliasMap = new Map(
      aliases && typeof aliases === 'object' && !Array.isArray(aliases)
        ? Object.entries(aliases).filter(
          ([local, canonical]) => typeof local === 'string' && typeof canonical === 'string',
        ) as Array<[string, string]>
        : [],
    );

    const hasPendingDependents = rowsBefore.some((row) =>
      row.id !== operation.id
      && row.actorId === operation.actorId
      && row.groupId === operation.groupId
      && row.entityType === operation.entityType
      && row.entityId === operation.entityId
      && isOpenOperation(row),
    );
    const entity = result.entity && typeof result.entity === 'object'
      ? result.entity as {
          destinations?: unknown;
          entityVersion?: number;
        }
      : null;
    const serverDestinations = normalizeItineraryDestinations(entity?.destinations);
    const snapshot = await coreDb.readSnapshotInTransaction(exec, operation.groupId);
    const resolveAlias = (id: string): string => {
      const seen = new Set<string>();
      let currentId = id;
      while (aliasMap.has(currentId) && !seen.has(currentId)) {
        seen.add(currentId);
        currentId = aliasMap.get(currentId)!;
      }
      return currentId;
    };
    if (snapshot && operation.entityType === 'itinerary'
      && (serverDestinations !== null || aliasMap.size > 0)) {
      let destinations = serverDestinations !== null
        ? projectOperationDestinations(serverDestinations, rowsBefore.filter(row => row.id !== operation.id
          && row.actorId === operation.actorId))
        : snapshot.destinations;
      if (aliasMap.size > 0) {
        const seen = new Set<string>();
        destinations = destinations
          .map((destination) => {
            const canonicalId = resolveAlias(destination.id);
            if (seen.has(canonicalId)) return null;
            seen.add(canonicalId);
            return canonicalId === destination.id
              ? destination
              : { ...destination, id: canonicalId };
          })
          .filter((destination): destination is typeof snapshot.destinations[number] => destination !== null);
      }
      const pointStatusRank: Record<ActiveGatheringState['pointStatuses'][string], number> = {
        pending: 0,
        en_route: 1,
        completed: 2,
      };
      const pointStatuses = Object.entries(snapshot.activeGathering.pointStatuses)
        .reduce<Record<string, ActiveGatheringState['pointStatuses'][string]>>((next, [id, status]) => {
          const canonicalId = resolveAlias(id);
          const existingStatus = next[canonicalId];
          if (!existingStatus || pointStatusRank[status] > pointStatusRank[existingStatus]) {
            next[canonicalId] = status;
          }
          return next;
        }, {});
      const activeGathering = {
        ...snapshot.activeGathering,
        activeDestinationId: snapshot.activeGathering.activeDestinationId
          ? resolveAlias(snapshot.activeGathering.activeDestinationId)
          : null,
        pointStatuses,
      };
      const authoritativeVersion = typeof entity?.entityVersion === 'number'
        ? entity.entityVersion
        : result.entityVersion;
      const nextItineraryVersion = typeof authoritativeVersion === 'number'
        ? (hasPendingDependents
            ? Math.max(snapshot.itineraryVersion ?? 0, authoritativeVersion)
            : authoritativeVersion)
        : snapshot.itineraryVersion;
      const nextSnapshot = {
        ...snapshot,
        destinations,
        activeGathering,
        ...(typeof nextItineraryVersion === 'number'
          ? { itineraryVersion: nextItineraryVersion }
          : {}),
        syncedAt: current,
        updatedAt: current,
        source: hasPendingDependents ? 'local_cache' as const : 'remote' as const,
      };
      await coreDb.writeSnapshot(exec, nextSnapshot);
      await coreDb.writeActiveGathering(exec, nextSnapshot.activeGathering, current, {
        patchSnapshot: 'none',
      });
      for (const [local, canonical] of aliasMap) {
        await coreDb.writeDestinationAlias(exec, operation.groupId, local, canonical, current);
      }
    }

    // A merge can be acknowledged while dependent local edits are still in
    // the device queue. Rewrite their payload and entity id in this same
    // transaction; operation IDs, sequences, and dependency IDs stay intact.
    const rewrite = (value: unknown): unknown => {
      if (typeof value === 'string') return resolveAlias(value);
      if (Array.isArray(value)) return value.map(rewrite);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, rewrite(child)]),
        );
      }
      return value;
    };
    for (const pending of rowsBefore) {
      if (pending.id === operation.id || pending.status === 'acked'
        || pending.actorId !== operation.actorId) continue;
      const entityId = resolveAlias(pending.entityId);
      await outboxDb.writeUpdate(exec, {
        ...pending,
        entityId,
        payload: rewrite(pending.payload) as Record<string, unknown>,
      });
    }
  };

  const handleSubmitResult = async (
    operation: CoreOperation,
    result: ApplyCoreOperationResult,
    current: number,
  ): Promise<'sent' | 'conflict' | 'duplicate'> => {
    if (result.status === 'accepted' || result.status === 'duplicate') {
      await runCoreDataWriteLock(async () => {
        const rowsBefore = await outboxDb.listByGroup(operation.groupId);
        await coreDb.withExclusiveTransaction(async (exec) => {
        // Compact only after the server result, projection, aliases, and
        // dependent rewrites can commit together. Arrival rows are retained as
        // an acknowledged local history row until the next remote read.
        if (operation.operationType === 'record_arrival' || operation.operationType === 'leader_correct_arrival') {
          const resultPayload = result.entity && typeof result.entity === 'object'
            ? result.entity
            : {};
          await outboxDb.writeUpdate(exec, {
            ...operation,
            payload: { ...operation.payload, ...resultPayload },
            status: 'acked',
            inflightStartedAt: undefined,
            updatedAt: current,
          });
        } else {
          await outboxDb.writeDelete(exec, operation.id);
        }
        await applyAcceptedEffects(exec, operation, result, current, rowsBefore);

        if (result.entity
          && typeof result.entity === 'object'
          && operation.entityType === 'active_gathering'
          && isUsableActiveGatheringState(result.entity)) {
          const newerPending = rowsBefore.some((row) =>
            row.id !== operation.id
            && row.actorId === operation.actorId
            && row.entityType === operation.entityType
            && row.entityId === operation.entityId
            && isOpenOperation(row),
          );
          if (!newerPending) {
            await coreDb.writeActiveGathering(exec, result.entity, current, {
              patchSnapshot: 'remote',
            });
          }
        }
        if (result.entity
          && typeof result.entity === 'object'
          && operation.entityType === 'navigation_response') {
          const entity = result.entity as NavigationAnnouncementResponse;
          if (entity.sessionId && entity.userId) {
            await coreDb.writeNavigationResponse(exec, entity);
          }
        }
      });
      });
      notifyCoreOutboxChanged();
      return result.status === 'duplicate' ? 'duplicate' : 'sent';
    }

    const conflict = result.conflict;
    // v3 re-applies intent on the server without changing its UUID or payload.
    // Preserve that identity even when an older conflict receipt is replayed.
    if (conflict.code === 'stale_version' || conflict.code === 'dependency_missing'
      || conflict.code === 'unknown') {
      await runCoreDataWriteLock(() => outboxDb.update({
        ...operation, status: 'failed', conflictResult: conflict,
        attempts: operation.attempts + 1,
        nextAttemptAt: current + backoffMs(operation.attempts + 1),
        inflightStartedAt: undefined, updatedAt: current,
      }));
      notifyCoreOutboxChanged();
      return 'conflict';
    }
    // Invalid intent is retained for diagnostics but is settled automatically;
    // only its actual dependants terminate. No user decision is required.
    const conflictOperation: CoreOperation = {
      ...operation,
      status: isDurableOperation(operation)
        ? 'conflict'
        : operation.operationType === 'record_arrival'
          ? 'conflict'
          : 'failed',
      conflictResult: conflict,
      attempts: operation.attempts + 1,
      nextAttemptAt: isDurableOperation(operation)
        ? Number.MAX_SAFE_INTEGER
        : current + backoffMs(operation.attempts + 1),
      inflightStartedAt: undefined,
      updatedAt: current,
    };
    await runCoreDataWriteLock(async () => {
      const conflictRows = await outboxDb.listByGroup(operation.groupId);
      const invalidated = dependencyChain(operation.id, conflictRows);
      await coreDb.withExclusiveTransaction(async (exec) => {
      await outboxDb.writeUpdate(exec, conflictOperation);
      for (const dependent of conflictRows) {
        if (dependent.id !== operation.id && dependent.actorId === operation.actorId
          && dependent.status !== 'acked' && invalidated.has(dependent.id)) {
          await outboxDb.writeUpdate(exec, { ...dependent, status: 'conflict',
            conflictResult: { ...conflict, code: 'invalid_transition', operationId: dependent.id,
              message: 'prerequisite operation expired' }, nextAttemptAt: Number.MAX_SAFE_INTEGER, updatedAt: current });
        }
      }
      if (isItineraryMutation(operation) && !conflict.serverState) {
        const snapshot = await coreDb.readSnapshotInTransaction(exec, operation.groupId);
        if (snapshot) {
          let destinations = snapshot.destinations;
          // Reverse dependants first, then their failed prerequisite.
          const rejected = conflictRows.filter(row => invalidated.has(row.id) && row.actorId === operation.actorId)
            .sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0));
          for (const row of rejected) {
            const undo = row.payload._localRollback as ItineraryRollback | undefined;
            if (undo?.before && undo?.after) destinations = rollbackItinerary(destinations, undo);
          }
          await coreDb.writeSnapshot(exec, { ...snapshot, destinations,
            updatedAt: current, source: 'local_optimistic' });
        }
      }
      if (isDurableOperation(operation) && conflict.serverState) {
        if (operation.entityType === 'active_gathering'
          && isUsableActiveGatheringState(conflict.serverState)) {
          await coreDb.writeActiveGathering(exec, conflict.serverState, current, {
            patchSnapshot: 'remote',
          });
        } else if (operation.entityType === 'itinerary'
          && typeof conflict.serverState === 'object'
          && Array.isArray((conflict.serverState as { destinations?: unknown }).destinations)) {
          const snapshot = await coreDb.readSnapshotInTransaction(exec, operation.groupId);
          if (snapshot) {
            const serverState = conflict.serverState as {
              destinations: unknown;
            };
            const serverDestinations = normalizeItineraryDestinations(serverState.destinations);
            if (!serverDestinations) return;
            await coreDb.writeSnapshot(exec, {
              ...snapshot,
              destinations: projectOperationDestinations(serverDestinations, conflictRows.filter(row =>
                !invalidated.has(row.id) && row.actorId === operation.actorId)),
              itineraryVersion: conflict.serverEntityVersion ?? snapshot.itineraryVersion ?? 0,
              syncedAt: current,
              updatedAt: current,
              source: 'remote',
            });
            await coreDb.writeActiveGathering(exec, snapshot.activeGathering, current, {
              patchSnapshot: 'none',
            });
          }
        }
      }
      if (conflict.serverState && operation.entityType === 'navigation_response') {
        const entity = conflict.serverState as NavigationAnnouncementResponse;
        if (entity.sessionId && entity.userId) {
          await coreDb.writeNavigationResponse(exec, entity);
        }
      }
    });
    });
    notifyCoreOutboxChanged();
    return 'conflict';

  };

  return {
    initialize,
    runSerial,
    setActorGuard,

    enqueueArrival(groupId: string, destinationId: string, payload: Record<string, unknown>): Promise<CoreOperation> {
      return runSerial(async () => {
        await initialize();
        const actorKey = await resolveActor(
          typeof payload.actorId === 'string' ? payload.actorId : undefined,
          payload,
        );
        const normalizeSession = (value: unknown): string | null =>
          typeof value === 'string' && value.length > 0 ? value : null;
        const isSameArrivalIntent = (row: CoreOperation): boolean =>
          row.operationType === 'record_arrival'
          && row.entityId === destinationId
          && row.actorId === actorKey
          && row.payload.userId === payload.userId
          && (row.payload.arrived !== false) === (payload.arrived !== false)
          && normalizeSession(row.payload.navigationSessionId)
            === normalizeSession(payload.navigationSessionId);
        const candidates = (await outboxDb.listByGroup(groupId))
          .filter((row) => row.operationType === 'record_arrival'
            && row.entityId === destinationId
            && row.actorId === actorKey
            && row.payload.userId === payload.userId
            && row.status !== 'acked')
          .sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0)
            || b.createdAt - a.createdAt);
        // Only the latest open intent may be coalesced. An arrival, undo,
        // arrival sequence is meaningful history and must retain all three
        // operations; matching an arbitrary older row would lose the undo.
        const latest = candidates[0];
        if (latest && latest.status !== 'conflict' && isSameArrivalIntent(latest)) return latest;
        let id = idFactory();
        let existing = await outboxDb.get(id);
        // A terminal conflict is a retained draft, not a reusable idempotency
        // key. Generate a fresh operation id for the new intent and leave the
        // old conflict row available for diagnostics.
        for (let attempts = 0; existing && attempts < 3; attempts += 1) {
          id = idFactory();
          existing = await outboxDb.get(id);
        }
        if (existing) {
          throw Object.assign(new Error('Could not allocate a unique operation ID'), { code: 'operation_id_collision' });
        }
        const current = now();
        const actorId = actorKey;
        const operation: CoreOperation = {
          id,
          ...(actorId ? { actorId } : {}),
          groupId,
          entityId: destinationId,
          entityType: 'itinerary',
          entityVersion: 0, operationType: 'record_arrival', payload,
          status: 'pending', attempts: 0, nextAttemptAt: current,
          conflictResult: null, createdAt: current, updatedAt: current,
        };
        await writeOutboxOnly(operation);
        notifyCoreOutboxChanged();
        return operation;
      });
    },

    removeArrival(id: string): Promise<void> {
      return runSerial(async () => {
        await initialize();
        const operation = await outboxDb.get(id);
        if (operation?.operationType === 'record_arrival' || operation?.operationType === 'leader_correct_arrival') {
          await runCoreDataWriteLock(() => outboxDb.delete(id));
        }
        notifyCoreOutboxChanged();
      });
    },

    enqueueGatheringTransition(
      input: EnqueueGatheringInput,
    ): Promise<{
      operation: CoreOperation;
      local: ActiveGatheringState;
      /** Pre-transition base used for business-error rollback. */
      base: ActiveGatheringState;
    }> {
      return runSerial(async () => {
        await initialize();
        const current = now();
        const base =
          input.activeDestinationId
          && input.action === 'start'
          && !input.baseState.activeDestinationId
            ? {
                ...input.baseState,
                activeDestinationId: input.activeDestinationId,
              }
            : input.baseState;
        const local =
          input.action === 'start'
            ? startGathering(base, current)
            : input.action === 'switch'
              ? switchGathering(
                  base,
                  input.activeDestinationId ?? '',
                  current,
                )
              : endGathering(base, current, input.nextDestinationId);

        // Post-end next cursor must ship in payload (not only pre-end input).
        const nextDestinationIdForPayload =
          input.action === 'end'
            ? (input.nextDestinationId !== undefined
                ? input.nextDestinationId
                : local.activeDestinationId)
            : (input.nextDestinationId ?? null);

        const payload: Record<string, unknown> = {
          action: input.action,
          subgroupId: input.subgroupId ?? null,
          navigationSessionId: input.navigationSessionId ?? null,
          ...(input.expectedSessionStartedAt ? { expectedSessionStartedAt: input.expectedSessionStartedAt } : {}),
          nextDestinationId: nextDestinationIdForPayload,
          activeDestinationId:
            input.action === 'end'
              ? base.activeDestinationId
              : local.activeDestinationId,
          result: local,
          ...(input.navigationRequestId
            ? { navigationRequestId: input.navigationRequestId }
            : {}),
        };
        const actorId = await resolveActor(input.actorId, payload);

        const operation: CoreOperation = {
          id: input.operationId ?? idFactory(),
          ...(actorId ? { actorId } : {}),
          groupId: input.groupId,
          entityType: 'active_gathering',
          entityId: input.groupId,
          entityVersion: base.entityVersion,
          operationType:
            input.action === 'start'
              ? 'start_gathering'
              : input.action === 'switch'
                ? 'switch_gathering'
                : 'end_gathering',
          payload,
          createdAt: current,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: current,
          conflictResult: null,
          updatedAt: current,
        };

        await writeLocalAndOutbox(async (exec) => {
          // Outbox optimistic mutation deliberately marks snapshot local_optimistic.
          await coreDb.writeActiveGathering(exec, local, current, {
            patchSnapshot: 'optimistic',
            ownerActorId: operation.actorId,
          });
        }, operation);

        notifyCoreOutboxChanged();
        return { operation, local, base };
      });
    },

    /**
     * Mark a still-open gathering op as conflict and restore pre-transition
     * local state. Used when legacy navigation rejects a non-transient error
     * after optimistic enqueue (must not keep retrying a doomed Start).
     */
    markGatheringConflictAndRestore(input: {
      operationId: string;
      restore: ActiveGatheringState;
      message: string;
      code?: CoreConflictResult['code'];
    }): Promise<void> {
      return runSerial(async () => {
        await initialize();
        const current = now();
        const existing = await outboxDb.get(input.operationId);
        if (
          existing
          && (existing.status === 'pending'
            || existing.status === 'failed'
            || existing.status === 'inflight')
        ) {
          const conflict: CoreConflictResult = {
            code: input.code ?? 'invalid_transition',
            message: input.message,
            serverEntityVersion: input.restore.entityVersion,
            serverState: input.restore,
            operationId: existing.id,
            entityType: existing.entityType,
            entityId: existing.entityId,
            occurredAt: current,
          };
          await withCoreWriteTransaction(async (exec) => {
            await outboxDb.writeUpdate(exec, {
              ...existing,
              status: 'conflict',
              conflictResult: conflict,
              updatedAt: current,
            });
            await coreDb.writeActiveGathering(exec, input.restore, current, {
              patchSnapshot: 'remote',
            });
          });
        } else {
          await withCoreWriteTransaction((exec) => coreDb.writeActiveGathering(
            exec,
            input.restore,
            current,
            { patchSnapshot: 'remote' },
          ));
        }
        notifyCoreOutboxChanged();
      });
    },

    enqueueNavigationResponse(
      input: EnqueueNavigationResponseInput,
    ): Promise<{
      operation: CoreOperation;
      local: NavigationAnnouncementResponse;
    }> {
      return runSerial(async () => {
        await initialize();
        const current = now();
        const local: NavigationAnnouncementResponse = {
          sessionId: input.sessionId,
          userId: input.userId,
          groupId: input.groupId,
          response: input.response,
          entityVersion: input.baseVersion + 1,
          updatedAt: current,
        };
        const payload: Record<string, unknown> = {
          sessionId: input.sessionId,
          userId: input.userId,
          response: input.response,
          result: local,
        };
        const actorId = await resolveActor(input.actorId, payload);
        const operation: CoreOperation = {
          id: input.operationId ?? idFactory(),
          ...(actorId ? { actorId } : {}),
          groupId: input.groupId,
          entityType: 'navigation_response',
          entityId: `${input.sessionId}:${input.userId}`,
          entityVersion: input.baseVersion,
          operationType: 'set_navigation_response',
          payload,
          createdAt: current,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: current,
          conflictResult: null,
          updatedAt: current,
        };

        await writeLocalAndOutbox(async (exec) => {
          await coreDb.writeNavigationResponse(exec, local);
        }, operation);

        notifyCoreOutboxChanged();
        return { operation, local };
      });
    },

    /** Generic durable mutation used by itinerary/request services. */
    enqueueMutation(input: EnqueueCoreMutationInput): Promise<CoreOperation> {
      return runSerial(async () => {
        await initialize();
        const current = now();
        const actorId = await resolveActor(input.actorId, input.payload);
        const operation: CoreOperation = {
          id: input.operationId ?? idFactory(),
          ...(actorId ? { actorId } : {}),
          groupId: input.groupId,
          entityType: input.entityType,
          entityId: input.entityId,
          entityVersion: input.entityVersion ?? 0,
          operationType: input.operationType,
          payload: input.payload,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: current,
          conflictResult: null,
          createdAt: current,
          updatedAt: current,
        };
        await writeLocalAndOutbox(
          input.applyLocal
            ? (exec) => input.applyLocal!(exec, operation)
            : async () => undefined,
          operation,
        );
        notifyCoreOutboxChanged();
        return operation;
      });
    },

    listConflicts(groupId?: string): Promise<CoreOperation[]> {
      return runSerial(async () => {
        await initialize();
        const rows = groupId
          ? await outboxDb.listByGroup(groupId)
          : await outboxDb.listAll();
        const conflicts = rows.filter((row) => row.status === 'conflict');
        if (!currentActorGuard) return conflicts;
        const actor = await currentActorGuard();
        return conflicts.filter((row) => !row.actorId || (actor != null && row.actorId === actor));
      });
    },

    async discardConflictChain(operationId: string): Promise<string[]> {
      return runSerial(async () => {
        await initialize();
        const root = await outboxDb.get(operationId);
        if (!root) return [];
        if (root.status !== 'conflict') throw new Error('conflict_operation_not_found');
        const rows = await outboxDb.listByGroup(root.groupId);
        const discard = dependencyChain(operationId, rows);
        await assertResolutionActor(root, rows, discard);
        // Use the same executor for every delete. A crash cannot leave the
        // conflict head removed while one of its dependency descendants is
        // still blocking the queue.
        await withCoreWriteTransaction(async (exec) => {
          for (const id of discard) await outboxDb.writeDelete(exec, id);
        });
        notifyCoreOutboxChanged();
        return [...discard];
      });
    },

    async recreateConflict(
      operationId: string,
      options: RecreateConflictOptions = {},
    ): Promise<CoreOperation> {
      return runSerial(async () => {
        await initialize();
        const original = await outboxDb.get(operationId);
        if (!original || original.status !== 'conflict') {
          throw new Error('conflict_operation_not_found');
        }
        const rows = await outboxDb.listByGroup(original.groupId);
        const discard = dependencyChain(operationId, rows);
        const actorId = await assertResolutionActor(original, rows, discard);
        const current = now();
        const recreatedId = options.operationId ?? idFactory();
        if (rows.some((row) => row.id === recreatedId && !discard.has(row.id))) {
          throw new Error('operation_id_already_exists');
        }
        const recreated: CoreOperation = {
          ...original,
          id: recreatedId,
          actorId,
          entityVersion:
            options.latestServerVersion
            ?? original.conflictResult?.serverEntityVersion
            ?? original.entityVersion,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: current,
          conflictResult: null,
          dependencyIds: [],
          createdAt: current,
          updatedAt: current,
          payload: { ...original.payload, recreatedFrom: original.id },
        };
        const prior = rows
          .filter((row) => !discard.has(row.id)
            && row.actorId === actorId
            && row.status !== 'acked'
            && row.status !== 'conflict')
          .sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0))[0];
        if (prior) recreated.dependencyIds = [prior.id];

        // The conflict chain is explicitly discarded before a fresh local
        // sequence is allocated. The new operation can never collide with the
        // old server ledger row or inherit its blocked dependency id.
        await withCoreWriteTransaction(async (exec) => {
          for (const id of discard) await outboxDb.writeDelete(exec, id);
          recreated.sequence = await outboxDb.writeAllocateSequence(exec, actorId, original.groupId);
          await outboxDb.writeInsert(exec, recreated);
          if (options.applyLocal) await options.applyLocal(exec, recreated);
        });
        notifyCoreOutboxChanged();
        return recreated;
      });
    },

    flush(maxEntries = MAX_BATCH): Promise<CoreOutboxFlushResult> {
      return runTransport(async () => {
        await initialize();
        const current = now();
        // Upgrade retained v2 version conflicts in place; do not lose drafts or
        // mutate the ledger identity. Settle irrecoverable dependency chains.
        const owner = currentActorGuard ? await currentActorGuard() : undefined;
        const rows = await outboxDb.listAll();
        const ownRows = rows.filter(row => !currentActorGuard || (owner && row.actorId === owner));
        const terminalIds = new Set(ownRows.filter(row => row.status === 'conflict'
          && !recoverableConflict(row)).map(row => row.id));
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (const row of ownRows) {
            if (row.status !== 'acked' && !terminalIds.has(row.id)
              && ownRows.some(prior => terminalIds.has(prior.id) && dependsOn(row, prior))) {
              terminalIds.add(row.id); expanded = true;
            }
          }
        }
        await withCoreWriteTransaction(async exec => {
          for (const row of ownRows) {
            if (terminalIds.has(row.id) && row.status !== 'conflict') {
              await outboxDb.writeUpdate(exec, {
                ...row, status: 'conflict', nextAttemptAt: Number.MAX_SAFE_INTEGER,
                conflictResult: { code: 'invalid_transition', message: 'prerequisite operation expired',
                  operationId: row.id, entityType: row.entityType, entityId: row.entityId, occurredAt: current },
                updatedAt: current,
              });
            } else if (row.status === 'conflict' && recoverableConflict(row) && !terminalIds.has(row.id)) {
              await outboxDb.writeUpdate(exec, { ...row, status: 'pending', nextAttemptAt: current, updatedAt: current });
            }
          }
        });
        // Fetch all queue heads when actor filtering is enabled. Applying the
        // batch limit before removing another account's heads could consume
        // the entire batch and starve the signed-in account.
        const dueCandidates = await outboxDb.getDue(
          current,
          currentActorGuard ? Number.MAX_SAFE_INTEGER : Math.max(0, maxEntries),
        );
        let due = dueCandidates;
        let sent = 0;
        let conflicts = 0;
        let duplicates = 0;
        let retryScheduled = 0;
        let paused = false;
        let visibleActor: string | null | undefined;

        // A switch to another account must not poison the previous account's
        // draft, but it also must not starve the newly signed-in account's
        // own queue. Filter foreign actor heads before transport; retain a
        // paused signal so the owner can be resumed later.
        if (currentActorGuard) {
          const actor = await currentActorGuard();
          if (!actor) {
            return {
              sent: 0,
              conflicts: 0,
              duplicates: 0,
              remaining: await outboxDb.countPending(),
              retryScheduled: 0,
              paused: true,
            };
          }
          visibleActor = actor;
          paused = dueCandidates.some((operation) =>
            Boolean(operation.actorId && operation.actorId !== actor),
          );
          due = dueCandidates
            .filter((operation) => !operation.actorId || operation.actorId === actor)
            .slice(0, Math.max(0, maxEntries));
        }

        for (const operation of due) {
          if (operation.actorId && currentActorGuard) {
            const actor = await currentActorGuard();
            if (!actor) {
              paused = true;
              break;
            }
            if (actor !== operation.actorId) {
              // A different account must not turn the previous account's
              // draft into a permanent conflict. Pause until its owner
              // returns; leave the durable row untouched.
              paused = true;
              break;
            }
          }
          const inflight: CoreOperation = {
            ...operation,
            status: 'inflight',
            inflightStartedAt: now(),
            updatedAt: current,
          };
          await runCoreDataWriteLock(() => outboxDb.update(inflight));

          try {
            const result = await submit(operation);
            if (operation.actorId && currentActorGuard) {
              const actorAfterSubmit = await currentActorGuard();
              if (actorAfterSubmit !== operation.actorId) {
                // The server may already have accepted the UUID. Keep the
                // original row durable so the owning account can replay it
                // idempotently; never project or delete it into this account.
                await runCoreDataWriteLock(() => outboxDb.update({
                  ...operation,
                  status: 'pending',
                  inflightStartedAt: undefined,
                  nextAttemptAt: now(),
                  lastError: 'account_changed',
                  updatedAt: now(),
                }));
                paused = true;
                break;
              }
            }
            if (isAuthenticationConflict(result)) {
              await runCoreDataWriteLock(() => outboxDb.update({
                ...operation,
                status: operation.status === 'failed' ? 'failed' : 'pending',
                inflightStartedAt: undefined,
                nextAttemptAt: now(),
                updatedAt: now(),
              }));
              paused = true;
              break;
            }
            const kind = await handleSubmitResult(operation, result, now());
            if (kind === 'sent') sent += 1;
            else if (kind === 'duplicate') duplicates += 1;
            else conflicts += 1;
          } catch (error) {
            const classification = classifyOperationError(error, { mutation: true });
            if (isAuthenticationError(error) || classification.requiresSession) {
              await runCoreDataWriteLock(() => outboxDb.update({
                ...operation,
                status: operation.status === 'failed' ? 'failed' : 'pending',
                inflightStartedAt: undefined,
                nextAttemptAt: now(),
                lastError: error instanceof Error ? error.message : String(error),
                updatedAt: now(),
              }));
              paused = true;
              break;
            }
            const attempts = operation.attempts + 1;
            const terminal = terminalErrorCode(error);
            if (terminal) {
              const conflict: CoreConflictResult = {
                code: terminal,
                message: error instanceof Error ? error.message : String(error),
                operationId: operation.id,
                entityType: operation.entityType,
                entityId: operation.entityId,
                occurredAt: now(),
              };
              await handleSubmitResult(operation, {
                status: 'conflict', operationId: operation.id, conflict,
              }, now());
              conflicts += 1;
              continue;
            }
            await runCoreDataWriteLock(() => outboxDb.update({
              ...operation,
              status: 'failed',
              attempts,
              nextAttemptAt: now() + backoffMs(attempts),
              lastError: error instanceof Error ? error.message : String(error),
              inflightStartedAt: undefined,
              updatedAt: now(),
            }));
            retryScheduled += 1;
            notifyCoreOutboxChanged();
          }
        }

        if (due.length > 0) notifyCoreOutboxChanged();

        return {
          sent,
          conflicts,
          duplicates,
          remaining: visibleActor === undefined
            ? await outboxDb.countPending()
            : (await outboxDb.listAll()).filter((row) =>
              (row.status === 'pending' || row.status === 'failed' || row.status === 'inflight')
              && (!row.actorId || row.actorId === visibleActor),
            ).length,
          retryScheduled,
          paused,
        };
      });
    },

    retryFailedOperation(id: string): Promise<void> {
      return runSerial(async () => {
        await initialize();
        await runCoreDataWriteLock(async () => {
          const operation = await outboxDb.get(id);
          if (!operation || operation.status !== 'failed') return;
          if (currentActorGuard && operation.actorId !== await currentActorGuard()) return;
          await outboxDb.update({ ...operation, nextAttemptAt: now(), updatedAt: now() });
        });
        notifyCoreOutboxChanged();
      });
    },

    getOperation(id: string): Promise<CoreOperation | null> {
      return runSerial(async () => {
        await initialize();
        return outboxDb.get(id);
      });
    },

    listByGroup(groupId: string): Promise<CoreOperation[]> {
      return runSerial(async () => {
        await initialize();
        return outboxDb.listByGroup(groupId);
      });
    },

    listOpenByGroup(groupId: string): Promise<CoreOperation[]> {
      return runSerial(async () => {
        await initialize();
        const rows = await outboxDb.listOpenByGroup(groupId);
        if (!currentActorGuard) return rows;
        const actor = await currentActorGuard();
        // A signed-out/account-switched session must not project another
        // actor's local drafts into the current account's UI.
        return rows.filter((row) => !row.actorId || (actor != null && row.actorId === actor));
      });
    },

    pendingCount(): Promise<number> {
      return runSerial(async () => {
        await initialize();
        return outboxDb.countPending();
      });
    },

    // These guards are intentionally not placed behind the outbox serial lane:
    // the snapshot store calls them while holding the shared writer gate, and
    // an enqueue may be waiting on that same gate.
    async hasPendingGathering(groupId: string): Promise<boolean> {
      await initialize();
      const actor = currentActorGuard ? await currentActorGuard() : undefined;
      const rows = await outboxDb.listOpenByGroup(groupId);
      return rows.some(row => (!currentActorGuard || (actor != null && row.actorId === actor))
        && row.entityType === 'active_gathering' && row.entityId === groupId
        && row.status !== 'conflict');
    },

    async hasPendingItinerary(groupId: string): Promise<boolean> {
      await initialize();
      const rows = await outboxDb.listOpenByGroup(groupId);
      const actor = currentActorGuard ? await currentActorGuard() : undefined;
      return rows.some((row) => (!currentActorGuard || (actor != null && row.actorId === actor))
        && row.entityType === 'itinerary'
        && row.entityId === groupId
        && row.status !== 'conflict'
        && row.operationType !== 'record_arrival');
    },

    peekPending(): Promise<CoreOperation[]> {
      return runSerial(async () => {
        await initialize();
        return outboxDb.getDue(now(), MAX_BATCH);
      });
    },
  };
}

export type CoreOperationOutbox = ReturnType<typeof createCoreOperationOutbox>;

/**
 * In-process authoritative applicator. Matches server: missing entity = version 0.
 */
export function createLocalCoreOperationApplicator(
  entities: {
    gathering: Map<string, ActiveGatheringState>;
    navResponses: Map<string, NavigationAnnouncementResponse>;
  },
  appliedIds: Set<string> = new Set(),
): CoreOperationSubmitter {
  return async (operation) => {
    if (appliedIds.has(operation.id)) {
      const entity =
        operation.entityType === 'active_gathering'
          ? entities.gathering.get(operation.entityId)
          : entities.navResponses.get(operation.entityId);
      return {
        status: 'duplicate',
        operationId: operation.id,
        entityVersion:
          (entity && 'entityVersion' in entity
            ? entity.entityVersion
            : operation.entityVersion)
          ?? operation.entityVersion,
        entity,
      };
    }

    if (operation.entityType === 'active_gathering') {
      const current = entities.gathering.get(operation.entityId);
      const serverVersion = current?.entityVersion ?? 0;
      if (operation.entityVersion !== serverVersion) {
        return {
          status: 'conflict',
          operationId: operation.id,
          conflict: {
            code: 'stale_version',
            message: 'active gathering version mismatch',
            serverEntityVersion: serverVersion,
            serverState: current ?? undefined,
            operationId: operation.id,
            entityType: operation.entityType,
            entityId: operation.entityId,
            occurredAt: Date.now(),
          },
        };
      }

      // Recompute transition (do not blindly trust client result for phase).
      let next: ActiveGatheringState;
      try {
        if (operation.operationType === 'start_gathering') {
          const base = current ?? {
            groupId: operation.groupId,
            journeyPhase: 'staying' as const,
            activeDestinationId:
              (operation.payload.activeDestinationId as string | null)
              ?? null,
            pointStatuses: {},
            phaseChangedAt: 0,
            entityVersion: 0,
          };
          if (
            operation.payload.activeDestinationId
            && !base.activeDestinationId
          ) {
            base.activeDestinationId = operation.payload
              .activeDestinationId as string;
          }
          next = startGathering(base, Date.now());
        } else if (operation.operationType === 'switch_gathering') {
          const base = current ?? {
            groupId: operation.groupId,
            journeyPhase: 'staying' as const,
            activeDestinationId: null,
            pointStatuses: {},
            phaseChangedAt: 0,
            entityVersion: 0,
          };
          next = switchGathering(
            base,
            operation.payload.activeDestinationId as string,
            Date.now(),
          );
        } else if (operation.operationType === 'end_gathering') {
          if (!current) {
            throw new Error('invalid_transition:end_gathering');
          }
          next = endGathering(
            current,
            Date.now(),
            (operation.payload.nextDestinationId as string | null) ?? undefined,
          );
        } else {
          const result = operation.payload.result as ActiveGatheringState | undefined;
          if (!result) throw new Error('missing result');
          next = { ...result, entityVersion: serverVersion + 1 };
        }
      } catch (cause) {
        return {
          status: 'conflict',
          operationId: operation.id,
          conflict: {
            code: 'invalid_transition',
            message: cause instanceof Error ? cause.message : 'invalid transition',
            serverEntityVersion: serverVersion,
            serverState: current ?? undefined,
            operationId: operation.id,
            entityType: operation.entityType,
            entityId: operation.entityId,
            occurredAt: Date.now(),
          },
        };
      }

      entities.gathering.set(operation.entityId, next);
      appliedIds.add(operation.id);
      return {
        status: 'accepted',
        operationId: operation.id,
        entityVersion: next.entityVersion,
        entity: next,
      };
    }

    if (operation.entityType === 'navigation_response') {
      const current = entities.navResponses.get(operation.entityId);
      const serverVersion = current?.entityVersion ?? 0;
      if (operation.entityVersion !== serverVersion) {
        return {
          status: 'conflict',
          operationId: operation.id,
          conflict: {
            code: 'stale_version',
            message: 'navigation response version mismatch',
            serverEntityVersion: serverVersion,
            serverState: current ?? undefined,
            operationId: operation.id,
            entityType: operation.entityType,
            entityId: operation.entityId,
            occurredAt: Date.now(),
          },
        };
      }
      const result = operation.payload.result as NavigationAnnouncementResponse | undefined;
      if (!result) {
        return {
          status: 'conflict',
          operationId: operation.id,
          conflict: {
            code: 'unknown',
            message: 'missing result payload',
            operationId: operation.id,
            entityType: operation.entityType,
            entityId: operation.entityId,
            occurredAt: Date.now(),
          },
        };
      }
      const next = { ...result, entityVersion: serverVersion + 1 };
      entities.navResponses.set(operation.entityId, next);
      appliedIds.add(operation.id);
      return {
        status: 'accepted',
        operationId: operation.id,
        entityVersion: next.entityVersion,
        entity: next,
      };
    }

    appliedIds.add(operation.id);
    return {
      status: 'accepted',
      operationId: operation.id,
      entityVersion: operation.entityVersion + 1,
    };
  };
}
