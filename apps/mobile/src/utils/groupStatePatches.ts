import type { Coordinates, GroupState, MemberLocation } from '../types';
import { isLocationSampleFresh, type LocationSampleMetadata } from './locationFreshness';

export interface MemberLocationPatch extends LocationSampleMetadata {
  userId: string;
  coordinates: Coordinates;
  updatedAt: string;
  capturedAt?: string | null;
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
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'full-reload';
  if (typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) return 'full-reload';
  const updatedAt =
    typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString();
  return {
    userId,
    coordinates: { latitude: lat, longitude: lon },
    updatedAt,
    ...(typeof row.captured_at === 'string' ? { capturedAt: row.captured_at } : {}),
    ...(typeof row.tracking_mode === 'string' || row.tracking_mode === null ? { locationTrackingMode: row.tracking_mode } : {}),
    ...(typeof row.source === 'string' || row.source === null ? { locationSource: row.source } : {}),
    ...(typeof row.navigation_session_id === 'string' || row.navigation_session_id === null
      ? { locationNavigationSessionId: row.navigation_session_id } : {}),
  };
}

/**
 * Apply one or more peer location patches without a network round-trip.
 * - Includes own server confirmation; device GPS remains separate.
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
  const memberIndex = new Map(state.members.map((member, index) => [member.userId, index]));

  for (const patch of patches) {
    if (!Number.isFinite(Date.parse(patch.updatedAt)) || !Number.isFinite(patch.coordinates.latitude)
      || !Number.isFinite(patch.coordinates.longitude) || Math.abs(patch.coordinates.latitude) > 90
      || Math.abs(patch.coordinates.longitude) > 180) continue;

    const list = members ?? state.members;
    const idx = memberIndex.get(patch.userId);
    if (idx == null) return null;

    const prev = list[idx];
    if (prev.sharingEnabled === false) continue;
    const previousUpload = prev.uploadedAt ?? prev.lastUpdated;
    if (previousUpload && Date.parse(patch.updatedAt) <= Date.parse(previousUpload)) continue;
    const same =
      prev.coordinates?.latitude === patch.coordinates.latitude &&
      prev.coordinates?.longitude === patch.coordinates.longitude &&
      previousUpload === patch.updatedAt;
    if (same) continue;

    if (!members) members = state.members.slice();
    members[idx] = {
      ...prev,
      coordinates: patch.coordinates,
      capturedAt: patch.capturedAt ?? null,
      uploadedAt: patch.updatedAt,
      // Clear absent metadata on a new sample; an older passive profile must
      // not grant an unknown/journey sample the longer freshness allowance.
      locationTrackingMode: patch.locationTrackingMode,
      locationSource: patch.locationSource,
      locationNavigationSessionId: patch.locationNavigationSessionId,
      locationAvailability: isLocationSampleFresh(patch.capturedAt ?? patch.updatedAt, patch)
        ? 'available' : 'stale',
      lastUpdated: patch.capturedAt ?? patch.updatedAt,
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
  const previous = into.get(patch.userId);
  if (previous && Date.parse(previous.updatedAt) >= Date.parse(patch.updatedAt)) return;
  into.set(patch.userId, patch);
}
