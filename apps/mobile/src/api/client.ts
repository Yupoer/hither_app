import { supabase } from './supabase';
import type {
  Coordinates,
  Destination,
  Group,
  GroupState,
  MemberLocation,
  MemberRole,
  MemberStatus,
} from '../types';

/**
 * API client for the Hither backend.
 *
 * Backed by Supabase (Postgres + Auth + RLS), called directly from the app via
 * supabase-js — there is no Vapor server anymore. Every function keeps its
 * original signature so screens are unchanged; the bodies translate between the
 * DB's snake_case rows and the app's camelCase types here, so this file is the
 * single seam between the data layer and the UI.
 *
 * Row access is governed by RLS (see the supabase_init migration): a user only
 * sees groups they belong to, only leaders can edit groups/itineraries, and a
 * member can only write their own location.
 */

const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // matches the schema's set

// --- Row shapes (DB snake_case) -------------------------------------------

interface GroupRow {
  id: string;
  name: string;
  invite_code: string;
  created_by: string | null;
  created_at: string | null;
}

interface MembershipRow {
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
}

interface ProfileRow {
  id: string;
  nickname: string;
}

interface ItineraryRow {
  id: string;
  title: string;
  description: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  position: number;
}

interface LocationRow {
  user_id: string;
  latitude: number | null;
  longitude: number | null;
  updated_at: string | null;
}

// --- Pure mappers (snake_case row -> camelCase type) ----------------------

/** Generate a 6-char invite code from the schema's character set. */
export function generateInviteCode(): string {
  return Array.from(
    { length: 6 },
    () =>
      INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)],
  ).join('');
}

export function mapGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    createdBy: row.created_by ?? '',
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

export function mapDestination(row: ItineraryRow): Destination {
  const coordinates: Coordinates = {
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
  };
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    order: row.position,
    address: row.address ?? undefined,
    coordinates,
    // The MVP schema does not store routing info; default to 0 (meters/seconds).
    travelDistance: 0,
    travelTime: 0,
  };
}

export function mapMember(
  membership: MembershipRow,
  profile: ProfileRow | undefined,
  location: LocationRow | undefined,
): MemberLocation {
  const coordinates: Coordinates | undefined =
    location && location.latitude != null && location.longitude != null
      ? { latitude: location.latitude, longitude: location.longitude }
      : undefined;
  return {
    userId: membership.user_id,
    name: profile?.nickname ?? '',
    role: membership.role,
    status: membership.status,
    coordinates,
    lastUpdated: location?.updated_at ?? undefined,
  };
}

// --- Helpers --------------------------------------------------------------

/** Current authenticated user id (auth.uid()). Throws if signed out. */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error('尚未登入');
  }
  return data.user.id;
}

// --- API functions --------------------------------------------------------

/**
 * Create a new group and join it as leader. Retries on the (rare) invite-code
 * collision since the column is unique.
 */
export async function createGroup(name: string): Promise<Group> {
  const uid = await requireUserId();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const inviteCode = generateInviteCode();
    const { data, error } = await supabase
      .from('groups')
      .insert({ name, invite_code: inviteCode, created_by: uid })
      .select('id, name, invite_code, created_by, created_at')
      .single();

    if (error) {
      // 23505 = unique_violation (invite_code clash) -> retry with a new code.
      if ((error as { code?: string }).code === '23505') {
        lastError = error;
        continue;
      }
      throw new Error(error.message);
    }

    const group = mapGroup(data as GroupRow);
    const { error: memberError } = await supabase
      .from('memberships')
      .insert({ group_id: group.id, user_id: uid, role: 'leader', status: 'active' });
    if (memberError) {
      throw new Error(memberError.message);
    }
    return group;
  }

  throw new Error(
    lastError instanceof Error ? lastError.message : '建立群組失敗，請再試一次',
  );
}

/**
 * Join a group by its 6-char invite code, becoming a follower. Idempotent: a
 * repeat join for the same user is ignored.
 *
 * The target group is hidden from non-members by RLS, and broadening that
 * SELECT would leak the whole group list, so the code lookup and the follower
 * membership insert happen atomically in the `join_group` SECURITY DEFINER
 * function (see the join_group_rpc migration). It raises SQLSTATE P0002 when the
 * code matches nothing, which we surface as a clean "group not found".
 */
export async function joinGroup(inviteCode: string): Promise<Group> {
  await requireUserId();

  const { data, error } = await supabase.rpc('join_group', {
    p_code: inviteCode.toUpperCase(),
  });

  if (error) {
    if ((error as { code?: string }).code === 'P0002') {
      throw new Error('找不到這個群組');
    }
    throw new Error(error.message);
  }
  return mapGroup(data as GroupRow);
}

/**
 * Aggregate the live state for a group: the group, its members (membership +
 * profile nickname + latest location), and the ordered itinerary. The first
 * itinerary stop (lowest position) is surfaced as `nextDestination`.
 */
export async function getGroupState(groupId: string): Promise<GroupState> {
  const [groupRes, membersRes, itineraryRes, locationsRes] = await Promise.all([
    supabase
      .from('groups')
      .select('id, name, invite_code, created_by, created_at')
      .eq('id', groupId)
      .single(),
    supabase
      .from('memberships')
      .select('user_id, role, status')
      .eq('group_id', groupId),
    supabase
      .from('itinerary_items')
      .select('id, title, description, address, latitude, longitude, position')
      .eq('group_id', groupId)
      .order('position', { ascending: true }),
    supabase
      .from('member_locations')
      .select('user_id, latitude, longitude, updated_at')
      .eq('group_id', groupId),
  ]);

  if (groupRes.error) throw new Error(groupRes.error.message);
  if (membersRes.error) throw new Error(membersRes.error.message);
  if (itineraryRes.error) throw new Error(itineraryRes.error.message);
  if (locationsRes.error) throw new Error(locationsRes.error.message);

  const memberRows = (membersRes.data ?? []) as MembershipRow[];
  const locationRows = (locationsRes.data ?? []) as LocationRow[];
  const itineraryRows = (itineraryRes.data ?? []) as ItineraryRow[];

  // Nicknames live in `profiles`; fetch them for exactly the members we have.
  // (memberships.user_id and profiles.id both reference auth.users, but there
  // is no direct FK between the two tables, so we join client-side.)
  const userIds = memberRows.map((m) => m.user_id);
  let profileRows: ProfileRow[] = [];
  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', userIds);
    if (profileError) throw new Error(profileError.message);
    profileRows = (profiles ?? []) as ProfileRow[];
  }

  const profileById = new Map(profileRows.map((p) => [p.id, p]));
  const locationByUser = new Map(locationRows.map((l) => [l.user_id, l]));

  const members: MemberLocation[] = memberRows.map((m) =>
    mapMember(m, profileById.get(m.user_id), locationByUser.get(m.user_id)),
  );

  const destinations: Destination[] = itineraryRows.map(mapDestination);

  return {
    group: mapGroup(groupRes.data as GroupRow),
    members,
    destinations,
    nextDestination: destinations[0],
  };
}

/**
 * Set the group's next destination by moving the chosen stop to the front of
 * the itinerary (lowest position). Leader-only (enforced by RLS). Returns the
 * refreshed state.
 */
export async function updateNextDestination(
  groupId: string,
  destinationId: string,
): Promise<GroupState> {
  const { data: minRow, error: minError } = await supabase
    .from('itinerary_items')
    .select('position')
    .eq('group_id', groupId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (minError) throw new Error(minError.message);

  const minPosition = minRow?.position ?? 0;
  const { error } = await supabase
    .from('itinerary_items')
    .update({ position: minPosition - 1 })
    .eq('id', destinationId)
    .eq('group_id', groupId);
  if (error) throw new Error(error.message);

  return getGroupState(groupId);
}

/**
 * Add a new itinerary stop and make it the group's next gathering point.
 *
 * The stop is inserted at the front of the itinerary (one below the current
 * lowest `position`) so `getGroupState` surfaces it as `nextDestination`.
 * Leader-only — `itinerary_items` INSERT is gated to leaders by RLS, so a
 * follower's call rejects with a 42501 we surface to the caller. Returns the
 * refreshed state.
 */
export async function addDestination(
  groupId: string,
  input: { title: string; address?: string; coordinates: Coordinates },
): Promise<GroupState> {
  const { data: minRow, error: minError } = await supabase
    .from('itinerary_items')
    .select('position')
    .eq('group_id', groupId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (minError) throw new Error(minError.message);

  const minPosition = minRow?.position ?? 0;
  const { error } = await supabase.from('itinerary_items').insert({
    group_id: groupId,
    title: input.title,
    address: input.address ?? null,
    latitude: input.coordinates.latitude,
    longitude: input.coordinates.longitude,
    position: minPosition - 1,
  });
  if (error) throw new Error(error.message);

  return getGroupState(groupId);
}

/**
 * Push the current user's location for a group (upsert into member_locations).
 * `groupId` is required to scope the row; RLS restricts writes to the caller's
 * own user_id. Called by the location integration (Phase A) when GPS updates.
 */
export async function updateMyLocation(
  coordinates: Coordinates,
  groupId: string,
): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase.from('member_locations').upsert(
    {
      group_id: groupId,
      user_id: uid,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'group_id,user_id' },
  );
  if (error) {
    throw new Error(error.message);
  }
}
