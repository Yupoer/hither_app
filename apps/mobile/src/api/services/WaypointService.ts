/**
 * WaypointService — visited waypoint history (record + fetch).
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
    name,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  });
  orThrow(error);
}

export async function fetchVisitedWaypoints(): Promise<VisitedWaypoint[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from('visited_waypoints')
    .select('id, name, latitude, longitude, arrived_at')
    .eq('user_id', userId)
    .order('arrived_at', { ascending: false });
  orThrow(error);
  return ((data ?? []) as {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    arrived_at: string;
  }[]).map((row) => ({
    id: row.id,
    name: row.name,
    coordinates: { latitude: row.latitude, longitude: row.longitude },
    arrivedAt: row.arrived_at,
  }));
}
