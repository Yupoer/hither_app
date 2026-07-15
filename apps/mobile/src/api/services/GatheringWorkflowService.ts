import { supabase } from '../supabase';
import type {
  DestinationArrival,
  GatherPointRequest,
  GatherPointRequestItem,
} from '../../types';
import { orThrow } from './_helpers';

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
    day?: number;
  }[];
  status: GatherPointRequest['status'];
  created_at: string;
}

export async function submitGatherPointRequest(
  groupId: string,
  subgroupId: string | undefined,
  items: GatherPointRequestItem[],
): Promise<string> {
  const { data, error } = await supabase.rpc('submit_gather_point_request', {
    p_group_id: groupId,
    p_subgroup_id: subgroupId ?? null,
    p_items: items.map((item) => ({
      title: item.title,
      address: item.address,
      latitude: item.coordinates.latitude,
      longitude: item.coordinates.longitude,
      day: item.day ?? 1,
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

export async function resolveGatherPointRequest(
  requestId: string,
  approve: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('resolve_gather_point_request', {
    p_request_id: requestId,
    p_approve: approve,
  });
  orThrow(error);
}

export async function fetchDestinationArrivals(
  groupId: string,
): Promise<DestinationArrival[]> {
  const { data, error } = await supabase
    .from('destination_arrivals')
    .select('id, group_id, destination_id, user_id, arrived_at, source, marked_by')
    .eq('group_id', groupId);
  orThrow(error);
  return ((data ?? []) as {
    id: string;
    group_id: string;
    destination_id: string;
    user_id: string;
    arrived_at: string;
    source: DestinationArrival['source'];
    marked_by: string;
  }[]).map((row) => ({
    id: row.id,
    groupId: row.group_id,
    destinationId: row.destination_id,
    userId: row.user_id,
    arrivedAt: row.arrived_at,
    source: row.source,
    markedBy: row.marked_by,
  }));
}

export async function setDestinationArrival(
  destinationId: string,
  targetUserId: string,
  arrived: boolean,
): Promise<void> {
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
): Promise<void> {
  const { error } = await supabase.rpc('set_destination_arrival_at', {
    p_destination_id: destinationId,
    p_target_user_id: targetUserId,
    p_arrived: arrived,
    p_arrived_at: arrivedAt,
  });
  orThrow(error);
}
