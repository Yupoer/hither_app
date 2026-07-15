/**
 * WaypointService — visited waypoint history (record + fetch).
 * BUG-17: history is team-scoped via group_id (user_id still records who arrived).
 */
import { supabase } from '../supabase';
import { isDemoGroup } from '../demo';
import type { Coordinates, VisitedWaypoint } from '../../types';
import { orThrow } from './_helpers';

export async function recordVisitedWaypoint(
  groupId: string,
  name: string,
  coordinates: Coordinates,
): Promise<void> {
  if (isDemoGroup(groupId)) return;
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return;
  const { error } = await supabase.from('visited_waypoints').insert({
    user_id: userId,
    group_id: groupId,
    name,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  });
  orThrow(error);
}

export async function fetchVisitedWaypoints(groupId?: string): Promise<VisitedWaypoint[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];

  let query = supabase
    .from('visited_waypoints')
    .select('id, user_id, destination_id, name, latitude, longitude, arrived_at, group_id')
    .order('arrived_at', { ascending: false });

  if (groupId) {
    query = query.eq('group_id', groupId);
  } else {
    // Fallback: personal history when no team context.
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;
  orThrow(error);
  return ((data ?? []) as {
    id: string;
    user_id: string;
    destination_id: string | null;
    name: string;
    latitude: number;
    longitude: number;
    arrived_at: string;
  }[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    destinationId: row.destination_id ?? undefined,
    name: row.name,
    coordinates: { latitude: row.latitude, longitude: row.longitude },
    arrivedAt: row.arrived_at,
  }));
}

export async function deleteVisitedWaypoint(id: string): Promise<void> {
  const { error } = await supabase.from('visited_waypoints').delete().eq('id', id);
  orThrow(error);
}
