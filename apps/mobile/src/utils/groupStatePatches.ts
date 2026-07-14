import type { Coordinates, GroupState, MemberLocation } from '../types';

export interface MemberLocationPatch {
  userId: string;
  coordinates: Coordinates;
  updatedAt: string;
}

/**
 * Extract a location patch from a Supabase realtime postgres_changes payload.
 * Returns null when the row is incomplete (caller should full-reload).
 */
export function locationPatchFromRealtimePayload(
  payload: { new?: Record<string, unknown> | null; old?: Record<string, unknown> | null; eventType?: string },
): MemberLocationPatch | 'full-reload' | null {
  // Deletes / missing rows need a full membership refresh.
  if (payload.eventType === 'DELETE' || !payload.new) {
    return 'full-reload';
  }
  const row = payload.new;
  const userId = row.user_id;
  const lat = row.latitude;
  const lon = row.longitude;
  if (typeof userId !== 'string') return 'full-reload';
  if (typeof lat !== 'number' || typeof lon !== 'number') return 'full-reload';
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'full-reload';
  const updatedAt =
    typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString();
  return {
    userId,
    coordinates: { latitude: lat, longitude: lon },
    updatedAt,
  };
}

/**
 * Apply one or more peer location patches without a network round-trip.
 * - Skips myUserId (local GPS already owns self).
 * - Returns null if any patch refers to an unknown member (caller full-reloads).
 * - Returns the same state reference if nothing changed.
 */
export function applyMemberLocationPatches(
  state: GroupState,
  patches: MemberLocationPatch[],
  myUserId?: string | null,
): GroupState | null {
  if (patches.length === 0) return state;

  let members: MemberLocation[] | null = null;

  for (const patch of patches) {
    if (myUserId && patch.userId === myUserId) continue;
    const list = members ?? state.members;
    const idx = list.findIndex((m) => m.userId === patch.userId);
    if (idx < 0) return null;

    const prev = list[idx];
    const same =
      prev.coordinates?.latitude === patch.coordinates.latitude &&
      prev.coordinates?.longitude === patch.coordinates.longitude &&
      prev.lastUpdated === patch.updatedAt;
    if (same) continue;

    if (!members) members = state.members.slice();
    members[idx] = {
      ...prev,
      coordinates: patch.coordinates,
      lastUpdated: patch.updatedAt,
    };
  }

  if (!members) return state;
  return { ...state, members };
}

/** Merge patches by userId (last write wins) — pure, for debounce buffers. */
export function mergeLocationPatches(
  into: Map<string, MemberLocationPatch>,
  patch: MemberLocationPatch,
): void {
  into.set(patch.userId, patch);
}
