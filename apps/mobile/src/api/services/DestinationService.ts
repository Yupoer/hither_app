/**
 * DestinationService — itinerary CRUD (add, delete, reorder, meet-time).
 */
import { supabase } from '../supabase';
import { demoAddDestination, demoAddDestinationsBatch, demoUpdateDestinationEmoji, isDemoGroup } from '../demo';
import type { Coordinates, Destination } from '../../types';
import {
  validateDestinationColor,
  validateDestinationEmoji,
} from '../../utils/destinationEmojiColor';
import { orThrow } from './_helpers';
import { KmlImportError, type NormalizedImportItem } from '../../utils/kmlBatch';

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
  emoji?: string | null;
  marker_color?: string | null;
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
    emoji: row.emoji ?? null,
    markerColor: row.marker_color ?? null,
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
  if (error) {
    // Free Plan itinerary cap (5 points) — server trigger is authoritative.
    if (
      (error as { code?: string }).code === 'P0004'
      || /itinerary_point_limit/i.test(error.message)
    ) {
      const err = new Error('itinerary_point_limit') as Error & { code?: string };
      err.code = 'itinerary_point_limit';
      throw err;
    }
    orThrow(error);
  }
}


/**
 * Atomic multi-stop insert for KML import. One RPC round-trip: positions are
 * computed server-side and either all rows land or none do. Does not call
 * UI-facing addDestination in a loop.
 */
export async function addDestinationsBatch(
  groupId: string,
  items: NormalizedImportItem[],
  options?: { day?: number; subgroupId?: string },
): Promise<void> {
  if (!items.length) return;
  const targetDay = Math.max(1, options?.day ?? 1);
  const subgroupId = options?.subgroupId;

  if (isDemoGroup(groupId)) {
    demoAddDestinationsBatch(
      items.map((item) => ({
        title: item.title,
        address: item.address,
        coordinates: { latitude: item.latitude, longitude: item.longitude },
        day: targetDay,
        subgroupId,
      })),
    );
    return;
  }

  const payload = items.map((item) => ({
    title: item.title,
    latitude: item.latitude,
    longitude: item.longitude,
    address: item.address ?? null,
  }));

  const { error } = await supabase.rpc('import_itinerary_batch', {
    p_group_id: groupId,
    p_subgroup_id: subgroupId ?? null,
    p_day: targetDay,
    p_items: payload,
  });

  if (!error) return;

  const code = (error as { code?: string }).code;
  const message = error.message ?? '';
  if (code === '42501' || /leader membership|authentication required|permission/i.test(message)) {
    throw new KmlImportError('permission', code ?? 'permission', message);
  }
  if (code === 'P0004' || /itinerary_point_limit/i.test(message)) {
    const err = new KmlImportError('persistence', 'itinerary_point_limit', message) as KmlImportError & {
      code?: string;
    };
    err.code = 'itinerary_point_limit';
    throw err;
  }
  if (code === '22023' || /invalid import/i.test(message)) {
    throw new KmlImportError('validation', code ?? 'invalid_batch', message);
  }
  throw new KmlImportError('persistence', code ?? 'persistence', message);
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

/**
 * Leader marks a gathering stop complete for the whole team:
 * cancel nav, set closed_at, notify non-arrived members.
 */
export async function completeGatheringStop(
  groupId: string,
  destinationId: string,
): Promise<void> {
  if (isDemoGroup(groupId)) {
    return;
  }
  const { error } = await supabase.rpc('complete_gathering_stop', {
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
 * Update per-stop emoji + palette color. Null clears to schema null (client fallback).
 * Trust boundary: only validated emoji grapheme + palette hex are written.
 * Flag color UI is day-scoped; callers typically send emoji only.
 */
export async function updateDestinationEmojiColor(
  groupId: string,
  destinationId: string,
  input: { emoji?: string | null; markerColor?: string | null },
): Promise<void> {
  if (isDemoGroup(groupId)) {
    if ('emoji' in input) {
      demoUpdateDestinationEmoji(destinationId, input.emoji ?? null, input.markerColor);
    }
    return;
  }

  const patch: { emoji?: string | null; marker_color?: string | null } = {};
  if ('emoji' in input) {
    if (input.emoji == null || input.emoji === '') {
      patch.emoji = null;
    } else {
      const v = validateDestinationEmoji(input.emoji);
      if (!v.ok) {
        const err = new Error(`invalid_destination_emoji:${v.reason}`) as Error & {
          code?: string;
        };
        err.code = 'invalid_destination_emoji';
        throw err;
      }
      patch.emoji = v.emoji;
    }
  }
  if ('markerColor' in input) {
    if (input.markerColor == null || input.markerColor === '') {
      patch.marker_color = null;
    } else {
      const v = validateDestinationColor(input.markerColor);
      if (!v.ok) {
        const err = new Error('invalid_destination_color') as Error & { code?: string };
        err.code = 'invalid_destination_color';
        throw err;
      }
      patch.marker_color = v.color;
    }
  }
  if (Object.keys(patch).length === 0) return;

  // .select() so a silent RLS miss (0 rows) surfaces instead of fake success.
  const { data, error } = await supabase
    .from('itinerary_items')
    .update(patch)
    .eq('id', destinationId)
    .eq('group_id', groupId)
    .select('id')
    .maybeSingle();
  orThrow(error);
  if (!data?.id) {
    const err = new Error('destination_emoji_update_empty') as Error & { code?: string };
    err.code = 'destination_emoji_update_empty';
    throw err;
  }
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
