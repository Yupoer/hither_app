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
  closed_at?: string | null;
  closed_by_session_id?: string | null;
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
    closedAt: row.closed_at ?? undefined,
    closedBySessionId: row.closed_by_session_id ?? undefined,
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
  const targetDay = Math.max(1, input.day ?? 1);
  let scopedQuery = supabase
    .from('itinerary_items')
    .select('id, position, day')
    .eq('group_id', groupId);
  scopedQuery = subgroupId
    ? scopedQuery.eq('subgroup_id', subgroupId)
    : scopedQuery.is('subgroup_id', null);
  const { data: rows, error: listError } = await scopedQuery.order('position', {
    ascending: true,
  });
  orThrow(listError);

  const existing = ((rows ?? []) as { id: string; position: number; day: number }[]).map(
    (row) => ({
      id: row.id,
      order: row.position,
      day: row.day ?? 1,
    }),
  );

  // Inline append plan (keep service free of utils import cycles in tests).
  const sameDay = existing.filter((d) => d.day === targetDay);
  let insertPosition: number;
  if (sameDay.length > 0) {
    insertPosition = Math.max(...sameDay.map((d) => d.order)) + 1;
  } else {
    const earlier = existing.filter((d) => d.day < targetDay);
    insertPosition =
      earlier.length > 0 ? Math.max(...earlier.map((d) => d.order)) + 1 : 0;
  }

  // Shift later rows high→low so positions never collide mid-update.
  const toShift = existing
    .filter((d) => d.order >= insertPosition)
    .sort((a, b) => b.order - a.order);
  for (const row of toShift) {
    const { error: shiftError } = await supabase
      .from('itinerary_items')
      .update({ position: row.order + 1 })
      .eq('id', row.id)
      .eq('group_id', groupId);
    orThrow(shiftError);
  }

  const { error } = await supabase.from('itinerary_items').insert({
    group_id: groupId,
    subgroup_id: subgroupId ?? null,
    title: input.title,
    address: input.address ?? null,
    day: targetDay,
    latitude: input.coordinates.latitude,
    longitude: input.coordinates.longitude,
    position: insertPosition,
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
  // RPC cancels any active navigation_session for this stop, then deletes.
  // FK is ON DELETE SET NULL so historical sessions no longer block delete.
  const { error } = await supabase.rpc('delete_destination', {
    p_group_id: groupId,
    p_destination_id: destinationId,
  });
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
