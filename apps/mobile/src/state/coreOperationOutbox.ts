/**
 * OTA-04 core operation outbox.
 *
 * Local optimistic state and outbox rows are written in ONE exclusive
 * transaction (no nested BEGIN). Replays are idempotent. Stale versions
 * return a displayable conflict rather than silently overwriting.
 */

import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
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
} from '../utils/activeGatheringState';
import type { CoreDataDatabase, CoreSqlExecutor } from './coreDataStore';
import { getHitherDatabase } from './hitherDatabase';

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
}

export type CoreOperationSubmitter = (
  operation: CoreOperation,
) => Promise<ApplyCoreOperationResult>;

export interface CoreOperationOutboxDatabase {
  initialize(): Promise<void>;
  insert(operation: CoreOperation): Promise<void>;
  /** Insert using an executor already inside an exclusive transaction. */
  writeInsert(exec: CoreSqlExecutor, operation: CoreOperation): Promise<void>;
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
  listOpenByGroup(groupId: string): Promise<CoreOperation[]>;
  withExclusiveTransaction<T>(
    work: (exec: CoreSqlExecutor) => Promise<T>,
  ): Promise<T>;
}

interface OutboxRow {
  id: string;
  group_id: string;
  entity_type: string;
  entity_id: string;
  entity_version: number;
  operation_type: string;
  payload: string;
  status: string;
  attempts: number;
  next_attempt_at: number;
  conflict_result: string | null;
  created_at: number;
  updated_at: number;
}

function rowToOperation(row: OutboxRow): CoreOperation {
  return {
    id: row.id,
    groupId: row.group_id,
    entityType: row.entity_type as CoreEntityType,
    entityId: row.entity_id,
    entityVersion: row.entity_version,
    operationType: row.operation_type as CoreOperationType,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.created_at,
    status: row.status as CoreOperationStatus,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    conflictResult: row.conflict_result
      ? (JSON.parse(row.conflict_result) as CoreConflictResult)
      : null,
    updatedAt: row.updated_at,
  };
}

async function insertOutboxRow(
  exec: CoreSqlExecutor,
  operation: CoreOperation,
): Promise<void> {
  await exec.runAsync(
    `INSERT OR IGNORE INTO core_operation_outbox
       (id, group_id, entity_type, entity_id, entity_version, operation_type,
        payload, status, attempts, next_attempt_at, conflict_result,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    operation.id,
    operation.groupId,
    operation.entityType,
    operation.entityId,
    operation.entityVersion,
    operation.operationType,
    JSON.stringify(operation.payload),
    operation.status,
    operation.attempts,
    operation.nextAttemptAt,
    operation.conflictResult ? JSON.stringify(operation.conflictResult) : null,
    operation.createdAt,
    operation.updatedAt,
  );
}

export class MemoryCoreOperationOutboxDatabase implements CoreOperationOutboxDatabase {
  operations = new Map<string, CoreOperation>();
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

  async initialize(): Promise<void> {}

  async writeInsert(_exec: CoreSqlExecutor, operation: CoreOperation): Promise<void> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error('forced outbox insert failure');
    }
    if (!this.operations.has(operation.id)) {
      this.operations.set(operation.id, operation);
    }
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
    return [...this.operations.values()]
      .filter(
        (op) =>
          (op.status === 'pending' || op.status === 'failed' || op.status === 'inflight')
          && op.nextAttemptAt <= now,
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
  }

  async update(operation: CoreOperation): Promise<void> {
    this.operations.set(operation.id, operation);
  }

  async delete(id: string): Promise<void> {
    this.operations.delete(id);
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
    const exec: CoreSqlExecutor = {
      runAsync: async () => undefined,
      getFirstAsync: async () => null,
    };
    try {
      const result = await work(exec);
      this.txnSnapshot = null;
      return result;
    } catch (error) {
      if (this.txnSnapshot) {
        this.operations = this.txnSnapshot;
        this.txnSnapshot = null;
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
       WHERE next_attempt_at <= ?
         AND status IN ('pending', 'failed', 'inflight')
       ORDER BY created_at ASC
       LIMIT ?`,
      now,
      limit,
    );
    return rows.map(rowToOperation);
  }

  async update(operation: CoreOperation): Promise<void> {
    const database = await this.openDatabase();
    await database.runAsync(
      `UPDATE core_operation_outbox
       SET status = ?, attempts = ?, next_attempt_at = ?,
           conflict_result = ?, entity_version = ?, updated_at = ?,
           payload = ?
       WHERE id = ?`,
      operation.status,
      operation.attempts,
      operation.nextAttemptAt,
      operation.conflictResult ? JSON.stringify(operation.conflictResult) : null,
      operation.entityVersion,
      operation.updatedAt,
      JSON.stringify(operation.payload),
      operation.id,
    );
  }

  async delete(id: string): Promise<void> {
    const database = await this.openDatabase();
    await database.runAsync('DELETE FROM core_operation_outbox WHERE id = ?', id);
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

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 2 ** Math.max(1, attempts) * 1_000);
}

export interface EnqueueGatheringInput {
  operationId?: string;
  groupId: string;
  action: 'start' | 'end';
  nextDestinationId?: string | null;
  baseState: ActiveGatheringState;
  /** Optional destination id for start when base has none selected. */
  activeDestinationId?: string | null;
}

export interface EnqueueNavigationResponseInput {
  operationId?: string;
  groupId: string;
  sessionId: string;
  userId: string;
  response: NavigationAnnouncementResponseKind | null;
  baseVersion: number;
}

export function createCoreOperationOutbox(
  coreDb: CoreDataDatabase,
  outboxDb: CoreOperationOutboxDatabase,
  submit: CoreOperationSubmitter,
  now: () => number = Date.now,
  idFactory: () => string = () => Crypto.randomUUID(),
) {
  let serial = Promise.resolve();
  let initialization: Promise<void> | null = null;

  const runSerial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = serial.then(operation, operation);
    serial = next.then(() => undefined, () => undefined);
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

  /**
   * ONE exclusive transaction: local state write + outbox insert.
   * Uses coreDb's exclusive txn so gathering writes use the same exec
   * (no nested BEGIN).
   */
  const writeLocalAndOutbox = async (
    applyLocal: (exec: CoreSqlExecutor) => Promise<void>,
    operation: CoreOperation,
  ): Promise<CoreOperation> => {
    await coreDb.withExclusiveTransaction(async (exec) => {
      await applyLocal(exec);
      await outboxDb.writeInsert(exec, operation);
    });
    return operation;
  };

  const handleSubmitResult = async (
    operation: CoreOperation,
    result: ApplyCoreOperationResult,
    current: number,
  ): Promise<'sent' | 'conflict' | 'duplicate'> => {
    if (result.status === 'accepted' || result.status === 'duplicate') {
      // Compact: delete acked rows so outbox stays bounded.
      await outboxDb.delete(operation.id);
      if (
        result.entity
        && typeof result.entity === 'object'
        && operation.entityType === 'active_gathering'
      ) {
        if (isUsableActiveGatheringState(result.entity)) {
          // Server-accepted entity is authoritative remote state.
          await coreDb.putActiveGathering(result.entity, {
            patchSnapshot: 'remote',
          });
        }
      }
      if (
        result.entity
        && typeof result.entity === 'object'
        && operation.entityType === 'navigation_response'
      ) {
        const entity = result.entity as NavigationAnnouncementResponse;
        if (entity.sessionId && entity.userId) {
          await coreDb.putNavigationResponse(entity);
        }
      }
      notifyCoreOutboxChanged();
      return result.status === 'duplicate' ? 'duplicate' : 'sent';
    }

    const conflict = result.conflict;
    await outboxDb.update({
      ...operation,
      status: 'conflict',
      conflictResult: conflict,
      updatedAt: current,
    });
    // Only write back server gathering when shape is valid (never empty {}).
    if (
      conflict.serverState
      && operation.entityType === 'active_gathering'
      && isUsableActiveGatheringState(conflict.serverState)
    ) {
      await coreDb.putActiveGathering(conflict.serverState, {
        patchSnapshot: 'remote',
      });
    } else if (
      conflict.serverState
      && typeof conflict.serverState === 'object'
      && operation.entityType === 'navigation_response'
    ) {
      const entity = conflict.serverState as NavigationAnnouncementResponse;
      if (entity.sessionId && entity.userId) {
        await coreDb.putNavigationResponse(entity);
      }
    }
    notifyCoreOutboxChanged();
    return 'conflict';
  };

  return {
    initialize,
    runSerial,

    enqueueGatheringTransition(
      input: EnqueueGatheringInput,
    ): Promise<{ operation: CoreOperation; local: ActiveGatheringState }> {
      return runSerial(async () => {
        await initialize();
        const current = now();
        const base =
          input.activeDestinationId
          && !input.baseState.activeDestinationId
            ? {
                ...input.baseState,
                activeDestinationId: input.activeDestinationId,
              }
            : input.baseState;
        const local =
          input.action === 'start'
            ? startGathering(base, current)
            : endGathering(base, current, input.nextDestinationId);

        // Post-end next cursor must ship in payload (not only pre-end input).
        const nextDestinationIdForPayload =
          input.action === 'end'
            ? (input.nextDestinationId !== undefined
                ? input.nextDestinationId
                : local.activeDestinationId)
            : (input.nextDestinationId ?? null);

        const operation: CoreOperation = {
          id: input.operationId ?? idFactory(),
          groupId: input.groupId,
          entityType: 'active_gathering',
          entityId: input.groupId,
          entityVersion: base.entityVersion,
          operationType:
            input.action === 'start' ? 'start_gathering' : 'end_gathering',
          payload: {
            action: input.action,
            nextDestinationId: nextDestinationIdForPayload,
            activeDestinationId:
              input.action === 'start'
                ? local.activeDestinationId
                : base.activeDestinationId,
            result: local,
          },
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
          });
        }, operation);

        notifyCoreOutboxChanged();
        return { operation, local };
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
        const operation: CoreOperation = {
          id: input.operationId ?? idFactory(),
          groupId: input.groupId,
          entityType: 'navigation_response',
          entityId: `${input.sessionId}:${input.userId}`,
          entityVersion: input.baseVersion,
          operationType: 'set_navigation_response',
          payload: {
            sessionId: input.sessionId,
            userId: input.userId,
            response: input.response,
            result: local,
          },
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

    flush(maxEntries = MAX_BATCH): Promise<CoreOutboxFlushResult> {
      return runSerial(async () => {
        await initialize();
        const current = now();
        const due = await outboxDb.getDue(current, Math.max(0, maxEntries));
        let sent = 0;
        let conflicts = 0;
        let duplicates = 0;
        let retryScheduled = 0;

        for (const operation of due) {
          const inflight: CoreOperation = {
            ...operation,
            status: 'inflight',
            updatedAt: current,
          };
          await outboxDb.update(inflight);

          try {
            const result = await submit(operation);
            const kind = await handleSubmitResult(operation, result, now());
            if (kind === 'sent') sent += 1;
            else if (kind === 'duplicate') duplicates += 1;
            else conflicts += 1;
          } catch {
            const attempts = operation.attempts + 1;
            await outboxDb.update({
              ...operation,
              status: 'failed',
              attempts,
              nextAttemptAt: now() + backoffMs(attempts),
              updatedAt: now(),
            });
            retryScheduled += 1;
            notifyCoreOutboxChanged();
          }
        }

        if (due.length > 0) notifyCoreOutboxChanged();

        return {
          sent,
          conflicts,
          duplicates,
          remaining: await outboxDb.countPending(),
          retryScheduled,
        };
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
        return outboxDb.listOpenByGroup(groupId);
      });
    },

    pendingCount(): Promise<number> {
      return runSerial(async () => {
        await initialize();
        return outboxDb.countPending();
      });
    },

    hasPendingGathering(groupId: string): Promise<boolean> {
      return runSerial(async () => {
        await initialize();
        const n = await outboxDb.countPendingForEntity(
          groupId,
          'active_gathering',
          groupId,
        );
        return n > 0;
      });
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
