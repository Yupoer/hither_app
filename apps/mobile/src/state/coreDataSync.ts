/**
 * Production wiring for OTA-04 core operation outbox + snapshot helpers.
 * Single shared store + outbox (one serial path for mutations / remote save).
 */

import { applyCoreOperation, fetchCoreEntityVersions } from '../api/services/CoreDataService';
import type {
  ActiveGatheringState,
  NavigationAnnouncementResponseKind,
} from '../types/coreData';
import type { GroupState } from '../types';
import {
  applyGatheringToDestinations,
  applyGatheringToGroup,
  deriveActiveGatheringFromGroupState,
} from '../utils/activeGatheringState';
import {
  getCoreActiveGathering,
  setPendingGatheringGuard,
  sharedCoreDataStore,
  sharedCoreDb,
  type CoreDataStore,
} from './coreDataStore';
import {
  createCoreOperationOutbox,
  SQLiteCoreOperationOutboxDatabase,
  subscribeCoreOutboxChanges,
  type CoreOperationOutbox,
} from './coreOperationOutbox';

const outboxDb = new SQLiteCoreOperationOutboxDatabase();

const outbox: CoreOperationOutbox = createCoreOperationOutbox(
  sharedCoreDb,
  outboxDb,
  applyCoreOperation,
);

// Remote snapshot must not clobber pending gathering outbox ops.
setPendingGatheringGuard((groupId) => outbox.hasPendingGathering(groupId));

export function getCoreDataStore(): CoreDataStore {
  return sharedCoreDataStore;
}

export function getCoreOperationOutbox(): CoreOperationOutbox {
  return outbox;
}

export { subscribeCoreOutboxChanges };

export async function flushCoreOperationOutbox(
  maxEntries?: number,
): Promise<Awaited<ReturnType<CoreOperationOutbox['flush']>>> {
  return outbox.flush(maxEntries);
}

export async function initializeCoreDataLayer(): Promise<void> {
  await sharedCoreDataStore.initialize();
  await outbox.initialize();
}

export async function listOpenCoreOperations(groupId: string) {
  return outbox.listOpenByGroup(groupId);
}

/** Project optimistic gathering onto an in-memory GroupState for React paint. */
export function projectOptimisticGathering(
  state: GroupState,
  gathering: ActiveGatheringState,
): GroupState {
  return {
    ...state,
    group: applyGatheringToGroup(state.group, gathering),
    destinations: applyGatheringToDestinations(state.destinations, gathering),
    nextDestination:
      state.destinations.find((d) => d.id === gathering.activeDestinationId)
      ?? state.destinations.find((d) => !d.closedAt)
      ?? state.nextDestination,
  };
}

/**
 * Leader Start — local-first: write optimistic gathering + outbox.
 * Throws on enqueue failure so call sites do not pretend durability succeeded.
 *
 * Pass `flushImmediately: false` when a subsequent legacy navigation session
 * call must succeed (or be classified as offline) before the outbox may flush.
 */
export async function enqueueLeaderGatheringStart(
  groupId: string,
  options: {
    baseState?: ActiveGatheringState;
    groupState?: GroupState | null;
    activeDestinationId?: string | null;
    operationId?: string;
    /** Default true. Journey start sets false until session outcome is known. */
    flushImmediately?: boolean;
  } = {},
): Promise<{
  local: ActiveGatheringState;
  base: ActiveGatheringState;
  operationId: string;
}> {
  const base =
    options.baseState
    ?? (await getCoreActiveGathering(groupId))
    ?? (options.groupState
      ? deriveActiveGatheringFromGroupState(options.groupState, 0)
      : null);
  if (!base) {
    throw new Error('no local gathering base for start');
  }
  const { local, operation, base: appliedBase } =
    await outbox.enqueueGatheringTransition({
      operationId: options.operationId,
      groupId,
      action: 'start',
      baseState: base,
      activeDestinationId: options.activeDestinationId ?? base.activeDestinationId,
    });
  if (options.flushImmediately !== false) {
    void outbox.flush().catch(() => undefined);
  }
  return { local, base: appliedBase, operationId: operation.id };
}

/**
 * Leader switch — local-first pause of the previous point plus Start of the
 * requested open point. Unlike End, this never closes a destination.
 */
export async function enqueueLeaderGatheringSwitch(
  groupId: string,
  options: {
    baseState?: ActiveGatheringState;
    groupState?: GroupState | null;
    activeDestinationId: string;
    operationId?: string;
    flushImmediately?: boolean;
  },
): Promise<{
  local: ActiveGatheringState;
  base: ActiveGatheringState;
  operationId: string;
}> {
  const base =
    options.baseState
    ?? (await getCoreActiveGathering(groupId))
    ?? (options.groupState
      ? deriveActiveGatheringFromGroupState(options.groupState, 0)
      : null);
  if (!base) throw new Error('no local gathering base for switch');
  const { local, operation, base: appliedBase } =
    await outbox.enqueueGatheringTransition({
      operationId: options.operationId,
      groupId,
      action: 'switch',
      baseState: base,
      activeDestinationId: options.activeDestinationId,
    });
  if (options.flushImmediately !== false) {
    void outbox.flush().catch(() => undefined);
  }
  return { local, base: appliedBase, operationId: operation.id };
}

/**
 * Business rejection after optimistic Start: mark outbox conflict and restore
 * pre-transition gathering. Does not apply to transient network failures.
 */
export async function abortLeaderGatheringStart(input: {
  operationId: string;
  restore: ActiveGatheringState;
  message?: string;
}): Promise<void> {
  await outbox.markGatheringConflictAndRestore({
    operationId: input.operationId,
    restore: input.restore,
    message: input.message ?? 'legacy navigation session rejected',
    code: 'invalid_transition',
  });
}

/**
 * Leader End navigation — local-first pause of flock travel.
 * Active point reverts to pending (not completed / no closed_at).
 * Throws on enqueue failure.
 */
export async function enqueueLeaderGatheringEnd(
  groupId: string,
  options: {
    baseState?: ActiveGatheringState;
    groupState?: GroupState | null;
    nextDestinationId?: string | null;
    operationId?: string;
  } = {},
): Promise<{ local: ActiveGatheringState }> {
  const base =
    options.baseState
    ?? (await getCoreActiveGathering(groupId))
    ?? (options.groupState
      ? deriveActiveGatheringFromGroupState(options.groupState, 0)
      : null);
  if (!base) {
    throw new Error('no local gathering base for end');
  }
  const { local } = await outbox.enqueueGatheringTransition({
    operationId: options.operationId,
    groupId,
    action: 'end',
    baseState: base,
    nextDestinationId: options.nextDestinationId,
  });
  void outbox.flush().catch(() => undefined);
  return { local };
}

/**
 * Personal navigation announcement response (OTA-02 shape).
 * Never mutates team gathering phase.
 */
export async function enqueuePersonalNavigationResponse(input: {
  groupId: string;
  sessionId: string;
  userId: string;
  response: NavigationAnnouncementResponseKind | null;
  baseVersion?: number;
  operationId?: string;
}): Promise<void> {
  const existing = await sharedCoreDataStore.getNavigationResponse(
    input.sessionId,
    input.userId,
  );
  const baseVersion = input.baseVersion ?? existing?.entityVersion ?? 0;
  await outbox.enqueueNavigationResponse({
    operationId: input.operationId,
    groupId: input.groupId,
    sessionId: input.sessionId,
    userId: input.userId,
    response: input.response,
    baseVersion,
  });
  void outbox.flush().catch(() => undefined);
}

/**
 * After remote group load: pull server entity versions and persist on snapshot.
 */
export async function hydrateCoreEntityVersions(
  groupId: string,
  state: GroupState,
): Promise<void> {
  try {
    const versions = await fetchCoreEntityVersions(groupId);
    const gathering = versions.find(
      (v) => v.entityType === 'active_gathering' && v.entityId === groupId,
    );
    await sharedCoreDataStore.saveRemoteGroupState(state, {
      gatheringVersion: gathering?.entityVersion,
      entityVersion: gathering?.entityVersion,
    });
  } catch {
    await sharedCoreDataStore.saveRemoteGroupState(state);
  }
}
