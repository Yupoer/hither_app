/**
 * OTA-04 local-first core data store.
 *
 * SQLite is the device read/write source for group snapshot, itinerary,
 * active gathering state, and personal navigation responses.
 *
 * Write helpers that participate in the operation outbox MUST use
 * `write*` (runAsync only) inside a single exclusive transaction —
 * never nest `withTransaction*`.
 */

import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { GroupState } from '../types';
import type {
  ActiveGatheringState,
  CoreGroupSnapshot,
  CoreSnapshotSource,
  NavigationAnnouncementResponse,
  NavigationAnnouncementResponseKind,
} from '../types/coreData';
import {
  deriveActiveGatheringFromGroupState,
  groupStateFromSnapshotParts,
} from '../utils/activeGatheringState';
import { getHitherDatabase } from './hitherDatabase';

/** Minimal executor so exclusive txn and plain DB share the same write path. */
export interface CoreSqlExecutor {
  runAsync(source: string, ...params: unknown[]): Promise<unknown>;
  getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>;
}

export interface CoreDataDatabase {
  initialize(): Promise<void>;
  getSnapshot(groupId: string): Promise<CoreGroupSnapshot | null>;
  putSnapshot(snapshot: CoreGroupSnapshot): Promise<void>;
  deleteSnapshot(groupId: string): Promise<void>;
  getActiveGathering(groupId: string): Promise<ActiveGatheringState | null>;
  /** Opens its own exclusive transaction. Defaults to optimistic snapshot patch. */
  putActiveGathering(
    state: ActiveGatheringState,
    options?: WriteActiveGatheringOptions,
  ): Promise<void>;
  /**
   * Raw write — caller must already be inside withExclusiveTransaction.
   * Use `patchSnapshot: 'none'` after a remote putSnapshot so source stays remote.
   */
  writeActiveGathering(
    exec: CoreSqlExecutor,
    state: ActiveGatheringState,
    updatedAt?: number,
    options?: WriteActiveGatheringOptions,
  ): Promise<void>;
  getNavigationResponse(
    sessionId: string,
    userId: string,
  ): Promise<NavigationAnnouncementResponse | null>;
  putNavigationResponse(response: NavigationAnnouncementResponse): Promise<void>;
  writeNavigationResponse(
    exec: CoreSqlExecutor,
    response: NavigationAnnouncementResponse,
  ): Promise<void>;
  listNavigationResponsesForSession(
    sessionId: string,
  ): Promise<NavigationAnnouncementResponse[]>;
  /**
   * Single exclusive write transaction. Prefer over nested withTransactionAsync.
   * Falls back to non-exclusive on web.
   */
  withExclusiveTransaction<T>(
    work: (exec: CoreSqlExecutor) => Promise<T>,
  ): Promise<T>;
  /** True when this group has optimistic local state that must not be clobbered. */
  hasLocalOptimisticGathering?(groupId: string): Promise<boolean>;
}

interface SnapshotRow {
  group_id: string;
  payload: string;
  entity_version: number;
  synced_at: number;
  updated_at: number;
  source: string;
}

interface GatheringRow {
  group_id: string;
  journey_phase: string;
  active_destination_id: string | null;
  point_statuses: string;
  phase_changed_at: number;
  entity_version: number;
  updated_at: number;
}

interface NavResponseRow {
  session_id: string;
  user_id: string;
  group_id: string;
  response: string | null;
  entity_version: number;
  updated_at: number;
}

export function snapshotPayloadOf(snapshot: CoreGroupSnapshot): string {
  return JSON.stringify({
    group: snapshot.group,
    destinations: snapshot.destinations,
    members: snapshot.members ?? [],
    subgroups: snapshot.subgroups ?? [],
    activeGathering: snapshot.activeGathering,
  });
}

function rowToSnapshot(row: SnapshotRow): CoreGroupSnapshot {
  const payload = JSON.parse(row.payload) as {
    group: CoreGroupSnapshot['group'];
    destinations: CoreGroupSnapshot['destinations'];
    members?: CoreGroupSnapshot['members'];
    subgroups?: CoreGroupSnapshot['subgroups'];
    activeGathering: ActiveGatheringState;
  };
  return {
    groupId: row.group_id,
    group: payload.group,
    destinations: payload.destinations,
    members: payload.members,
    subgroups: payload.subgroups,
    activeGathering: payload.activeGathering,
    entityVersion: row.entity_version,
    syncedAt: row.synced_at,
    updatedAt: row.updated_at,
    source: row.source as CoreSnapshotSource,
  };
}

function rowToGathering(row: GatheringRow): ActiveGatheringState {
  return {
    groupId: row.group_id,
    journeyPhase: row.journey_phase as ActiveGatheringState['journeyPhase'],
    activeDestinationId: row.active_destination_id,
    pointStatuses: JSON.parse(row.point_statuses) as ActiveGatheringState['pointStatuses'],
    phaseChangedAt: row.phase_changed_at,
    entityVersion: row.entity_version,
  };
}

function rowToNavResponse(row: NavResponseRow): NavigationAnnouncementResponse {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    groupId: row.group_id,
    response: (row.response as NavigationAnnouncementResponseKind | null) ?? null,
    entityVersion: row.entity_version,
    updatedAt: row.updated_at,
  };
}

/**
 * How to patch core_snapshots when writing gathering.
 * - optimistic: outbox local mutation (sets source local_optimistic)
 * - remote: authoritative server writeback (sets source remote)
 * - keep: update payload/version but preserve existing source
 * - none: gathering table only (remote putSnapshot already wrote snapshot row)
 */
export type SnapshotPatchMode = 'optimistic' | 'remote' | 'keep' | 'none';

export interface WriteActiveGatheringOptions {
  patchSnapshot?: SnapshotPatchMode;
}

/** Gathering table only — never touches core_snapshots.source. */
async function writeGatheringTableOnly(
  exec: CoreSqlExecutor,
  state: ActiveGatheringState,
  updatedAt: number,
): Promise<void> {
  await exec.runAsync(
    `INSERT INTO core_active_gathering
       (group_id, journey_phase, active_destination_id, point_statuses,
        phase_changed_at, entity_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET
       journey_phase = excluded.journey_phase,
       active_destination_id = excluded.active_destination_id,
       point_statuses = excluded.point_statuses,
       phase_changed_at = excluded.phase_changed_at,
       entity_version = excluded.entity_version,
       updated_at = excluded.updated_at`,
    state.groupId,
    state.journeyPhase,
    state.activeDestinationId,
    JSON.stringify(state.pointStatuses),
    state.phaseChangedAt,
    state.entityVersion,
    updatedAt,
  );
}

/**
 * Write gathering + optional snapshot patch.
 * Remote saves must use patchSnapshot: 'none' after writing the snapshot row.
 */
async function writeGatheringRows(
  exec: CoreSqlExecutor,
  state: ActiveGatheringState,
  updatedAt: number,
  options: WriteActiveGatheringOptions = {},
): Promise<void> {
  const patchMode = options.patchSnapshot ?? 'optimistic';
  await writeGatheringTableOnly(exec, state, updatedAt);

  if (patchMode === 'none') return;

  const snap = await exec.getFirstAsync<SnapshotRow>(
    'SELECT * FROM core_snapshots WHERE group_id = ?',
    state.groupId,
  );
  if (!snap) return;

  const existing = rowToSnapshot(snap);
  const nextSource: CoreSnapshotSource =
    patchMode === 'optimistic'
      ? 'local_optimistic'
      : patchMode === 'remote'
        ? 'remote'
        : existing.source;

  const next: CoreGroupSnapshot = {
    ...existing,
    activeGathering: state,
    entityVersion: Math.max(existing.entityVersion, state.entityVersion),
    updatedAt,
    source: nextSource,
  };
  await exec.runAsync(
    `UPDATE core_snapshots
     SET payload = ?, entity_version = ?, updated_at = ?, source = ?
     WHERE group_id = ?`,
    snapshotPayloadOf(next),
    next.entityVersion,
    next.updatedAt,
    next.source,
    next.groupId,
  );
}

export class MemoryCoreDataDatabase implements CoreDataDatabase {
  snapshots = new Map<string, CoreGroupSnapshot>();
  gatherings = new Map<string, ActiveGatheringState>();
  navResponses = new Map<string, NavigationAnnouncementResponse>();

  /** Test seam: shared journal for multi-store atomicity tests. */
  private journal: {
    snapshots: Map<string, CoreGroupSnapshot>;
    gatherings: Map<string, ActiveGatheringState>;
    navResponses: Map<string, NavigationAnnouncementResponse>;
  } | null = null;

  /** Optional linked outbox memory map for atomic multi-resource tx tests. */
  linkedOutbox: { operations: Map<string, unknown>; snapshot: Map<string, unknown> | null } | null =
    null;

  private key(sessionId: string, userId: string): string {
    return `${sessionId}::${userId}`;
  }

  async initialize(): Promise<void> {}

  async getSnapshot(groupId: string): Promise<CoreGroupSnapshot | null> {
    return this.snapshots.get(groupId) ?? null;
  }

  async putSnapshot(snapshot: CoreGroupSnapshot): Promise<void> {
    this.snapshots.set(snapshot.groupId, snapshot);
    this.gatherings.set(snapshot.groupId, snapshot.activeGathering);
  }

  async deleteSnapshot(groupId: string): Promise<void> {
    this.snapshots.delete(groupId);
    this.gatherings.delete(groupId);
  }

  async getActiveGathering(groupId: string): Promise<ActiveGatheringState | null> {
    return this.gatherings.get(groupId) ?? null;
  }

  async writeActiveGathering(
    _exec: CoreSqlExecutor,
    state: ActiveGatheringState,
    updatedAt = Date.now(),
    options: WriteActiveGatheringOptions = {},
  ): Promise<void> {
    const patchMode = options.patchSnapshot ?? 'optimistic';
    this.gatherings.set(state.groupId, state);
    if (patchMode === 'none') return;

    const existing = this.snapshots.get(state.groupId);
    if (!existing) return;

    const nextSource: CoreSnapshotSource =
      patchMode === 'optimistic'
        ? 'local_optimistic'
        : patchMode === 'remote'
          ? 'remote'
          : existing.source;

    this.snapshots.set(state.groupId, {
      ...existing,
      activeGathering: state,
      entityVersion: Math.max(existing.entityVersion, state.entityVersion),
      updatedAt: Math.max(existing.updatedAt, updatedAt, state.phaseChangedAt),
      source: nextSource,
    });
  }

  async putActiveGathering(
    state: ActiveGatheringState,
    options: WriteActiveGatheringOptions = {},
  ): Promise<void> {
    await this.withExclusiveTransaction(async (exec) => {
      await this.writeActiveGathering(exec, state, Date.now(), options);
    });
  }

  async getNavigationResponse(
    sessionId: string,
    userId: string,
  ): Promise<NavigationAnnouncementResponse | null> {
    return this.navResponses.get(this.key(sessionId, userId)) ?? null;
  }

  async writeNavigationResponse(
    _exec: CoreSqlExecutor,
    response: NavigationAnnouncementResponse,
  ): Promise<void> {
    this.navResponses.set(this.key(response.sessionId, response.userId), response);
  }

  async putNavigationResponse(response: NavigationAnnouncementResponse): Promise<void> {
    await this.withExclusiveTransaction(async (exec) => {
      await this.writeNavigationResponse(exec, response);
    });
  }

  async listNavigationResponsesForSession(
    sessionId: string,
  ): Promise<NavigationAnnouncementResponse[]> {
    return [...this.navResponses.values()].filter((r) => r.sessionId === sessionId);
  }

  async hasLocalOptimisticGathering(groupId: string): Promise<boolean> {
    return this.snapshots.get(groupId)?.source === 'local_optimistic';
  }

  async withExclusiveTransaction<T>(
    work: (exec: CoreSqlExecutor) => Promise<T>,
  ): Promise<T> {
    // Snapshot for rollback (proves atomicity in unit tests).
    this.journal = {
      snapshots: new Map(this.snapshots),
      gatherings: new Map(this.gatherings),
      navResponses: new Map(this.navResponses),
    };
    if (this.linkedOutbox) {
      this.linkedOutbox.snapshot = new Map(this.linkedOutbox.operations);
    }
    const exec: CoreSqlExecutor = {
      runAsync: async () => undefined,
      getFirstAsync: async () => null,
    };
    try {
      const result = await work(exec);
      this.journal = null;
      if (this.linkedOutbox) this.linkedOutbox.snapshot = null;
      return result;
    } catch (error) {
      if (this.journal) {
        this.snapshots = this.journal.snapshots;
        this.gatherings = this.journal.gatherings;
        this.navResponses = this.journal.navResponses;
        this.journal = null;
      }
      if (this.linkedOutbox?.snapshot) {
        this.linkedOutbox.operations.clear();
        for (const [k, v] of this.linkedOutbox.snapshot) {
          this.linkedOutbox.operations.set(k, v);
        }
        this.linkedOutbox.snapshot = null;
      }
      throw error;
    }
  }
}

export class SQLiteCoreDataDatabase implements CoreDataDatabase {
  constructor(
    private readonly openDatabase: () => Promise<SQLiteDatabase> = getHitherDatabase,
  ) {}

  async initialize(): Promise<void> {
    await this.openDatabase();
  }

  async getSnapshot(groupId: string): Promise<CoreGroupSnapshot | null> {
    const database = await this.openDatabase();
    const row = await database.getFirstAsync<SnapshotRow>(
      'SELECT * FROM core_snapshots WHERE group_id = ?',
      groupId,
    );
    return row ? rowToSnapshot(row) : null;
  }

  async putSnapshot(snapshot: CoreGroupSnapshot): Promise<void> {
    await this.withExclusiveTransaction(async (exec) => {
      await exec.runAsync(
        `INSERT INTO core_snapshots
           (group_id, payload, entity_version, synced_at, updated_at, source)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(group_id) DO UPDATE SET
           payload = excluded.payload,
           entity_version = excluded.entity_version,
           synced_at = excluded.synced_at,
           updated_at = excluded.updated_at,
           source = excluded.source`,
        snapshot.groupId,
        snapshotPayloadOf(snapshot),
        snapshot.entityVersion,
        snapshot.syncedAt,
        snapshot.updatedAt,
        snapshot.source,
      );
      // Snapshot row already carries authoritative source + payload; gathering
      // table only — never force local_optimistic here.
      await writeGatheringRows(exec, snapshot.activeGathering, snapshot.updatedAt, {
        patchSnapshot: 'none',
      });
    });
  }

  async deleteSnapshot(groupId: string): Promise<void> {
    await this.withExclusiveTransaction(async (exec) => {
      await exec.runAsync('DELETE FROM core_snapshots WHERE group_id = ?', groupId);
      await exec.runAsync(
        'DELETE FROM core_active_gathering WHERE group_id = ?',
        groupId,
      );
    });
  }

  async getActiveGathering(groupId: string): Promise<ActiveGatheringState | null> {
    const database = await this.openDatabase();
    const row = await database.getFirstAsync<GatheringRow>(
      'SELECT * FROM core_active_gathering WHERE group_id = ?',
      groupId,
    );
    return row ? rowToGathering(row) : null;
  }

  async writeActiveGathering(
    exec: CoreSqlExecutor,
    state: ActiveGatheringState,
    updatedAt = Date.now(),
    options: WriteActiveGatheringOptions = {},
  ): Promise<void> {
    await writeGatheringRows(exec, state, updatedAt, options);
  }

  async putActiveGathering(
    state: ActiveGatheringState,
    options: WriteActiveGatheringOptions = {},
  ): Promise<void> {
    await this.withExclusiveTransaction(async (exec) => {
      await this.writeActiveGathering(exec, state, Date.now(), options);
    });
  }

  async getNavigationResponse(
    sessionId: string,
    userId: string,
  ): Promise<NavigationAnnouncementResponse | null> {
    const database = await this.openDatabase();
    const row = await database.getFirstAsync<NavResponseRow>(
      `SELECT * FROM core_navigation_responses
       WHERE session_id = ? AND user_id = ?`,
      sessionId,
      userId,
    );
    return row ? rowToNavResponse(row) : null;
  }

  async writeNavigationResponse(
    exec: CoreSqlExecutor,
    response: NavigationAnnouncementResponse,
  ): Promise<void> {
    await exec.runAsync(
      `INSERT INTO core_navigation_responses
         (session_id, user_id, group_id, response, entity_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, user_id) DO UPDATE SET
         group_id = excluded.group_id,
         response = excluded.response,
         entity_version = excluded.entity_version,
         updated_at = excluded.updated_at`,
      response.sessionId,
      response.userId,
      response.groupId,
      response.response,
      response.entityVersion,
      response.updatedAt,
    );
  }

  async putNavigationResponse(response: NavigationAnnouncementResponse): Promise<void> {
    await this.withExclusiveTransaction(async (exec) => {
      await this.writeNavigationResponse(exec, response);
    });
  }

  async listNavigationResponsesForSession(
    sessionId: string,
  ): Promise<NavigationAnnouncementResponse[]> {
    const database = await this.openDatabase();
    const rows = await database.getAllAsync<NavResponseRow>(
      'SELECT * FROM core_navigation_responses WHERE session_id = ?',
      sessionId,
    );
    return rows.map(rowToNavResponse);
  }

  async hasLocalOptimisticGathering(groupId: string): Promise<boolean> {
    const database = await this.openDatabase();
    const row = await database.getFirstAsync<{ source: string }>(
      'SELECT source FROM core_snapshots WHERE group_id = ?',
      groupId,
    );
    return row?.source === 'local_optimistic';
  }

  async withExclusiveTransaction<T>(
    work: (exec: CoreSqlExecutor) => Promise<T>,
  ): Promise<T> {
    const database = await this.openDatabase();
    // Exclusive txn is not supported on web; fall back to non-exclusive BEGIN.
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

/** Entity versions seed at 0 until first accepted apply (matches server). */
export const CORE_ENTITY_VERSION_SEED = 0;

export function coreSnapshotFromGroupState(
  state: GroupState,
  options: {
    entityVersion?: number;
    gatheringVersion?: number;
    syncedAt?: number;
    updatedAt?: number;
    source?: CoreSnapshotSource;
    activeGathering?: ActiveGatheringState;
  } = {},
): CoreGroupSnapshot {
  const now = options.updatedAt ?? Date.now();
  const version = options.entityVersion ?? CORE_ENTITY_VERSION_SEED;
  const gatheringVersion = options.gatheringVersion ?? version;
  const activeGathering =
    options.activeGathering
    ?? deriveActiveGatheringFromGroupState(state, gatheringVersion, now);
  return {
    groupId: state.group.id,
    group: state.group,
    destinations: state.destinations,
    members: state.members,
    subgroups: state.subgroups,
    activeGathering,
    entityVersion: version,
    syncedAt: options.syncedAt ?? now,
    updatedAt: now,
    source: options.source ?? 'remote',
  };
}

export function groupStateFromCoreSnapshot(snapshot: CoreGroupSnapshot): GroupState {
  return groupStateFromSnapshotParts(
    snapshot.group,
    snapshot.destinations,
    snapshot.activeGathering,
    snapshot.members ?? [],
    snapshot.subgroups ?? [],
  );
}

export type PendingGatheringGuard = (groupId: string) => Promise<boolean>;

export function createCoreDataStore(
  database: CoreDataDatabase,
  now: () => number = Date.now,
  /**
   * When true for a group, remote snapshot must not downgrade local_optimistic
   * gathering (pending/inflight outbox or optimistic source).
   */
  hasPendingGatheringOp: PendingGatheringGuard = async () => false,
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
      initialization = database.initialize().catch((error) => {
        initialization = null;
        throw error;
      });
    }
    return initialization;
  };

  return {
    initialize,
    runSerial,

    async readSnapshot(groupId: string): Promise<CoreGroupSnapshot | null> {
      return runSerial(async () => {
        await initialize();
        return database.getSnapshot(groupId);
      });
    },

    async saveRemoteGroupState(
      state: GroupState,
      options: {
        entityVersion?: number;
        gatheringVersion?: number;
      } = {},
    ): Promise<CoreGroupSnapshot> {
      return runSerial(async () => {
        await initialize();
        // Exclusive write re-reads snapshot + pending so a concurrent enqueue
        // cannot be clobbered after a stale pending=false check.
        return database.withExclusiveTransaction(async (exec) => {
          const existing = await database.getSnapshot(state.group.id);
          const nextVersion =
            options.entityVersion
            ?? existing?.entityVersion
            ?? CORE_ENTITY_VERSION_SEED;
          const gatheringVersion =
            options.gatheringVersion
            ?? existing?.activeGathering.entityVersion
            ?? nextVersion;

          const snapshot = coreSnapshotFromGroupState(state, {
            entityVersion: nextVersion,
            gatheringVersion,
            syncedAt: now(),
            updatedAt: now(),
            source: 'remote',
          });

          // Re-check pending inside the exclusive lane (issue #6 residual race).
          const pending =
            (await hasPendingGatheringOp(state.group.id))
            || existing?.source === 'local_optimistic'
            || (await database.hasLocalOptimisticGathering?.(state.group.id));

          if (
            pending
            && existing
            && existing.activeGathering.entityVersion
              >= snapshot.activeGathering.entityVersion
          ) {
            snapshot.activeGathering = existing.activeGathering;
            snapshot.entityVersion = Math.max(
              snapshot.entityVersion,
              existing.activeGathering.entityVersion,
            );
            snapshot.source = 'local_optimistic';
          }

          if (database instanceof MemoryCoreDataDatabase) {
            await database.putSnapshot(snapshot);
          } else {
            await exec.runAsync(
              `INSERT INTO core_snapshots
                 (group_id, payload, entity_version, synced_at, updated_at, source)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(group_id) DO UPDATE SET
                 payload = excluded.payload,
                 entity_version = excluded.entity_version,
                 synced_at = excluded.synced_at,
                 updated_at = excluded.updated_at,
                 source = excluded.source`,
              snapshot.groupId,
              snapshotPayloadOf(snapshot),
              snapshot.entityVersion,
              snapshot.syncedAt,
              snapshot.updatedAt,
              snapshot.source,
            );
            // Gathering table only — snapshot source already written above.
            await database.writeActiveGathering(
              exec,
              snapshot.activeGathering,
              snapshot.updatedAt,
              { patchSnapshot: 'none' },
            );
          }
          return snapshot;
        });
      });
    },

    async readGroupState(groupId: string): Promise<GroupState | null> {
      const snapshot = await this.readSnapshot(groupId);
      return snapshot ? groupStateFromCoreSnapshot(snapshot) : null;
    },

    async getActiveGathering(groupId: string): Promise<ActiveGatheringState | null> {
      return runSerial(async () => {
        await initialize();
        const direct = await database.getActiveGathering(groupId);
        if (direct) return direct;
        const snap = await database.getSnapshot(groupId);
        return snap?.activeGathering ?? null;
      });
    },

    async getNavigationResponse(
      sessionId: string,
      userId: string,
    ): Promise<NavigationAnnouncementResponse | null> {
      return runSerial(async () => {
        await initialize();
        return database.getNavigationResponse(sessionId, userId);
      });
    },

    async listNavigationResponsesForSession(
      sessionId: string,
    ): Promise<NavigationAnnouncementResponse[]> {
      return runSerial(async () => {
        await initialize();
        return database.listNavigationResponsesForSession(sessionId);
      });
    },

    database,
    now,
  };
}

export type CoreDataStore = ReturnType<typeof createCoreDataStore>;

/**
 * Shared production database + store. Outbox must use the same `sharedCoreDb`
 * instance so exclusive transactions cover local state + outbox rows.
 */
export const sharedCoreDb = new SQLiteCoreDataDatabase();

let pendingGatheringGuard: PendingGatheringGuard = async () => false;

export function setPendingGatheringGuard(guard: PendingGatheringGuard): void {
  pendingGatheringGuard = guard;
}

export const sharedCoreDataStore = createCoreDataStore(
  sharedCoreDb,
  Date.now,
  (groupId) => pendingGatheringGuard(groupId),
);

export function readCoreSnapshot(groupId: string): Promise<CoreGroupSnapshot | null> {
  return sharedCoreDataStore.readSnapshot(groupId);
}

export function saveRemoteGroupState(
  state: GroupState,
  entityVersionOrOptions?: number | {
    entityVersion?: number;
    gatheringVersion?: number;
  },
): Promise<CoreGroupSnapshot> {
  if (typeof entityVersionOrOptions === 'number') {
    return sharedCoreDataStore.saveRemoteGroupState(state, {
      entityVersion: entityVersionOrOptions,
    });
  }
  return sharedCoreDataStore.saveRemoteGroupState(state, entityVersionOrOptions);
}

export function readCoreGroupState(groupId: string): Promise<GroupState | null> {
  return sharedCoreDataStore.readGroupState(groupId);
}

export function getCoreActiveGathering(
  groupId: string,
): Promise<ActiveGatheringState | null> {
  return sharedCoreDataStore.getActiveGathering(groupId);
}

export function getCoreNavigationResponse(
  sessionId: string,
  userId: string,
): Promise<NavigationAnnouncementResponse | null> {
  return sharedCoreDataStore.getNavigationResponse(sessionId, userId);
}

export function getDefaultCoreDataStore(): CoreDataStore {
  return sharedCoreDataStore;
}
