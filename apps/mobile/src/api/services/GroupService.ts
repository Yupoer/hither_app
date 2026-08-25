/**
 * GroupService — group lifecycle (create, join, fetch state, config).
 *
 * Extracted from the monolithic client.ts for maintainability. Every export is
 * re-exported from `../client.ts` so existing imports stay unchanged.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import {
  AVATAR_COLORS,
  AVATAR_EMOJI,
  avatarColorForGroup,
  avatarForGroup,
  displayMemberAvatar,
} from '../../constants/avatars';
import { memberColor } from '../../glass';
import { mergeAvatarProfiles } from '../../utils/gatherCommand';
import {
  demoSetJourneyStatus,
  demoSetJourneyTarget,
  demoSetSolo,
  demoSelfSplit,
  demoSelfMerge,
  getDemoState,
  isDemoGroup,
} from '../demo';
import type {
  Coordinates,
  Destination,
  Group,
  GroupState,
  JourneyStatus,
  MemberLocation,
  MemberRole,
  MembershipStatus,
  Subgroup,
  SubgroupInvite,
  SubgroupMode,
} from '../../types';
import { generateInviteCode, requireUserId, orThrow } from './_helpers';
import { mapDestination, type ItineraryRow } from './DestinationService';
import {
  listDailyAccommodations,
  type DailyAccommodation,
} from './DailyAccommodationService';
import {
  ANON_EXPIRED_ERROR,
  ANON_LEADER_REGISTRATION_REQUIRED,
  classifyAnonymousAccessError,
} from '../../anonymousAccess';

// ── Row shapes (DB snake_case) ─────────────────────────────────────────────

export interface GroupRow {
  id: string;
  name: string;
  invite_code: string;
  avatar?: string | null;
  avatar_color?: string | null;
  created_by: string | null;
  created_at: string | null;
  journey_status: JourneyStatus | null;
  active_destination_id?: string | null;
  journey_started_at?: string | null;
  straggler_alerts?: boolean | null;
  straggler_threshold_m?: number | null;
  trip_days?: number | null;
  departure_date?: string | null;
  accommodation_auto_add?: boolean | null;
}

export interface MembershipRow {
  user_id: string;
  role: MemberRole;
  status?: MembershipStatus | null;
  solo?: boolean | null;
  subgroup_id?: string | null;
}

export interface SubgroupRow {
  id: string;
  name: string;
  mode: SubgroupMode;
  leader_id: string | null;
  parent_subgroup_id: string | null;
}

export interface SubgroupInviteRow {
  id: string;
  group_id: string;
  subgroup_id: string;
  inviter_id: string;
  invitee_id: string;
  status: SubgroupInvite['status'];
  created_at: string | null;
}

export interface ProfileRow {
  id: string;
  nickname: string;
  avatar?: string | null;
  avatar_color?: string | null;
}

export interface LocationRow {
  user_id: string;
  latitude: number | null;
  longitude: number | null;
  updated_at: string | null;
}

// ── Pure mappers ───────────────────────────────────────────────────────────

export function mapGroup(row: GroupRow): Group {
  const storedAvatar = row.avatar;
  const storedColor = row.avatar_color;
  return {
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    createdBy: row.created_by ?? '',
    createdAt: row.created_at ?? new Date().toISOString(),
    journeyStatus: row.journey_status ?? 'paused',
    activeDestinationId: row.active_destination_id ?? undefined,
    journeyStartedAt: row.journey_started_at ?? undefined,
    stragglerAlerts: row.straggler_alerts ?? true,
    stragglerThresholdM: row.straggler_threshold_m ?? 500,
    tripDays: row.trip_days ?? undefined,
    departureDate: row.departure_date ?? undefined,
    accommodationAutoAdd: row.accommodation_auto_add ?? true,
    avatar: storedAvatar && (AVATAR_EMOJI as readonly string[]).includes(storedAvatar.trim())
      ? storedAvatar.trim()
      : avatarForGroup(row.id),
    avatarColor: storedColor && (AVATAR_COLORS as readonly string[]).includes(storedColor.trim())
      ? storedColor.trim()
      : avatarColorForGroup(row.id),
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
    status: membership.status ?? 'active',
    avatar: displayMemberAvatar(profile?.avatar, membership.user_id, profile?.avatar_color).emoji,
    avatarColor: displayMemberAvatar(profile?.avatar, membership.user_id, profile?.avatar_color).color,
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

// ── API functions ──────────────────────────────────────────────────────────

/**
 * Create a group as leader via atomic SECURITY DEFINER RPC.
 * Avoids orphan groups (group row without leader membership) that cannot be
 * deleted under RLS "groups: delete if leader" after a failed membership insert.
 */
export async function createGroup(
  name: string,
  avatar?: string,
  avatarColor?: string,
): Promise<Group> {
  await requireUserId();
  const { data, error } = await supabase.rpc('create_group', {
    p_name: name.trim(),
  });
  if (error) {
    const code = (error as { code?: string }).code;
    const kind = classifyAnonymousAccessError(error.message);
    if (kind === 'expired' || code === 'P0401') {
      throw new Error(ANON_EXPIRED_ERROR);
    }
    if (kind === 'registration_required' || code === 'P0406') {
      throw new Error(ANON_LEADER_REGISTRATION_REQUIRED);
    }
    throw new Error(error.message);
  }
  const group = mapGroup(data as GroupRow);
  if (avatar || avatarColor) {
    return updateGroupAvatar(
      group.id,
      avatar ?? group.avatar ?? avatarForGroup(group.id),
      avatarColor,
    );
  }
  return group;
}

export async function updateGroupAvatar(
  groupId: string,
  avatar: string,
  avatarColor?: string,
): Promise<Group> {
  await requireUserId();
  const safeAvatar = (AVATAR_EMOJI as readonly string[]).includes(avatar)
    ? avatar
    : avatarForGroup(groupId);
  const safeColor = avatarColor && (AVATAR_COLORS as readonly string[]).includes(avatarColor)
    ? avatarColor
    : avatarColorForGroup(groupId);
  const { data, error } = await supabase
    .from('groups')
    .update({ avatar: safeAvatar, avatar_color: safeColor })
    .eq('id', groupId)
    .select('id, name, invite_code, avatar, avatar_color, created_by, created_at, journey_status, active_destination_id, journey_started_at, straggler_alerts, straggler_threshold_m, trip_days, departure_date, accommodation_auto_add')
    .single();
  orThrow(error);
  invalidateMyJoinedGroupsCache();
  return mapGroup(data as GroupRow);
}

export async function joinGroup(inviteCode: string): Promise<Group> {
  await requireUserId();
  const { data, error } = await supabase.rpc('join_group', {
    p_code: inviteCode.toUpperCase(),
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === 'P0002') {
      throw new Error('找不到這個群組');
    }
    // Free Plan member cap (5 including Leader) — server-authoritative.
    if (code === 'P0003' || /member_limit/i.test(error.message)) {
      const err = new Error('member_limit') as Error & { code?: string };
      err.code = 'member_limit';
      throw err;
    }
    const kind = classifyAnonymousAccessError(error.message);
    if (kind === 'expired' || code === 'P0401') {
      throw new Error(ANON_EXPIRED_ERROR);
    }
    if (kind === 'registration_required' || code === 'P0406') {
      throw new Error(ANON_LEADER_REGISTRATION_REQUIRED);
    }
    throw new Error(error.message);
  }
  return mapGroup(data as GroupRow);
}

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
  const [groupRes, membersRes, itineraryRes, locationsRes, dailyAccommodations] =
    await Promise.all([
    supabase
      .from('groups')
      .select(
        'id, name, invite_code, avatar, avatar_color, created_by, created_at, journey_status, active_destination_id, journey_started_at, straggler_alerts, straggler_threshold_m, trip_days, departure_date, accommodation_auto_add',
      )
      .eq('id', groupId)
      .single(),
    supabase
      .from('memberships')
      .select('*')
      .eq('group_id', groupId),
    supabase
      .from('itinerary_items')
      .select(
        'id, title, address, latitude, longitude, position, day, meet_at, meet_red_minutes, subgroup_id, closed_at, closed_by_session_id, emoji, marker_color, kind, stay_anchor',
      )
      .eq('group_id', groupId)
      .order('position', { ascending: true }),
    supabase
      .from('member_locations')
      .select('user_id, latitude, longitude, updated_at')
      .eq('group_id', groupId),
    // Do not swallow load failures as an empty list (false "no stay").
    listDailyAccommodations(groupId),
  ]);

  orThrow(groupRes.error);
  orThrow(membersRes.error);
  orThrow(itineraryRes.error);
  orThrow(locationsRes.error);

  const memberRows = (membersRes.data ?? []) as MembershipRow[];
  const locationRows = (locationsRes.data ?? []) as LocationRow[];
  const itineraryRows = (itineraryRes.data ?? []) as unknown[];

  const userIds = memberRows.map((m) => m.user_id);
  let profileRows: ProfileRow[] = [];
  if (userIds.length > 0) {
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

  const destinations: Destination[] = (itineraryRows as any[]).map(mapDestination);

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
    dailyAccommodations,
  };
}

export interface GroupRecoverySnapshot {
  state: GroupState;
  generatedAt: string | null;
  revision: string;
  entityVersions: Record<string, number>;
}

/** Map the single Ticket 2 RPC response; no endpoint fan-out or fallback. */
export async function getGroupRecoverySnapshot(
  groupId: string,
): Promise<GroupRecoverySnapshot> {
  if (isDemoGroup(groupId)) {
    return {
      state: await getGroupState(groupId),
      generatedAt: new Date().toISOString(),
      revision: 'demo',
      entityVersions: {},
    };
  }
  await requireUserId();
  const { data, error } = await supabase.rpc('get_group_recovery_snapshot', {
    p_group_id: groupId,
  });
  orThrow(error);
  if (!data || typeof data !== 'object') {
    throw new Error('group_recovery_snapshot_invalid');
  }
  const payload = data as Record<string, unknown>;
  const groupRow = payload.group as GroupRow | null | undefined;
  if (!groupRow) throw new Error('group_recovery_snapshot_missing_group');

  const memberRows = (Array.isArray(payload.memberships) ? payload.memberships : []) as MembershipRow[];
  const profileRows = (Array.isArray(payload.profiles) ? payload.profiles : []) as ProfileRow[];
  const locationRows = (Array.isArray(payload.locations) ? payload.locations : []) as LocationRow[];
  const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const locationByUser = new Map(locationRows.map((location) => [location.user_id, location]));
  const members = memberRows.map((membership) =>
    mapMember(membership, profileById.get(membership.user_id), locationByUser.get(membership.user_id)),
  );
  const destinations = (Array.isArray(payload.itinerary) ? payload.itinerary : [])
    .map((row) => mapDestination(row as ItineraryRow));
  const subgroups = (Array.isArray(payload.subgroups) ? payload.subgroups : [])
    .map((row) => mapSubgroup(row as SubgroupRow));
  const versions: Record<string, number> = {};
  if (Array.isArray(payload.entity_versions)) {
    for (const row of payload.entity_versions) {
      if (!row || typeof row !== 'object') continue;
      const version = row as Record<string, unknown>;
      if (typeof version.entity_type !== 'string' || typeof version.entity_id !== 'string') continue;
      if (typeof version.entity_version === 'number') {
        versions[`${version.entity_type}:${version.entity_id}`] = version.entity_version;
      }
    }
  }
  const generatedAt = typeof payload.generated_at === 'string' ? payload.generated_at : null;
  const revision = typeof payload.realtime_revision === 'string'
    ? payload.realtime_revision
    : generatedAt ?? '0';
  // Daily accommodations are a separate source of truth; batch-load (not per-day).
  // Propagate load failures — do not present errors as "no stay".
  const dailyAccommodations = await listDailyAccommodations(groupId);
  return {
    state: {
      group: mapGroup(groupRow),
      members,
      destinations,
      subgroups,
      nextDestination: destinations[0],
      dailyAccommodations,
    },
    generatedAt,
    revision,
    entityVersions: versions,
  };
}

export interface JoinedGroupInfo {
  group: Group;
  memberCount: number;
  role: MemberRole;
  memberProfiles: { userId?: string; avatar?: string; avatarColor?: string }[];
}

export type GetMyJoinedGroupsOptions = {
  /**
   * When false, skip the profiles round-trip (RoleSelect only needs count +
   * group metadata). MyTeams should keep the default true for avatars.
   */
  includeProfiles?: boolean;
};

/** In-memory cache so RoleSelect can paint the CTA immediately on re-entry. */
let joinedGroupsCache: JoinedGroupInfo[] | null = null;
let joinedGroupsCacheUserId: string | null = null;

/** Disk cache of avatar emoji/color per group — survives cold start. */
export function joinedGroupAvatarsKey(userId: string): string {
  return `@hither/joined-group-avatars:${userId}`;
}

type AvatarDiskCache = Record<string, { userId?: string; avatar?: string; avatarColor?: string }[]>;

async function readAvatarDiskCache(userId: string): Promise<AvatarDiskCache> {
  try {
    const raw = await AsyncStorage.getItem(joinedGroupAvatarsKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as AvatarDiskCache;
  } catch {
    return {};
  }
}

async function writeAvatarDiskCache(userId: string, cache: AvatarDiskCache): Promise<void> {
  try {
    await AsyncStorage.setItem(joinedGroupAvatarsKey(userId), JSON.stringify(cache));
  } catch {
    // Best-effort; cold-start black avatars are recoverable on next full fetch.
  }
}

export function getCachedMyJoinedGroups(userId: string | undefined | null): JoinedGroupInfo[] | null {
  if (!userId || userId !== joinedGroupsCacheUserId) return null;
  return joinedGroupsCache;
}

export function invalidateMyJoinedGroupsCache(): void {
  joinedGroupsCache = null;
  joinedGroupsCacheUserId = null;
}

function rememberJoinedGroups(userId: string, list: JoinedGroupInfo[]): JoinedGroupInfo[] {
  joinedGroupsCacheUserId = userId;
  joinedGroupsCache = list;
  return list;
}

/**
 * Groups the current user belongs to (for RoleSelect / MyTeams).
 * Uses the local session (no auth network hop), parallelizes group+member
 * queries, and caches the last result for instant re-paint.
 */
export async function getMyJoinedGroups(
  options: GetMyJoinedGroupsOptions = {},
): Promise<JoinedGroupInfo[]> {
  const includeProfiles = options.includeProfiles !== false;
  let uid: string;
  try {
    uid = await requireUserId();
  } catch {
    return [];
  }

  const { data: myMemberships } = await supabase
    .from('memberships')
    .select('group_id, role')
    .eq('user_id', uid);

  if (!myMemberships || myMemberships.length === 0) {
    return rememberJoinedGroups(uid, []);
  }

  const groupIds = myMemberships.map((m) => m.group_id);
  const roleByGroup = new Map(myMemberships.map((m) => [m.group_id, m.role as MemberRole]));

  // groups + membership rows in parallel (was sequential before).
  const [groupsRes, membersRes] = await Promise.all([
    supabase
      .from('groups')
      .select('id, name, invite_code, avatar, avatar_color, created_by, created_at, journey_status, active_destination_id, journey_started_at, straggler_alerts, straggler_threshold_m, trip_days, departure_date')
      .in('id', groupIds),
    supabase
      .from('memberships')
      .select('group_id, user_id')
      .in('group_id', groupIds),
  ]);

  const groups = groupsRes.data;
  if (!groups || groups.length === 0) {
    return rememberJoinedGroups(uid, []);
  }

  const members = membersRes.data ?? [];
  const memberCounts = new Map<string, number>();
  for (const m of members) {
    memberCounts.set(m.group_id, (memberCounts.get(m.group_id) ?? 0) + 1);
  }

  const membersByGroup = new Map<string, { userId: string; avatar?: string; avatarColor?: string }[]>();
  const diskAvatars = await readAvatarDiskCache(uid);

  // RoleSelect skips profiles (one less round-trip); MyTeams keeps avatars.
  if (includeProfiles && members.length > 0) {
    const userIdsToFetch = Array.from(new Set(members.map((m) => m.user_id)));
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, avatar, avatar_color')
      .in('id', userIdsToFetch);
    const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]));

    for (const m of members) {
      if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
      const p = profileById.get(m.user_id);
      membersByGroup.get(m.group_id)!.push({
        userId: m.user_id,
        avatar: displayMemberAvatar(p?.avatar, m.user_id, p?.avatar_color).emoji,
        avatarColor: displayMemberAvatar(p?.avatar, m.user_id, p?.avatar_color).color || memberColor(m.user_id),
      });
    }
    // Persist full avatars for next cold start / lite RoleSelect paint.
    const nextDisk: AvatarDiskCache = { ...diskAvatars };
    for (const [gid, profiles] of membersByGroup) {
      nextDisk[gid] = profiles;
    }
    void writeAvatarDiskCache(uid, nextDisk);
  }

  const list = groups.map((g) => {
    const live = membersByGroup.get(g.id) ?? [];
    const cached = diskAvatars[g.id];
    // Lite fetch (no profiles): paint from disk cache so icons are not blank.
    const memberProfiles = includeProfiles
      ? live
      : mergeAvatarProfiles(live, cached);
    return {
      group: mapGroup(g as GroupRow),
      memberCount: memberCounts.get(g.id) ?? 1,
      role: roleByGroup.get(g.id) ?? ('follower' as MemberRole),
      memberProfiles,
    };
  });

  return rememberJoinedGroups(uid, list);
}

export async function leaveGroups(groupIds: string[]): Promise<void> {
  if (!groupIds || groupIds.length === 0) return;
  const uid = await requireUserId();
  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('user_id', uid)
    .in('group_id', groupIds);
  orThrow(error);
  // Drop cache so RoleSelect / MyTeams don't show groups we just left.
  if (joinedGroupsCacheUserId === uid && joinedGroupsCache) {
    const remaining = joinedGroupsCache.filter((g) => !groupIds.includes(g.group.id));
    rememberJoinedGroups(uid, remaining);
  } else {
    invalidateMyJoinedGroupsCache();
  }
}

/**
 * Leader-only atomic kick: removes a follower membership and rotates the
 * group invite code in one SECURITY DEFINER transaction. Returns the new code.
 */
export async function kickGroupMember(
  groupId: string,
  userId: string,
): Promise<string> {
  if (isDemoGroup(groupId)) {
    throw new Error('kick_not_supported_in_demo');
  }
  await requireUserId();
  const { data, error } = await supabase.rpc('kick_group_member', {
    p_group_id: groupId,
    p_user_id: userId,
  });
  orThrow(error);
  if (typeof data !== 'string' || data.length !== 6) {
    throw new Error('kick_group_member_invalid_code');
  }
  invalidateMyJoinedGroupsCache();
  return data;
}

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

export async function setJourneyTarget(
  groupId: string,
  destinationId: string | null,
): Promise<void> {
  if (isDemoGroup(groupId)) {
    demoSetJourneyTarget(destinationId);
    return;
  }
  const { error } = await supabase.rpc('set_journey_target', {
    p_group_id: groupId,
    p_destination_id: destinationId,
  });
  orThrow(error);
}

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

/**
 * Leader-only: fan-out an APNs straggler alert after local distance judgment.
 * No-ops on demo groups. Throws if the caller is not the group leader (RPC).
 */
export async function reportStraggler(
  groupId: string,
  memberId: string,
  distanceM?: number,
): Promise<void> {
  if (isDemoGroup(groupId)) return;
  const { error } = await supabase.rpc('report_straggler', {
    p_group_id: groupId,
    p_member_id: memberId,
    p_distance_m: distanceM ?? null,
  });
  orThrow(error);
}

export async function updateGroupTripDetails(
  groupId: string,
  tripDays: number,
  departureDate: string,
): Promise<void> {
  if (isDemoGroup(groupId)) return;
  const { error } = await supabase
    .from('groups')
    .update({ trip_days: tripDays, departure_date: departureDate })
    .eq('id', groupId);
  orThrow(error);
}

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

export async function selfMerge(groupId: string): Promise<void> {
  if (isDemoGroup(groupId)) {
    demoSelfMerge();
    return;
  }
  const { error } = await supabase.rpc('self_merge', { p_group: groupId });
  orThrow(error);
}
