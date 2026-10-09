import { getVisibleGroupSeed } from './visibleGroupSeed';
import { insertFirstStop } from '../utils/firstStopInsertion';
import { normalizeTripDepartureDate } from '../utils/tripDay';
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
import type { DailyAccommodation, Destination, GroupState } from '../types';
import * as Crypto from 'expo-crypto';
import { projectOperationGroupState } from './coreOperationProjection';
import {
  applyGatheringToDestinations,
  applyGatheringToGroup,
  deriveActiveGatheringFromGroupState,
} from '../utils/activeGatheringState';
import {
  getCoreActiveGathering,
  coreSnapshotFromGroupState,
  runCoreDataWriteLock,
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
setPendingItineraryGuard((groupId) => outbox.getPendingItineraryOperations(groupId));

export function getCoreDataStore(): CoreDataStore {
  return sharedCoreDataStore;
}

/**
 * Service mutations may seed a cold local snapshot from this actor's visible
 * state. No network read belongs in this write prerequisite. Missing local
 * context fails explicitly rather than silently using an online-only write.
 */
export async function ensureCoreSnapshot(groupId: string) {
  const existing = await sharedCoreDataStore.readSnapshot(groupId);
  if (existing) return existing;
  const actorId = await requireLocalActorId();
  const visible = getVisibleGroupSeed(actorId, groupId);
  if (!visible) throw localSnapshotError();
  // No network in a write prerequisite. Seed only this actor's displayed state;
  // version reconciliation belongs to the background operation processor.
  await runCoreDataWriteLock(async () => {
    if (await requireLocalActorId() !== actorId) throw localSnapshotError();
    await sharedCoreDb.withExclusiveTransaction(async exec => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, groupId);
      if (current && (!current.ownerActorId || current.ownerActorId === actorId)) return;
      const seed = coreSnapshotFromGroupState(visible, { source: 'local_cache', syncedAt: 0 });
      await sharedCoreDb.writeSnapshot(exec, { ...seed, ownerActorId: actorId });
      await sharedCoreDb.writeActiveGathering(exec, seed.activeGathering, Date.now(), { patchSnapshot: 'none' });
    });
  });

  return sharedCoreDataStore.readSnapshot(groupId);
}

/** Read the actor-fenced durable target and its server-proven merge identity. */
export async function readLocalJourneyProjection(groupId: string, destinationId: string): Promise<{
  gathering: ActiveGatheringState; canonicalDestinationId: string; destination: Destination | null;
} | null> {
  const actorId = await requireLocalActorId();
  const snapshot = await sharedCoreDataStore.readSnapshot(groupId);
  if (!snapshot) return null;
  const seen = new Set<string>();
  let canonicalDestinationId = destinationId;
  while (!seen.has(canonicalDestinationId)) {
    seen.add(canonicalDestinationId);
    const alias = await sharedCoreDb.getDestinationAlias?.(groupId, canonicalDestinationId);
    if (!alias) break;
    canonicalDestinationId = alias;
  }
  if (await requireLocalActorId() !== actorId) return null;
  return { gathering: snapshot.activeGathering, canonicalDestinationId,
    destination: snapshot.destinations.find(d => d.id === canonicalDestinationId && !d.closedAt) ?? null };
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
  placement?: 'firstStop';
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
      ...(input.placement ? { placement: input.placement } : {}),
    },
    applyLocal: async (exec, operation) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, input.groupId) ?? snapshot;
      await sharedCoreDb.writeSnapshot(
        exec,
        optimisticSnapshot(current, input.placement === 'firstStop' ? insertFirstStop(current.destinations, destination) : [
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
  sessionId?: string | null;
}): Promise<CoreOperation> {
  const snapshot = await snapshotForDestination(input.destinationId, input.groupId);
  const operation = await outbox.enqueueMutation({
    groupId: snapshot.groupId,
    entityType: 'itinerary',
    entityId: snapshot.groupId,
    entityVersion: snapshot.itineraryVersion ?? 0,
    operationType: 'delete_destination',
    actorId: input.actorId,
    payload: { destinationId: input.destinationId, sessionId: input.sessionId ?? null,
      subgroupId: snapshot.destinations.find(d => d.id === input.destinationId)?.subgroupId ?? null },
    applyLocal: async (exec, operation) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, snapshot.groupId) ?? snapshot;
      const pointStatuses = { ...current.activeGathering.pointStatuses };
      delete pointStatuses[input.destinationId];
      const activeGathering = { ...current.activeGathering, pointStatuses,
        ...(current.activeGathering.activeDestinationId === input.destinationId
          ? { journeyPhase: 'staying' as const, activeDestinationId: null, phaseChangedAt: Date.now() } : {}) };
      await sharedCoreDb.writeSnapshot(exec, optimisticSnapshot({ ...current, activeGathering,
        group: applyGatheringToGroup(current.group, activeGathering) }, current.destinations.filter((d) => d.id !== input.destinationId), Date.now(), operation.actorId));
      await sharedCoreDb.writeActiveGathering(exec, activeGathering, Date.now(), { patchSnapshot: 'none' });
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
  subgroupId?: string | null;
  isCurrent?: () => boolean;
  reason?: 'all_arrived' | 'forced';
}): Promise<CoreOperation | null> {
  const snapshot = await snapshotForDestination(input.destinationId, input.groupId);
  if (input.isCurrent?.() === false || snapshot.destinations.find(d => d.id === input.destinationId)?.closedAt) return null;
  const closedAt = new Date().toISOString();
  const operation = await outbox.enqueueMutation({
    groupId: snapshot.groupId,
    entityType: 'itinerary',
    entityId: snapshot.groupId,
    entityVersion: snapshot.itineraryVersion ?? 0,
    operationType: 'complete_destination',
    actorId: input.actorId,
    payload: { destinationId: input.destinationId, sessionId: input.sessionId ?? null, reason: input.reason ?? 'forced',
      subgroupId: input.subgroupId !== undefined ? input.subgroupId : snapshot.destinations.find(d => d.id === input.destinationId)?.subgroupId ?? null },
    applyLocal: async (exec, operation) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, snapshot.groupId) ?? snapshot;
      if (input.isCurrent?.() === false) throw new Error('completion_context_changed');
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

/** Persist the personal status and intent in one transaction, including offline. */
export async function enqueueSolo(input: {
  groupId: string; solo: boolean; actorId?: string;
}): Promise<CoreOperation> {
  const actorId = input.actorId ?? await requireLocalActorId();
  const snapshot = await ensureCoreSnapshot(input.groupId);
  if (!snapshot) throw localSnapshotError();
  const member = snapshot.members?.find(value => value.userId === actorId);
  if (!member) throw Object.assign(new Error('group_membership_required'), { code: '42501' });
  const operation = await outbox.enqueueMutation({
    groupId: input.groupId, entityType: 'itinerary', entityId: actorId,
    entityVersion: 0, operationType: 'set_solo', actorId,
    payload: { userId: actorId, solo: input.solo, _localBeforeSolo: !!member.solo },
    applyLocal: async (exec, op) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, input.groupId) ?? snapshot;
      op.payload._localBeforeSolo = !!current.members?.find(value => value.userId === actorId)?.solo;
      await sharedCoreDb.writeSnapshot(exec, { ...current,
        members: (current.members ?? []).map(value => value.userId === actorId ? { ...value, solo: input.solo } : value),
        ownerActorId: op.actorId, updatedAt: Date.now(), source: 'local_optimistic',
      });
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
  return projectOperationGroupState(state, operations);
}

export async function enqueueTripDetails(input: {
  groupId: string; tripDays: number; departureDate: string; actorId?: string;
}): Promise<CoreOperation> {
  const departureDate = normalizeTripDepartureDate(input.departureDate);
  if (!Number.isInteger(input.tripDays) || input.tripDays < 1 || !departureDate) throw new Error('invalid_trip_details');
  const snapshot = await ensureCoreSnapshot(input.groupId);
  if (!snapshot) throw localSnapshotError();
  const operation = await outbox.enqueueMutation({
    groupId: input.groupId, entityType: 'itinerary', entityId: input.groupId,
    entityVersion: snapshot.itineraryVersion ?? 0, operationType: 'set_trip_details', actorId: input.actorId,
    payload: { tripDays: input.tripDays, departureDate },
    applyLocal: async (exec, op) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, input.groupId) ?? snapshot;
      await sharedCoreDb.writeSnapshot(exec, optimisticSnapshot({ ...current,
        group: { ...current.group, tripDays: input.tripDays, departureDate } }, current.destinations, Date.now(), op.actorId));
    },
  });
  kickCoreTransport();
  return operation;
}

function validStayDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

export async function enqueueDailyAccommodation(input: {
  groupId: string; stayDate: string; daily?: DailyAccommodation; day?: number; actorId?: string;
}): Promise<CoreOperation> {
  if (!validStayDate(input.stayDate) || (input.day !== undefined && (!Number.isInteger(input.day) || input.day < 1))) throw new Error('invalid_daily_accommodation');
  if (input.daily && (!input.daily.title.trim() || !Number.isFinite(input.daily.coordinates.latitude)
    || Math.abs(input.daily.coordinates.latitude) > 90 || !Number.isFinite(input.daily.coordinates.longitude)
    || Math.abs(input.daily.coordinates.longitude) > 180)) throw new Error('invalid_daily_accommodation');
  const snapshot = await ensureCoreSnapshot(input.groupId);
  if (!snapshot) throw localSnapshotError();
  const operation = await outbox.enqueueMutation({
    groupId: input.groupId, entityType: 'itinerary', entityId: input.groupId,
    entityVersion: snapshot.itineraryVersion ?? 0, actorId: input.actorId,
    operationType: input.daily ? 'set_daily_accommodation' : 'clear_daily_accommodation',
    payload: { stayDate: input.stayDate, daily: input.daily ?? null, day: input.day ?? null },
    applyLocal: async (exec, op) => {
      const current = await sharedCoreDb.readSnapshotInTransaction(exec, input.groupId) ?? snapshot;
      const projected = projectOperationGroupState({ group: current.group, destinations: current.destinations,
        dailyAccommodations: current.dailyAccommodations, members: [], subgroups: [] }, [op], [current.activeGathering.activeDestinationId]);
      await sharedCoreDb.writeSnapshot(exec, optimisticSnapshot({ ...current, group: projected.group,
        dailyAccommodations: projected.dailyAccommodations }, projected.destinations, Date.now(), op.actorId));
    },
  });
  kickCoreTransport();
  return operation;
}

async function resolveLocalGatheringBase(groupId: string, options: {
  baseState?: ActiveGatheringState; groupState?: GroupState | null;
}): Promise<ActiveGatheringState | null> {
  // React closures may outlive a committed End/ACK. Prefer the actor-fenced
  // durable version before making the next command's local transition.
  const durable = await getCoreActiveGathering(groupId);
  if (durable && (!options.baseState || durable.entityVersion >= options.baseState.entityVersion)) return durable;
  return options.baseState ?? (options.groupState ? deriveActiveGatheringFromGroupState(options.groupState, 0) : null);
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
    /** Persist same-day promotion atomically, after Start in the FIFO. */
    promoteWithinDay?: boolean;
    /** Default true. Journey start sets false until session outcome is known. */
    flushImmediately?: boolean;
  } = {},
): Promise<{
  local: ActiveGatheringState;
  base: ActiveGatheringState;
  operationId: string;
}> {
  const base = await resolveLocalGatheringBase(groupId, options);
  if (!base) {
    throw new Error('no local gathering base for start');
  }
  const { local, operation, base: appliedBase } =
    await outbox.enqueueGatheringTransition({
      operationId: options.operationId,
      groupId,
      action: 'start',
      promoteWithinDay: options.promoteWithinDay,
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
    promoteWithinDay?: boolean;
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
  const base = await resolveLocalGatheringBase(groupId, options);
  if (!base) throw new Error('no local gathering base for switch');
  const { local, operation, base: appliedBase } =
    await outbox.enqueueGatheringTransition({
      operationId: options.operationId,
      groupId,
      action: 'switch',
      promoteWithinDay: options.promoteWithinDay,
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
    expectedSessionStartedAt?: string | null;
    subgroupId?: string | null;
    flushImmediately?: boolean;
  } = {},
): Promise<{ local: ActiveGatheringState }> {
  const base = await resolveLocalGatheringBase(groupId, options);
  if (!base) {
    return enqueueLeaderGatheringEnd(groupId, { ...options, baseState: {
      groupId, journeyPhase: 'staying', activeDestinationId: null, pointStatuses: {},
      phaseChangedAt: Date.now(), entityVersion: 0,
    } });
  }
  const { local } = await outbox.enqueueGatheringTransition({
    operationId: options.operationId,
    groupId,
    action: 'end',
    baseState: base,
    nextDestinationId: options.nextDestinationId,
    actorId: options.actorId,
    navigationSessionId: options.navigationSessionId,
    expectedSessionStartedAt: options.expectedSessionStartedAt,
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
  coherentVersions?: Record<string, number>,
): Promise<void> {
  if (coherentVersions) {
    await sharedCoreDataStore.saveRemoteGroupState(state, {
      gatheringVersion: coherentVersions[`active_gathering:${groupId}`],
      entityVersion: coherentVersions[`active_gathering:${groupId}`],
      itineraryVersion: coherentVersions[`itinerary:${groupId}`],
    });
    return;
  }
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
