/**
 * Production wiring for OTA-04 core operation outbox + snapshot helpers.
 * Single shared store + outbox (one serial path for mutations / remote save).
 */

import { applyCoreOperation, fetchCoreEntityVersions } from '../api/services/CoreDataService';
import { requireLocalActorId } from '../api/services/_helpers';
import type {
  ActiveGatheringState,
  CoreOperation,
  NavigationAnnouncementResponseKind,
} from '../types/coreData';
import type { Destination, GroupState } from '../types';
import * as Crypto from 'expo-crypto';
import { projectOperationDestinations } from './coreOperationProjection';
import {
  applyGatheringToDestinations,
  applyGatheringToGroup,
  deriveActiveGatheringFromGroupState,
} from '../utils/activeGatheringState';
import {
  getCoreActiveGathering,
  setCoreSnapshotActorGuard,
  setPendingGatheringGuard,
  setPendingItineraryGuard,
  sharedCoreDataStore,
  sharedCoreDb,
  type CoreDataStore,
} from './coreDataStore';
import {
  createCoreOperationOutbox,
  SQLiteCoreOperationOutboxDatabase,
  subscribeCoreOutboxChanges,
  type CoreActorGuard,
  type CoreOperationOutbox,
} from './coreOperationOutbox';

const outboxDb = new SQLiteCoreOperationOutboxDatabase();

const outbox: CoreOperationOutbox = createCoreOperationOutbox(
  sharedCoreDb,
  outboxDb,
  applyCoreOperation,
);

// Auth is deliberately injectable: the auth agent can provide the app's
// session guard without changing queue semantics or making the queue import UI.
let coreSessionGuard: CoreActorGuard = async () => {
  try {
    return await requireLocalActorId();
  } catch (error) {
    if ((error as { code?: string })?.code === 'local_auth_actor_missing') return null;
    throw error;
  }
};
outbox.setActorGuard(() => coreSessionGuard());
setCoreSnapshotActorGuard(() => coreSessionGuard());

function kickCoreTransport(): void {
  void flushCoreOperationOutbox().catch(() => undefined);
}

// Remote snapshot must not clobber pending gathering outbox ops.
setPendingGatheringGuard((groupId) => outbox.hasPendingGathering(groupId));
setPendingItineraryGuard((groupId) => outbox.hasPendingItinerary(groupId));

export function getCoreDataStore(): CoreDataStore {
  return sharedCoreDataStore;
}

/**
 * Cold-start seam for service mutations: hydrate the durable snapshot before
 * deciding whether a write may be queued. A failed hydrate is surfaced to the
 * caller; it must not silently fall back to an online-only mutation.
 */
export async function ensureCoreSnapshot(groupId: string) {
  const existing = await sharedCoreDataStore.readSnapshot(groupId);
  if (existing) return existing;
  const groupService = require('../api/services/GroupService') as {
    getGroupRecoverySnapshot: (id: string) => Promise<{
      state: GroupState;
      entityVersions: Record<string, number>;
    }>;
  };
  const remote = await groupService.getGroupRecoverySnapshot(groupId);
  const activeVersion = remote.entityVersions[`active_gathering:${groupId}`];
  const itineraryVersion = remote.entityVersions[`itinerary:${groupId}`];
  await sharedCoreDataStore.saveRemoteGroupState(remote.state, {
    entityVersion: activeVersion,
    gatheringVersion: activeVersion,
    itineraryVersion,
  });
  return sharedCoreDataStore.readSnapshot(groupId);
}

export function getCoreOperationOutbox(): CoreOperationOutbox {
  return outbox;
}

export function setCoreSessionGuard(guard: CoreActorGuard): void {
  coreSessionGuard = guard;
  outbox.setActorGuard(() => coreSessionGuard());
  setCoreSnapshotActorGuard(() => coreSessionGuard());
}

export { subscribeCoreOutboxChanges };

export async function flushCoreOperationOutbox(
  maxEntries?: number,
): Promise<Awaited<ReturnType<CoreOperationOutbox['flush']>>> {
  let result = await outbox.flush(maxEntries);
  // Each flush snapshots lane heads. Drain newly-unblocked descendants in a
  // bounded burst; a later foreground retry handles longer queues and backoff.
  for (let round = 0; round < 20 && result.remaining > 0 && !result.paused
    && (result.sent + result.duplicates + result.conflicts > 0); round += 1) {
    const next = await outbox.flush(maxEntries);
    result = { ...next, sent: result.sent + next.sent, duplicates: result.duplicates + next.duplicates,
      conflicts: result.conflicts + next.conflicts, retryScheduled: result.retryScheduled + next.retryScheduled };
    if (next.sent + next.duplicates + next.conflicts === 0) break;
  }
  return result;
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

function localSnapshotError(): Error {
  return Object.assign(new Error('core_snapshot_missing'), { code: 'core_snapshot_missing' });
}

function optimisticSnapshot(
  snapshot: Awaited<ReturnType<typeof sharedCoreDataStore.readSnapshot>>,
  destinations: Destination[],
  updatedAt = Date.now(),
  ownerActorId?: string,
) {
  if (!snapshot) throw localSnapshotError();
  return {
    ...snapshot,
    ...(ownerActorId ? { ownerActorId } : {}),
    destinations,
    itineraryVersion: (snapshot.itineraryVersion ?? 0) + 1,
    updatedAt,
    source: 'local_optimistic' as const,
  };
}

async function snapshotForDestination(destinationId: string, groupId?: string) {
  const snapshot = groupId
    ? await sharedCoreDataStore.readSnapshot(groupId)
    : await sharedCoreDb.findSnapshotGroupForDestination(destinationId).then(
      (id) => id ? sharedCoreDataStore.readSnapshot(id) : null,
    );
  if (!snapshot) throw localSnapshotError();
  return snapshot;
}

export async function enqueueDestinationAdd(input: {
  groupId: string;
  title: string;
  address?: string;
  latitude: number;
  longitude: number;
  day?: number | null;
  subgroupId?: string;
  kind?: 'stop' | 'accommodation';
  stayAnchor?: boolean;
  providerPlaceId?: string;
  actorId?: string;
}): Promise<{ operation: CoreOperation; destinationId: string }> {
  const snapshot = await sharedCoreDataStore.readSnapshot(input.groupId);
  if (!snapshot) throw localSnapshotError();
  const destinationId = Crypto.randomUUID();
  const destination: Destination = {
    id: destinationId,
    title: input.title,
    order: snapshot.destinations.length,
    day: input.day ?? null,
    address: input.address,
    coordinates: { latitude: input.latitude, longitude: input.longitude },
    subgroupId: input.subgroupId,
    kind: input.kind ?? 'stop',
    stayAnchor: input.stayAnchor ?? false,
    ...(input.providerPlaceId ? { providerPlaceId: input.providerPlaceId } : {}),
  };
  const operation = await outbox.enqueueMutation({
    groupId: input.groupId,
    entityType: 'itinerary',
    entityId: input.groupId,
    entityVersion: snapshot.itineraryVersion ?? 0,
    operationType: 'add_destination',
    actorId: input.actorId,
    payload: {
      destinationId,
      title: destination.title,
      address: destination.address ?? null,
      latitude: destination.coordinates.latitude,
      longitude: destination.coordinates.longitude,
      day: destination.day,
      subgroupId: destination.subgroupId ?? null,
      kind: destination.kind ?? 'stop',
      stayAnchor: destination.stayAnchor ?? false,
      providerPlaceId: destination.providerPlaceId ?? null,
    },
    applyLocal: async (exec, operation) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, input.groupId) ?? snapshot;
      await sharedCoreDb.writeSnapshot(
        exec,
        optimisticSnapshot(current, [
          ...current.destinations,
          { ...destination, order: current.destinations.length },
        ], Date.now(), operation.actorId),
      );
    },
  });
  kickCoreTransport();
  return { operation, destinationId };
}

export async function enqueueDestinationEdit(input: {
  groupId: string;
  destinationId: string;
  patch: Partial<Pick<Destination, 'title' | 'address' | 'day' | 'subgroupId' | 'kind' | 'stayAnchor' | 'providerPlaceId'>> & {
    latitude?: number;
    longitude?: number;
    emoji?: string | null;
    markerColor?: string | null;
  };
  actorId?: string;
}): Promise<CoreOperation> {
  const snapshot = await snapshotForDestination(input.destinationId, input.groupId);
  const original = snapshot.destinations.find(destination => destination.id === input.destinationId);
  if ((input.patch.latitude !== undefined && input.patch.latitude !== original?.coordinates.latitude)
    || (input.patch.longitude !== undefined && input.patch.longitude !== original?.coordinates.longitude)) {
    throw new Error('destination_coordinates_immutable');
  }
  // Older forms include unchanged coordinates. Do not send them as edits.
  const { latitude: _latitude, longitude: _longitude, ...editablePatch } = input.patch;
  const operation = await outbox.enqueueMutation({
    groupId: snapshot.groupId,
    entityType: 'itinerary',
    entityId: snapshot.groupId,
    entityVersion: snapshot.itineraryVersion ?? 0,
    operationType: 'edit_destination',
    actorId: input.actorId,
    payload: { destinationId: input.destinationId, subgroupId: original?.subgroupId ?? null, patch: editablePatch },
    applyLocal: async (exec, operation) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, snapshot.groupId) ?? snapshot;
      const destinations = current.destinations.map((destination) => {
        if (destination.id !== input.destinationId) return destination;
        const patch = editablePatch;
        return {
          ...destination,
          ...patch,
          coordinates: destination.coordinates,
        };
      });
      await sharedCoreDb.writeSnapshot(exec, optimisticSnapshot(current, destinations, Date.now(), operation.actorId));
    },
  });
  kickCoreTransport();
  return operation;
}

export async function enqueueDestinationDelete(input: {
  groupId: string;
  destinationId: string;
  actorId?: string;
}): Promise<CoreOperation> {
  const snapshot = await snapshotForDestination(input.destinationId, input.groupId);
  const operation = await outbox.enqueueMutation({
    groupId: snapshot.groupId,
    entityType: 'itinerary',
    entityId: snapshot.groupId,
    entityVersion: snapshot.itineraryVersion ?? 0,
    operationType: 'delete_destination',
    actorId: input.actorId,
    payload: { destinationId: input.destinationId,
      subgroupId: snapshot.destinations.find(d => d.id === input.destinationId)?.subgroupId ?? null },
    applyLocal: async (exec, operation) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, snapshot.groupId) ?? snapshot;
      const pointStatuses = { ...current.activeGathering.pointStatuses };
      delete pointStatuses[input.destinationId];
      await sharedCoreDb.writeSnapshot(exec, optimisticSnapshot(current, current.destinations.filter((d) => d.id !== input.destinationId), Date.now(), operation.actorId));
      await sharedCoreDb.writeActiveGathering(exec, {
        ...current.activeGathering,
        pointStatuses,
      }, Date.now(), { patchSnapshot: 'none' });
    },
  });
  kickCoreTransport();
  return operation;
}

export async function enqueueDestinationReorder(input: {
  groupId: string;
  updates: Array<{ id: string; position: number; day: number | null; meetAt?: string; stayAnchor?: boolean }>;
  actorId?: string;
}): Promise<CoreOperation | null> {
  if (!input.updates.length) return null;
  const snapshot = await sharedCoreDataStore.readSnapshot(input.groupId);
  if (!snapshot) throw localSnapshotError();
  const operation = await outbox.enqueueMutation({
    groupId: input.groupId,
    entityType: 'itinerary',
    entityId: input.groupId,
    entityVersion: snapshot.itineraryVersion ?? 0,
    operationType: 'reorder_destinations',
    actorId: input.actorId,
    payload: { updates: input.updates },
    applyLocal: async (exec, operation) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, input.groupId) ?? snapshot;
      const byId = new Map(input.updates.map((update) => [update.id, update]));
      const destinations = current.destinations
        .map((destination) => {
          const update = byId.get(destination.id);
          return update
            ? {
                ...destination,
                order: update.position,
                day: update.day,
                ...(update.meetAt === undefined ? {} : { meetAt: update.meetAt }),
                ...(update.stayAnchor === undefined ? {} : { stayAnchor: update.stayAnchor }),
              }
            : destination;
        })
        .sort((a, b) => a.order - b.order);
      await sharedCoreDb.writeSnapshot(exec, optimisticSnapshot(current, destinations, Date.now(), operation.actorId));
    },
  });
  kickCoreTransport();
  return operation;
}

export async function enqueueDestinationMeetTime(input: {
  destinationId: string;
  groupId?: string;
  meetAt: string | null;
  meetRedMinutes?: number | null;
  actorId?: string;
}): Promise<CoreOperation> {
  const snapshot = await snapshotForDestination(input.destinationId, input.groupId);
  const operation = await outbox.enqueueMutation({
    groupId: snapshot.groupId,
    entityType: 'itinerary',
    entityId: snapshot.groupId,
    entityVersion: snapshot.itineraryVersion ?? 0,
    operationType: 'set_destination_meet_time',
    actorId: input.actorId,
    payload: {
      destinationId: input.destinationId,
      meetAt: input.meetAt,
      subgroupId: snapshot.destinations.find(d => d.id === input.destinationId)?.subgroupId ?? null,
      meetRedMinutes: input.meetRedMinutes ?? null,
    },
    applyLocal: async (exec, operation) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, snapshot.groupId) ?? snapshot;
      const destinations = current.destinations.map((destination) =>
        destination.id === input.destinationId
          ? { ...destination, meetAt: input.meetAt ?? undefined, meetRedMinutes: input.meetRedMinutes ?? undefined }
          : destination,
      );
      await sharedCoreDb.writeSnapshot(exec, optimisticSnapshot(current, destinations, Date.now(), operation.actorId));
    },
  });
  kickCoreTransport();
  return operation;
}

export async function enqueueDestinationComplete(input: {
  groupId: string;
  destinationId: string;
  sessionId?: string | null;
  actorId?: string;
}): Promise<CoreOperation> {
  const snapshot = await snapshotForDestination(input.destinationId, input.groupId);
  const closedAt = new Date().toISOString();
  const operation = await outbox.enqueueMutation({
    groupId: snapshot.groupId,
    entityType: 'itinerary',
    entityId: snapshot.groupId,
    entityVersion: snapshot.itineraryVersion ?? 0,
    operationType: 'complete_destination',
    actorId: input.actorId,
    payload: { destinationId: input.destinationId, sessionId: input.sessionId ?? null,
      subgroupId: snapshot.destinations.find(d => d.id === input.destinationId)?.subgroupId ?? null },
    applyLocal: async (exec, operation) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, snapshot.groupId) ?? snapshot;
      const destinations = current.destinations.map((destination) =>
        destination.id === input.destinationId
          ? { ...destination, closedAt, closedBySessionId: input.sessionId ?? undefined }
          : destination,
      );
      const pointStatuses = { ...current.activeGathering.pointStatuses, [input.destinationId]: 'completed' as const };
      const activeGathering = { ...current.activeGathering, pointStatuses,
        ...(current.activeGathering.activeDestinationId === input.destinationId
          ? { journeyPhase: 'staying' as const, activeDestinationId: null, phaseChangedAt: Date.now() } : {}) };
      await sharedCoreDb.writeSnapshot(exec, optimisticSnapshot({ ...current, activeGathering,
        group: applyGatheringToGroup(current.group, activeGathering) }, destinations, Date.now(), operation.actorId));
      await sharedCoreDb.writeActiveGathering(exec, activeGathering, Date.now(), { patchSnapshot: 'none' });
    },
  });
  kickCoreTransport();
  return operation;
}

export async function enqueueGatherPointRequest(input: {
  groupId: string;
  subgroupId?: string;
  items: unknown[];
  requestId?: string;
  actorId?: string;
}): Promise<{ requestId: string; operation: CoreOperation }> {
  const requestId = input.requestId ?? Crypto.randomUUID();
  const operation = await outbox.enqueueMutation({
    groupId: input.groupId,
    entityType: 'itinerary',
    entityId: requestId,
    entityVersion: 0,
    operationType: 'submit_gather_point_request',
    actorId: input.actorId,
    payload: { requestId, subgroupId: input.subgroupId ?? null, items: input.items },
  });
  kickCoreTransport();
  return { requestId, operation };
}

export async function enqueueResolveGatherPointRequest(input: {
  groupId: string;
  requestId: string;
  approve: boolean;
  actorId?: string;
}): Promise<CoreOperation> {
  const operation = await outbox.enqueueMutation({
    groupId: input.groupId,
    entityType: 'itinerary',
    entityId: input.requestId,
    entityVersion: 0,
    operationType: 'resolve_gather_point_request',
    actorId: input.actorId,
    payload: { requestId: input.requestId, approve: input.approve },
  });
  kickCoreTransport();
  return operation;
}

export function projectPendingDestinations(state: GroupState, operations: CoreOperation[]): GroupState {
  return { ...state, destinations: projectOperationDestinations(state.destinations, operations) };
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
    actorId?: string;
    navigationRequestId?: string;
    navigationSessionId?: string | null;
    subgroupId?: string | null;
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
      actorId: options.actorId,
      navigationRequestId: options.navigationRequestId,
      navigationSessionId: options.navigationSessionId,
      subgroupId: options.subgroupId,
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
    actorId?: string;
    navigationRequestId?: string;
    navigationSessionId?: string | null;
    subgroupId?: string | null;
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
      actorId: options.actorId,
      navigationRequestId: options.navigationRequestId,
      navigationSessionId: options.navigationSessionId,
      subgroupId: options.subgroupId,
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
    actorId?: string;
    navigationSessionId?: string | null;
    subgroupId?: string | null;
    flushImmediately?: boolean;
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
    actorId: options.actorId,
    navigationSessionId: options.navigationSessionId,
    subgroupId: options.subgroupId,
  });
  if (options.flushImmediately !== false) void outbox.flush().catch(() => undefined);
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
    const itinerary = versions.find(
      (v) => v.entityType === 'itinerary' && v.entityId === groupId,
    );
    await sharedCoreDataStore.saveRemoteGroupState(state, {
      gatheringVersion: gathering?.entityVersion,
      entityVersion: gathering?.entityVersion,
      itineraryVersion: itinerary?.entityVersion,
    });
  } catch {
    await sharedCoreDataStore.saveRemoteGroupState(state);
  }
}
