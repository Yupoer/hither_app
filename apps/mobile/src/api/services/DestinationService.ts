/**
 * DestinationService — itinerary CRUD (add, delete, reorder, meet-time).
 */
import { supabase } from '../supabase';
import { demoAddDestination, isDemoGroup } from '../demo';
import type { Coordinates, Destination } from '../../types';
import { orThrow } from './_helpers';

// ── Row shape ──────────────────────────────────────────────────────────────

export interface ItineraryRow {
  id: string;
  title: string;
  position: number;
  day: number;
  address: string | null;
  latitude: number;
  longitude: number;
  meet_at?: string | null;
  meet_red_minutes?: number | null;
  subgroup_id?: string | null;
}

// ── Mapper ─────────────────────────────────────────────────────────────────

export function mapDestination(row: ItineraryRow): Destination {
  return {
    id: row.id,
    title: row.title,
    order: row.position,
    day: row.day ?? 1,
    address: row.address ?? undefined,
    coordinates: {
      latitude: row.latitude ?? 0,
      longitude: row.longitude ?? 0,
    },
    meetAt: row.meet_at ?? undefined,
    meetRedMinutes:
      typeof row.meet_red_minutes === 'number' ? row.meet_red_minutes : undefined,
    subgroupId: row.subgroup_id ?? undefined,
  };
}

// ── API functions ──────────────────────────────────────────────────────────

export async function addDestination(
  groupId: string,
  input: { title: string; address?: string; coordinates: Coordinates; day?: number },
  subgroupId?: string,
): Promise<void> {
  if (isDemoGroup(groupId)) {
    demoAddDestination({ ...input, subgroupId });
    return;
  }
  let scopedQuery = supabase
    .from('itinerary_items')
    .select('position')
    .eq('group_id', groupId);
  scopedQuery = subgroupId
    ? scopedQuery.eq('subgroup_id', subgroupId)
    : scopedQuery.is('subgroup_id', null);
  const { data: maxRow, error: maxError } = await scopedQuery
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  orThrow(maxError);

  const maxPosition = maxRow?.position ?? -1;
  const { error } = await supabase.from('itinerary_items').insert({
    group_id: groupId,
    subgroup_id: subgroupId ?? null,
    title: input.title,
    address: input.address ?? null,
    day: input.day ?? 1,
    latitude: input.coordinates.latitude,
    longitude: input.coordinates.longitude,
    position: maxPosition + 1,
  });
  orThrow(error);
}

export async function deleteDestination(
  groupId: string,
  destinationId: string,
): Promise<void> {
  if (isDemoGroup(groupId)) {
    return;
  }
  const { error } = await supabase
    .from('itinerary_items')
    .delete()
    .eq('id', destinationId)
    .eq('group_id', groupId);
  orThrow(error);
}

export async function reorderDestinations(
  groupId: string,
  updates: { id: string; position: number; day: number; meetAt?: string }[],
): Promise<void> {
  if (isDemoGroup(groupId)) {
    return;
  }
  const results = await Promise.all(
    updates.map((up) => {
      const patch: { position: number; day: number; meet_at?: string } = {
        position: up.position,
        day: up.day,
      };
      if (up.meetAt !== undefined) patch.meet_at = up.meetAt;
      return supabase
        .from('itinerary_items')
        .update(patch)
        .eq('id', up.id)
        .eq('group_id', groupId);
    }),
  );
  orThrow(results.find((r) => r.error)?.error ?? null);
}

/**
 * Set or clear the gathering-point meet clock. When setting, also persists the
 * red-countdown threshold (minutes) so all members share the same warning window
 * and server-side APNs can fire at that boundary.
 */
export async function setDestinationMeetTime(
  destinationId: string,
  meetAt: string | null,
  meetRedMinutes?: number | null,
): Promise<void> {
  const patch: {
    meet_at: string | null;
    meet_red_minutes?: number;
  } = { meet_at: meetAt };
  if (meetAt != null && typeof meetRedMinutes === 'number') {
    patch.meet_red_minutes = meetRedMinutes;
  }
  const { error } = await supabase
    .from('itinerary_items')
    .update(patch)
    .eq('id', destinationId);
  orThrow(error);
}
