import { supabase } from './supabase';
import {
  demoAddDestination,
  demoDeleteDestination,
  demoInviteToSubgroup,
  demoReorderDestinations,
  demoSelfMerge,
  demoSelfSplit,
  demoSetJourneyStatus,
  demoSetSolo,
  demoUpdateMyLocation,
  getDemoState,
  isDemoGroup,
} from './demo';
import type {
  CommandType,
  Coordinates,
  Destination,
  Group,
  GroupState,
  JourneyStatus,
  MemberLocation,
  MemberRole,
  NotificationPreferences,
  PendingInvite,
  Subgroup,
  SubgroupInvite,
  SubgroupMode,
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
  /** Optional — absent until the straggler_alerts migration is applied. */
  straggler_alerts?: boolean | null;
  /** Optional — absent until the straggler_alerts migration is applied. */
  straggler_threshold_m?: number | null;
}

interface MembershipRow {
  user_id: string;
  role: MemberRole;
  /** Optional — absent until the solo_mode migration is applied. */
  solo?: boolean | null;
  /** Optional — absent until the subgroups migration is applied. */
  subgroup_id?: string | null;
}

interface SubgroupRow {
  id: string;
  name: string;
  mode: SubgroupMode;
  leader_id: string | null;
  parent_subgroup_id: string | null;
}

interface SubgroupInviteRow {
  id: string;
  group_id: string;
  subgroup_id: string;
  inviter_id: string;
  invitee_id: string;
  status: SubgroupInvite['status'];
  created_at: string | null;
}

interface ProfileRow {
  id: string;
  nickname: string;
  /** Optional — absent until the profiles_avatar migration is applied. */
  avatar?: string | null;
}

interface ItineraryRow {
  id: string;
  title: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  position: number;
  /** Optional — absent until the meet_time migration is applied. */
  meet_at?: string | null;
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
    stragglerAlerts: row.straggler_alerts ?? true,
    stragglerThresholdM: row.straggler_threshold_m ?? 500,
  };
}

export function mapDestination(row: ItineraryRow): Destination {
  return {
    id: row.id,
    title: row.title,
    order: row.position,
    address: row.address ?? undefined,
    coordinates: {
      latitude: row.latitude ?? 0,
      longitude: row.longitude ?? 0,
    },
    meetAt: row.meet_at ?? undefined,
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
    avatar: profile?.avatar ?? undefined,
    solo: membership.solo ?? false,
    subgroupId: membership.subgroup_id ?? undefined,
    coordinates,
    lastUpdated: location?.updated_at ?? undefined,
  };
}

export function mapSubgroup(row: SubgroupRow): Subgroup {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    leaderId: row.leader_id ?? undefined,
    parentId: row.parent_subgroup_id ?? undefined,
  };
}

export function mapSubgroupInvite(row: SubgroupInviteRow): SubgroupInvite {
  return {
    id: row.id,
    groupId: row.group_id,
    subgroupId: row.subgroup_id,
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id,
    status: row.status,
    createdAt: row.created_at ?? undefined,
  };
}

// --- Helpers --------------------------------------------------------------

/**
 * Current authenticated user id (auth.uid()). Throws if signed out. Reads the
 * locally cached session — no network round-trip per API call; RLS re-validates
 * the JWT server-side on every query, so nothing trusts this id blindly.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (error || !uid) {
    throw new Error('尚未登入');
  }
  return uid;
}

/** Throw a clean Error when a Supabase response reports one. */
function orThrow(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
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
    orThrow(memberError);
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
  if (isDemoGroup(groupId)) {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    let profile: ProfileRow | null = null;
    if (uid) {
      const { data: p } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .maybeSingle();
      profile = (p as ProfileRow | null) ?? null;
    }
    return getDemoState(uid, profile?.nickname, profile?.avatar ?? undefined);
  }
  const [groupRes, membersRes, itineraryRes, locationsRes] = await Promise.all([
    supabase
      .from('groups')
      .select('id, name, invite_code, created_by, created_at, journey_status')
      .eq('id', groupId)
      .single(),
    // select('*') so optional columns (solo, subgroup_id) come through when
    // their migrations are applied, and are simply absent before.
    supabase
      .from('memberships')
      .select('*')
      .eq('group_id', groupId),
    supabase
      .from('itinerary_items')
      .select('id, title, address, latitude, longitude, position, meet_at')
      .eq('group_id', groupId)
      .order('position', { ascending: true }),
    supabase
      .from('member_locations')
      .select('user_id, latitude, longitude, updated_at')
      .eq('group_id', groupId),
  ]);

  orThrow(groupRes.error);
  orThrow(membersRes.error);
  orThrow(itineraryRes.error);
  orThrow(locationsRes.error);

  const memberRows = (membersRes.data ?? []) as MembershipRow[];
  const locationRows = (locationsRes.data ?? []) as LocationRow[];
  const itineraryRows = (itineraryRes.data ?? []) as ItineraryRow[];

  // Nicknames live in `profiles`; fetch them for exactly the members we have.
  // (memberships.user_id and profiles.id both reference auth.users, but there
  // is no direct FK between the two tables, so we join client-side.)
  const userIds = memberRows.map((m) => m.user_id);
  let profileRows: ProfileRow[] = [];
  if (userIds.length > 0) {
    // select('*') so optional columns (avatar) come through when the migration
    // is applied, and are simply absent — not an error — before it.
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .in('id', userIds);
    orThrow(profileError);
    profileRows = (profiles ?? []) as ProfileRow[];
  }

  const profileById = new Map(profileRows.map((p) => [p.id, p]));
  const locationByUser = new Map(locationRows.map((l) => [l.user_id, l]));

  const members: MemberLocation[] = memberRows.map((m) =>
    mapMember(m, profileById.get(m.user_id), locationByUser.get(m.user_id)),
  );

  const destinations: Destination[] = itineraryRows.map(mapDestination);

  // Subgroups — tolerant of the table not existing yet (pre-migration):
  // an error just means "no subgroups".
  let subgroups: Subgroup[] = [];
  const sgRes = await supabase
    .from('subgroups')
    .select('*')
    .eq('group_id', groupId);
  if (!sgRes.error) {
    subgroups = ((sgRes.data ?? []) as SubgroupRow[]).map(mapSubgroup);
  }

  return {
    group: mapGroup(groupRes.data as GroupRow),
    members,
    destinations,
    subgroups,
    nextDestination: destinations[0],
  };
}

/**
 * Add a new itinerary stop, appended to the END of the itinerary.
 *
 * The stop is inserted one above the current highest `position`, so it becomes
 * the last gathering point in the trip rather than the next one — adding a stop
 * extends the journey forward. Leader-only — `itinerary_items` INSERT is gated
 * to leaders by RLS, so a follower's call rejects with a 42501 we surface to the
 * caller. Callers refresh via useGroupState (realtime + refresh()).
 */
export async function addDestination(
  groupId: string,
  input: { title: string; address?: string; coordinates: Coordinates },
): Promise<void> {
  if (isDemoGroup(groupId)) {
    demoAddDestination(input);
    return;
  }
  const { data: maxRow, error: maxError } = await supabase
    .from('itinerary_items')
    .select('position')
    .eq('group_id', groupId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  orThrow(maxError);

  const maxPosition = maxRow?.position ?? -1;
  const { error } = await supabase.from('itinerary_items').insert({
    group_id: groupId,
    title: input.title,
    address: input.address ?? null,
    latitude: input.coordinates.latitude,
    longitude: input.coordinates.longitude,
    position: maxPosition + 1,
  });
  orThrow(error);
}

/**
 * Delete a single itinerary stop, then re-pack the remaining stops so their
 * `position` values stay gap-free (0,1,2…). Leader-only (RLS gates the DELETE),
 * so a follower's call rejects with a 42501.
 */
export async function deleteDestination(
  groupId: string,
  destinationId: string,
): Promise<void> {
  if (isDemoGroup(groupId)) {
    demoDeleteDestination(destinationId);
    return;
  }
  const { error } = await supabase
    .from('itinerary_items')
    .delete()
    .eq('id', destinationId)
    .eq('group_id', groupId);
  orThrow(error);

  // Re-pack remaining positions so order stays gap-free.
  const { data: rows, error: readError } = await supabase
    .from('itinerary_items')
    .select('id')
    .eq('group_id', groupId)
    .order('position', { ascending: true });
  orThrow(readError);

  const ids = (rows ?? []).map((r) => (r as { id: string }).id);
  if (ids.length > 0) {
    await reorderDestinations(groupId, ids);
  }
}

/**
 * Persist a manual re-ordering of the itinerary. `orderedIds` is the list of
 * stop ids in their new order; each is written `position = index` so the order
 * is stable and gap-free. Leader-only (RLS gates `itinerary_items` UPDATE), so a
 * follower's call rejects with a 42501.
 */
export async function reorderDestinations(
  groupId: string,
  orderedIds: string[],
): Promise<void> {
  if (isDemoGroup(groupId)) {
    demoReorderDestinations(orderedIds);
    return;
  }
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
  orThrow(results.find((r) => r.error)?.error ?? null);
}

/**
 * Set (or clear, with `null`) a gathering point's target meet time. Leader-only
 * — `itinerary_items` UPDATE is gated to leaders by RLS, so a follower's call
 * rejects with a 42501.
 */
export async function setDestinationMeetTime(
  destinationId: string,
  meetAt: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('itinerary_items')
    .update({ meet_at: meetAt })
    .eq('id', destinationId);
  orThrow(error);
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
  orThrow(error);
  return trimmed;
}

/**
 * Update the current user's profile (nickname and/or emoji avatar) in a single
 * `profiles` round-trip. Same RLS as above: only your own row. Blank/omitted
 * fields are left untouched; a call with nothing to change is a no-op.
 */
export async function updateProfile(fields: {
  nickname?: string;
  avatar?: string;
}): Promise<void> {
  const patch: { nickname?: string; avatar?: string } = {};
  const nickname = fields.nickname?.trim();
  if (nickname) patch.nickname = nickname;
  if (fields.avatar) patch.avatar = fields.avatar;
  if (!patch.nickname && !patch.avatar) return;
  const uid = await requireUserId();
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', uid);
  orThrow(error);
}

/**
 * Persist the Onboarding answers onto the signed-in user's profile row (the
 * `onboarding` jsonb column — see the profiles_onboarding migration). The
 * flow runs before sign-in, so this is called once after a session exists
 * (see onboarding/sync.ts). Throws on failure (e.g. the `onboarding` column
 * not deployed yet) — the caller decides whether to swallow; sync.ts does,
 * and only marks the answers synced on success so they retry next launch.
 */
export async function saveOnboardingProfile(answers: object): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding: answers })
    .eq('id', uid);
  if (error) throw new Error(error.message);
}

/**
 * Invite someone into a subgroup ("小隊"). Forming a ≥2-person team is
 * invite-driven now: any team member invites a co-member, who accepts to move
 * in. Goes through the `invite_to_subgroup` SECURITY DEFINER RPC (direct
 * subgroup_invites writes are closed), which verifies the caller is a member of
 * the subgroup and the invitee is an eligible co-member. Demo teams have no
 * second device to accept, so the demo path auto-joins instead.
 */
export async function inviteToSubgroup(
  subgroupId: string,
  inviteeId: string,
): Promise<void> {
  // Demo subgroups carry `demo-sg-` ids and never reach Supabase.
  if (subgroupId.startsWith('demo-sg-')) {
    demoInviteToSubgroup(subgroupId, inviteeId);
    return;
  }
  const { error } = await supabase.rpc('invite_to_subgroup', {
    p_subgroup: subgroupId,
    p_invitee: inviteeId,
  });
  orThrow(error);
}

/**
 * Accept a subgroup invite: mark it accepted and move yourself into the
 * subgroup. Goes through the `accept_subgroup_invite` RPC, which hard-scopes
 * the write to the invitee (auth.uid()) and their own membership row.
 */
export async function acceptSubgroupInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_subgroup_invite', {
    p_invite: inviteId,
  });
  orThrow(error);
}

/** Decline a subgroup invite (marks it declined; membership untouched). */
export async function declineSubgroupInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_subgroup_invite', {
    p_invite: inviteId,
  });
  orThrow(error);
}

/**
 * Fetch the current user's pending subgroup invites, enriched with the team
 * name and inviter nickname for the accept/decline card. There is no direct FK
 * from subgroup_invites to profiles, so names are joined client-side (same
 * pattern as getGroupState).
 */
export async function fetchMyInvites(userId: string): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from('subgroup_invites')
    .select('id, group_id, subgroup_id, inviter_id, invitee_id, status, created_at')
    .eq('invitee_id', userId)
    .eq('status', 'pending');
  orThrow(error);

  const invites = ((data ?? []) as SubgroupInviteRow[]).map(mapSubgroupInvite);
  if (invites.length === 0) return [];

  const subgroupIds = [...new Set(invites.map((i) => i.subgroupId))];
  const inviterIds = [...new Set(invites.map((i) => i.inviterId))];

  const [sgRes, profRes] = await Promise.all([
    supabase.from('subgroups').select('id, name').in('id', subgroupIds),
    supabase.from('profiles').select('id, nickname').in('id', inviterIds),
  ]);
  orThrow(sgRes.error);
  orThrow(profRes.error);

  const nameBySubgroup = new Map(
    ((sgRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
  );
  const nameByInviter = new Map(
    ((profRes.data ?? []) as { id: string; nickname: string }[]).map((p) => [p.id, p.nickname]),
  );

  return invites.map((i) => ({
    ...i,
    subgroupName: nameBySubgroup.get(i.subgroupId) ?? '',
    inviterName: nameByInviter.get(i.inviterId) ?? '',
  }));
}

/**
 * Toggle the current user's Solo mode for a group. Solo members stay visible
 * on the map but receive no group notifications until they rejoin. Goes
 * through the `set_solo` SECURITY DEFINER RPC (memberships UPDATE is
 * leader-only by RLS; the RPC limits the write to the caller's own solo flag).
 */
export async function setSolo(groupId: string, solo: boolean): Promise<void> {
  if (isDemoGroup(groupId)) {
    demoSetSolo(solo);
    return;
  }
  const { error } = await supabase.rpc('set_solo', {
    p_group: groupId,
    p_solo: solo,
  });
  orThrow(error);
}

/**
 * Split yourself off into a brand-new subgroup that you lead, nested under
 * your current subgroup (or top-level if you're not in one). No leader
 * permission needed — goes through the `self_split` SECURITY DEFINER RPC,
 * which hard-scopes the write to the caller's own membership row.
 */
export async function selfSplit(groupId: string, name: string): Promise<Subgroup> {
  if (isDemoGroup(groupId)) {
    return demoSelfSplit(name);
  }
  const { data, error } = await supabase.rpc('self_split', {
    p_group: groupId,
    p_name: name,
  });
  orThrow(error);
  return mapSubgroup(data as SubgroupRow);
}

/**
 * Merge yourself back up one level (to your subgroup's parent, or the main
 * group). No leader permission needed — goes through the `self_merge`
 * SECURITY DEFINER RPC, which only ever moves the caller's own row.
 */
export async function selfMerge(groupId: string): Promise<void> {
  if (isDemoGroup(groupId)) {
    demoSelfMerge();
    return;
  }
  const { error } = await supabase.rpc('self_merge', { p_group: groupId });
  orThrow(error);
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
  if (isDemoGroup(groupId)) {
    demoUpdateMyLocation(coordinates);
    return;
  }
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
  orThrow(error);
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
  orThrow(error);
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
  if (isDemoGroup(groupId)) return; // demo flock: nobody to push to
  const uid = await requireUserId();
  const { error } = await supabase.from('commands').insert({
    group_id: groupId,
    sender_id: uid,
    type,
    message: message ?? null,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
  });
  orThrow(error);
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
  orThrow(error);
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
  orThrow(error);
  return prefs;
}

/**
 * Set the group's journey status (start = 'going', pause = 'paused').
 * Leader-only — `groups` UPDATE is gated to leaders by RLS, so a follower's
 * call rejects with a 42501. An AFTER-UPDATE trigger pushes the change to
 * members (minus the leader).
 */
export async function setJourneyStatus(
  groupId: string,
  status: JourneyStatus,
): Promise<void> {
  if (isDemoGroup(groupId)) {
    demoSetJourneyStatus(status);
    return;
  }
  const { error } = await supabase
    .from('groups')
    .update({ journey_status: status })
    .eq('id', groupId);
  orThrow(error);
}

/**
 * Set the group's straggler-alert config (on/off + distance threshold in
 * metres). Leader-only — `groups` UPDATE is gated to leaders by RLS, so a
 * follower's call rejects with a 42501.
 */
export async function setStragglerConfig(
  groupId: string,
  enabled: boolean,
  thresholdM: number,
): Promise<void> {
  const { error } = await supabase
    .from('groups')
    .update({ straggler_alerts: enabled, straggler_threshold_m: thresholdM })
    .eq('id', groupId);
  orThrow(error);
}
