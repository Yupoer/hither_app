import { supabase } from './supabase';
import type {
  CommandType,
  Coordinates,
  Destination,
  Group,
  GroupState,
  JourneyStatus,
  MemberLocation,
  MemberRole,
  MemberStatus,
  NotificationPreferences,
} from '../types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../types';

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
  journey_status: JourneyStatus | null;
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
    journeyStatus: row.journey_status ?? 'paused',
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
      .select('id, name, invite_code, created_by, created_at, journey_status')
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
      .select('id, name, invite_code, created_by, created_at, journey_status')
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
 * Add a new itinerary stop, appended to the END of the itinerary.
 *
 * The stop is inserted one above the current highest `position`, so it becomes
 * the last gathering point in the trip rather than the next one — adding a stop
 * extends the journey forward. Leader-only — `itinerary_items` INSERT is gated
 * to leaders by RLS, so a follower's call rejects with a 42501 we surface to the
 * caller. Returns the refreshed state.
 */
export async function addDestination(
  groupId: string,
  input: { title: string; address?: string; coordinates: Coordinates },
): Promise<GroupState> {
  const { data: maxRow, error: maxError } = await supabase
    .from('itinerary_items')
    .select('position')
    .eq('group_id', groupId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) throw new Error(maxError.message);

  const maxPosition = maxRow?.position ?? -1;
  const { error } = await supabase.from('itinerary_items').insert({
    group_id: groupId,
    title: input.title,
    address: input.address ?? null,
    latitude: input.coordinates.latitude,
    longitude: input.coordinates.longitude,
    position: maxPosition + 1,
  });
  if (error) throw new Error(error.message);

  return getGroupState(groupId);
}

/**
 * Delete a single itinerary stop, then re-pack the remaining stops so their
 * `position` values stay gap-free (0,1,2…). Leader-only (RLS gates the DELETE),
 * so a follower's call rejects with a 42501. Returns the refreshed state.
 */
export async function deleteDestination(
  groupId: string,
  destinationId: string,
): Promise<GroupState> {
  const { error } = await supabase
    .from('itinerary_items')
    .delete()
    .eq('id', destinationId)
    .eq('group_id', groupId);
  if (error) throw new Error(error.message);

  // Re-pack remaining positions so order stays gap-free.
  const { data: rows, error: readError } = await supabase
    .from('itinerary_items')
    .select('id')
    .eq('group_id', groupId)
    .order('position', { ascending: true });
  if (readError) throw new Error(readError.message);

  const ids = (rows ?? []).map((r) => (r as { id: string }).id);
  if (ids.length > 0) {
    return reorderDestinations(groupId, ids);
  }
  return getGroupState(groupId);
}

/**
 * Persist a manual re-ordering of the itinerary. `orderedIds` is the list of
 * stop ids in their new order; each is written `position = index` so the order
 * is stable and gap-free. Leader-only (RLS gates `itinerary_items` UPDATE), so a
 * follower's call rejects with a 42501. Returns the refreshed state.
 */
export async function reorderDestinations(
  groupId: string,
  orderedIds: string[],
): Promise<GroupState> {
  // Write all positions in parallel; each row is scoped to the group.
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from('itinerary_items')
        .update({ position: index })
        .eq('id', id)
        .eq('group_id', groupId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  return getGroupState(groupId);
}

/**
 * Update the current user's anonymous nickname (in `public.profiles`). RLS lets
 * a user write only their own profile row. Returns the trimmed nickname.
 */
export async function updateNickname(nickname: string): Promise<string> {
  const uid = await requireUserId();
  const trimmed = nickname.trim();
  if (!trimmed) {
    throw new Error('暱稱不能為空');
  }
  const { error } = await supabase
    .from('profiles')
    .update({ nickname: trimmed })
    .eq('id', uid);
  if (error) throw new Error(error.message);
  return trimmed;
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

// --- Notifications, commands & journey ------------------------------------

/**
 * Persist this device's APNs token (upsert into `push_tokens`). The token comes
 * from the native boundary (`native/notifications.getDevicePushToken`) — this
 * data-layer function only stores it, keeping client.ts free of native imports.
 * No-op when `token` is falsy (e.g. Expo Go returns null). The APNs Edge
 * Function later reads these rows (service role) to know where to push.
 */
export async function savePushToken(
  token: string | null,
  platform: 'ios' | 'android' = 'ios',
): Promise<void> {
  if (!token) return;
  const uid = await requireUserId();
  const { error } = await supabase.from('push_tokens').upsert(
    { user_id: uid, token, platform, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,token' },
  );
  if (error) throw new Error(error.message);
}

/**
 * Send a group command (leader directive or follower quick request) by
 * inserting into `commands`. RLS restricts the insert to a member writing their
 * own `sender_id`. An AFTER-INSERT trigger fans the push out to everyone else
 * (minus the sender) via the Edge Function, so the caller only writes the row.
 * `coords` optionally tags the command with the sender's position.
 */
export async function sendCommand(
  groupId: string,
  type: CommandType,
  message?: string,
  coords?: Coordinates,
): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase.from('commands').insert({
    group_id: groupId,
    sender_id: uid,
    type,
    message: message ?? null,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
  });
  if (error) throw new Error(error.message);
}

interface NotificationPrefsRow {
  add_gathering: boolean;
  leader_commands: boolean;
  follower_requests: boolean;
  journey: boolean;
}

/** Map a DB notification_preferences row to the camelCase type. */
export function mapNotificationPreferences(
  row: NotificationPrefsRow,
): NotificationPreferences {
  return {
    addGathering: row.add_gathering,
    leaderCommands: row.leader_commands,
    followerRequests: row.follower_requests,
    journey: row.journey,
  };
}

/**
 * Read the current user's per-category notification preferences. Returns the
 * all-on defaults when no row exists yet (a fresh user), matching the Edge
 * Function's "missing row = everything enabled" rule.
 */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('add_gathering, leader_commands, follower_requests, journey')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  return mapNotificationPreferences(data as NotificationPrefsRow);
}

/**
 * Upsert the current user's notification preferences (all four categories).
 * RLS limits the write to the caller's own row. Returns the saved preferences.
 */
export async function setNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<NotificationPreferences> {
  const uid = await requireUserId();
  const { error } = await supabase.from('notification_preferences').upsert(
    {
      user_id: uid,
      add_gathering: prefs.addGathering,
      leader_commands: prefs.leaderCommands,
      follower_requests: prefs.followerRequests,
      journey: prefs.journey,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(error.message);
  return prefs;
}

/**
 * Set the group's journey status (start = 'going', pause = 'paused').
 * Leader-only — `groups` UPDATE is gated to leaders by RLS, so a follower's
 * call rejects with a 42501. An AFTER-UPDATE trigger pushes the change to
 * members (minus the leader). Returns the refreshed state.
 */
export async function setJourneyStatus(
  groupId: string,
  status: JourneyStatus,
): Promise<GroupState> {
  const { error } = await supabase
    .from('groups')
    .update({ journey_status: status })
    .eq('id', groupId);
  if (error) throw new Error(error.message);
  return getGroupState(groupId);
}
