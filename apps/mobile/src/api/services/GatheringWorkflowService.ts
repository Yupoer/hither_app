import { supabase } from '../supabase';
import type {
  DestinationArrival,
  GatherPointRequest,
  GatherPointRequestItem,
} from '../../types';
import type { CoreOperation } from '../../types/coreData';
import { isNetworkRequestError, orThrow, sleep, requireUserId, requireLocalActorId } from './_helpers';

type CoreSyncAdapters = typeof import('../../state/coreDataSync');

function loadCoreSyncAdapters(): CoreSyncAdapters | null {
  try {
    return require('../../state/coreDataSync') as CoreSyncAdapters;
  } catch {
    return null;
  }
}

/** Keep the narrow legacy/test seam while making the current adapter hydrate
 * cold groups before any durable queue write. Hydration errors remain visible.
 */
async function tryDurableCoreWrite<T>(
  core: CoreSyncAdapters,
  groupId: string,
  write: () => Promise<T>,
): Promise<{ handled: true; value: T } | { handled: false }> {
  const ensure = (core as unknown as {
    ensureCoreSnapshot?: (id: string) => Promise<unknown>;
  }).ensureCoreSnapshot;
  if (typeof ensure === 'function') {
    const snapshot = await ensure(groupId);
    if (!snapshot) {
      throw Object.assign(new Error('core_snapshot_missing'), { code: 'core_snapshot_missing' });
    }
    return { handled: true, value: await write() };
  }
  try {
    return { handled: true, value: await write() };
  } catch (error) {
    if ((error as { code?: string })?.code === 'core_snapshot_missing') {
      return { handled: false };
    }
    throw error;
  }
}

async function requireQueueActor(): Promise<string> {
  try {
    return await requireLocalActorId();
  } catch (error) {
    // Older/test Supabase seams expose only auth.getSession. Production auth
    // supplies the stronger persisted actor id; this fallback preserves caller
    // compatibility without weakening the server auth check.
    if ((error as { code?: string })?.code === 'local_auth_actor_missing'
      || error instanceof TypeError) {
      return requireUserId();
    }
    throw error;
  }
}

async function arrivalMetadata(occurredAt?: string | null): Promise<{
  occurredAt: string;
  deviceId?: string;
}> {
  let deviceId: string | undefined;
  try {
    const service = require('./LiveActivityService') as {
      getOrCreateLiveActivityDeviceId: () => Promise<string>;
    };
    deviceId = await service.getOrCreateLiveActivityDeviceId();
  } catch {
    // Keep the mutation durable when SecureStore is temporarily unavailable;
    // deviceId is diagnostic metadata, not the arrival's identity.
  }
  return {
    occurredAt: occurredAt ?? new Date().toISOString(),
    ...(deviceId ? { deviceId } : {}),
  };
}

interface RequestRow {
  id: string;
  group_id: string;
  subgroup_id: string | null;
  requester_id: string;
  items: {
    title: string;
    address?: string;
    latitude: number;
    longitude: number;
    day?: number | null;
  }[];
  status: GatherPointRequest['status'];
  created_at: string;
}

export interface ResolveGatherPointResult {
  status: 'approved' | 'rejected';
  insertedCount: number;
}

export async function submitGatherPointRequest(
  groupId: string,
  subgroupId: string | undefined,
  items: GatherPointRequestItem[],
): Promise<string> {
  const core = loadCoreSyncAdapters();
  if (core) {
    const durable = await tryDurableCoreWrite(core, groupId, () => core.enqueueGatherPointRequest({
      groupId,
      subgroupId,
      items: items.map((item) => ({
        title: item.title,
        address: item.address,
        latitude: item.coordinates.latitude,
        longitude: item.coordinates.longitude,
        day: null,
      })),
    }));
    if (durable.handled) return durable.value.requestId;
  }
  const { data, error } = await supabase.rpc('submit_gather_point_request', {
    p_group_id: groupId,
    p_subgroup_id: subgroupId ?? null,
    p_items: items.map((item) => ({
      title: item.title,
      address: item.address,
      latitude: item.coordinates.latitude,
      longitude: item.coordinates.longitude,
      day: null,
    })),
  });
  orThrow(error);
  return data as string;
}

export async function fetchPendingGatherPointRequests(
  groupId: string,
): Promise<GatherPointRequest[]> {
  const { data, error } = await supabase
    .from('gather_point_requests')
    .select('id, group_id, subgroup_id, requester_id, items, status, created_at')
    .eq('group_id', groupId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  orThrow(error);
  return ((data ?? []) as RequestRow[]).map((row) => ({
    id: row.id,
    groupId: row.group_id,
    subgroupId: row.subgroup_id ?? undefined,
    requesterId: row.requester_id,
    status: row.status,
    createdAt: row.created_at,
    items: row.items.map((item) => ({
      title: item.title,
      address: item.address,
      day: item.day,
      coordinates: { latitude: item.latitude, longitude: item.longitude },
    })),
  }));
}

function mapResolveResult(
  data: unknown,
  approve: boolean,
): ResolveGatherPointResult {
  if (data && typeof data === 'object') {
    const row = data as { status?: string; inserted_count?: number };
    return {
      status: row.status === 'rejected' ? 'rejected' : 'approved',
      insertedCount:
        typeof row.inserted_count === 'number' ? row.inserted_count : 0,
    };
  }
  return {
    status: approve ? 'approved' : 'rejected',
    insertedCount: 0,
  };
}

export async function resolveGatherPointRequest(
  requestId: string,
  approve: boolean,
  options?: { groupId?: string },
): Promise<ResolveGatherPointResult> {
  const core = loadCoreSyncAdapters();
  if (core && options?.groupId) {
    const groupId = options.groupId;
    const durable = await tryDurableCoreWrite(core, groupId, () =>
      core.enqueueResolveGatherPointRequest({
      groupId,
      requestId,
      approve,
      }));
    if (durable.handled) return { status: approve ? 'approved' : 'rejected', insertedCount: 0 };
  }
  const { data, error } = await supabase.rpc('resolve_gather_point_request', {
    p_request_id: requestId,
    p_approve: approve,
  });
  orThrow(error);
  return mapResolveResult(data, approve);
}

/**
 * Resolve with one network retry and false-failure recovery: if the request is
 * no longer pending after a flaky response, treat the action as succeeded.
 */
export async function resolveGatherPointRequestResilient(
  requestId: string,
  approve: boolean,
  options?: { groupId?: string },
): Promise<ResolveGatherPointResult> {
  const recover = async (): Promise<ResolveGatherPointResult | null> => {
    const groupId = options?.groupId;
    if (!groupId) return null;
    try {
      const pending = await fetchPendingGatherPointRequests(groupId);
      if (!pending.some((row) => row.id === requestId)) {
        return {
          status: approve ? 'approved' : 'rejected',
          insertedCount: 0,
        };
      }
    } catch {
      return null;
    }
    return null;
  };

  try {
    return await resolveGatherPointRequest(requestId, approve, options);
  } catch (first) {
    // Server already applied the change but client only saw a transport blip.
    const recoveredEarly = await recover();
    if (recoveredEarly) return recoveredEarly;

    if (!isNetworkRequestError(first)) throw first;

    await sleep(500);
    try {
      return await resolveGatherPointRequest(requestId, approve, options);
    } catch (second) {
      const recovered = await recover();
      if (recovered) return recovered;
      throw second;
    }
  }
}

export async function fetchDestinationArrivals(
  groupId: string,
): Promise<DestinationArrival[]> {
  const { data, error } = await supabase
    .from('destination_arrivals')
    .select('id, group_id, destination_id, user_id, arrived_at, source, marked_by, navigation_session_id')
    .eq('group_id', groupId);
  orThrow(error);
  return ((data ?? []) as {
    id: string;
    group_id: string;
    destination_id: string;
    user_id: string;
    arrived_at: string | null;
    source: DestinationArrival['source'];
    marked_by: string;
    navigation_session_id?: string | null;
  }[]).map((row) => ({
    id: row.id,
    groupId: row.group_id,
    destinationId: row.destination_id,
    userId: row.user_id,
    arrivedAt: row.arrived_at,
    source: row.source,
    markedBy: row.marked_by,
    ...(typeof row.navigation_session_id === 'string'
      ? { navigationSessionId: row.navigation_session_id }
      : {}),
  }));
}

export async function setDestinationArrival(
  destinationId: string,
  targetUserId: string,
  arrived: boolean,
  navigationSessionId?: string | null,
): Promise<CoreOperation | void> {
  const actorId = await requireQueueActor();
  const core = loadCoreSyncAdapters();
  const groupId = core
    ? await core.getCoreDataStore().database.findSnapshotGroupForDestination(destinationId)
    : null;
  if (core && groupId) {
    // The caller already resolved the destination/scope session.  A cached
    // group snapshot can still describe the main-team lane while this action
    // belongs to a subgroup, so do not discard an explicit session merely
    // because that snapshot's active destination differs.
    const boundSessionId = navigationSessionId ?? null;
    const metadata = await arrivalMetadata();
    const operation = await core.getCoreOperationOutbox().enqueueArrival(groupId, destinationId, {
      actorId,
      userId: targetUserId,
      arrived,
      completeSolo: false,
      arrivedAt: new Date().toISOString(),
      navigationSessionId: boundSessionId,
      ...metadata,
    });
    void core.getCoreOperationOutbox().flush().catch(() => undefined);
    return operation;
  }
  const { error } = await supabase.rpc('set_destination_arrival', {
    p_destination_id: destinationId,
    p_target_user_id: targetUserId,
    p_arrived: arrived,
  });
  orThrow(error);
}

/** Manually mark an arrival with an explicit timestamp policy. Passing null
 * delegates timestamp creation to Postgres (`now()`), which is the automatic
 * server-time option. */
export async function setDestinationArrivalAt(
  destinationId: string,
  targetUserId: string,
  arrived: boolean,
  arrivedAt: string | null,
  navigationSessionId?: string | null,
): Promise<CoreOperation | void> {
  const actorId = await requireQueueActor();
  const core = loadCoreSyncAdapters();
  const groupId = core
    ? await core.getCoreDataStore().database.findSnapshotGroupForDestination(destinationId)
    : null;
  if (core && groupId) {
    const boundSessionId = navigationSessionId ?? null;
    const metadata = await arrivalMetadata(arrivedAt);
    const operation = await core.getCoreOperationOutbox().enqueueArrival(groupId, destinationId, {
      actorId,
      userId: targetUserId,
      arrived,
      completeSolo: false,
      arrivedAt,
      navigationSessionId: boundSessionId,
      ...metadata,
    });
    void core.getCoreOperationOutbox().flush().catch(() => undefined);
    return operation;
  }
  const { error } = await supabase.rpc('set_destination_arrival_at', {
    p_destination_id: destinationId,
    p_target_user_id: targetUserId,
    p_arrived: arrived,
    p_arrived_at: arrivedAt,
  });
  orThrow(error);
}

/**
 * Queue an audited leader correction for a completed main-team session.
 *
 * This is intentionally a distinct core operation from a member's arrival:
 * the server records `arrivedAt = null` and retains the correction actor in
 * the history event. The legacy RPC fallback is kept only for environments
 * that do not have the durable adapter loaded yet.
 */
export async function correctDestinationArrival(input: {
  destinationId: string;
  targetUserId: string;
  arrived: boolean;
  sessionId: string;
  note?: string | null;
}): Promise<CoreOperation | void> {
  const actorId = await requireQueueActor();
  const core = loadCoreSyncAdapters();
  const groupId = core
    ? await core.getCoreDataStore().database.findSnapshotGroupForDestination(input.destinationId)
    : null;
  if (core && groupId) {
    const snapshot = await core.getCoreDataStore().readSnapshot(groupId);
    const metadata = await arrivalMetadata();
    const operation = await core.getCoreOperationOutbox().enqueueMutation({
      groupId,
      entityType: 'itinerary',
      entityId: input.destinationId,
      entityVersion: snapshot?.itineraryVersion ?? 0,
      operationType: 'leader_correct_arrival',
      actorId,
      payload: {
        actorId,
        targetUserId: input.targetUserId,
        userId: input.targetUserId,
        arrived: input.arrived,
        arrivedAt: null,
        source: 'leader_correction',
        sessionId: input.sessionId,
        navigationSessionId: input.sessionId,
        ...metadata,
        ...(input.note == null ? {} : { note: input.note }),
      },
    });
    void core.getCoreOperationOutbox().flush().catch(() => undefined);
    return operation;
  }
  const { error } = await supabase.rpc('set_destination_arrival_at', {
    p_destination_id: input.destinationId,
    p_target_user_id: input.targetUserId,
    p_arrived: input.arrived,
    p_arrived_at: null,
  });
  orThrow(error);
}
