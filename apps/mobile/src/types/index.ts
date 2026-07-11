/**
 * Domain types shared across the app.
 *
 * These are the camelCase shapes the UI consumes; `api/client.ts` maps the
 * DB's snake_case rows into them (single seam between data layer and UI).
 */

/** Shared geographic coordinate. */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * The signed-in user. Auth is Supabase anonymous sign-in: `id` is the
 * Supabase `auth.uid()` and `name` is the anonymous nickname (per the MVP
 * design). `email` is unused in the anonymous flow but kept for the sign-in
 * input shape.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  /** Emoji avatar shown to other members (persisted in `profiles.avatar`). */
  avatar?: string;
  /** Avatar background colour hex (persisted in `profiles.avatar_color`). */
  avatarColor?: string;
  /** Account creation timestamp (from auth.users / profiles) */
  createdAt?: string;
  /** The authentication provider used (e.g. 'google', 'email', 'anonymous') */
  provider?: string;
  /** Name of the current pro plan, if applicable */
  proPlan?: string;
  /** Timestamp when pro was purchased/upgraded */
  proPurchasedAt?: string;
  /** Timestamp when pro expires, if applicable */
  proExpiresAt?: string;
}

/**
 * Whether the group is actively heading to the gathering point.
 * The leader toggles this (start/pause); when 'going' each member's app shows
 * a Live Activity. Persisted in `groups.journey_status`.
 */
export type JourneyStatus = 'going' | 'paused';

/**
 * A travel group. `inviteCode` is the 6-character "group code" users type to
 * join (uppercase letters/digits, ambiguous chars removed).
 */
export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  createdBy: string;
  createdAt?: string;
  /** Leader-controlled journey state; defaults to 'paused'. */
  journeyStatus: JourneyStatus;
  /** Straggler alerts on/off (leader-controlled). */
  stragglerAlerts: boolean;
  /** Distance in metres beyond which a member counts as a straggler. */
  stragglerThresholdM: number;
  /** Number of days for the trip (used for grouping destinations). */
  tripDays?: number;
  /** Start date of the trip (ISO-8601). */
  departureDate?: string;
}

/** Role within a group. */
export type MemberRole = 'leader' | 'follower';

/** A group member together with their latest location. */
export interface MemberLocation {
  userId: string;
  /** Anonymous nickname, per the MVP design. */
  name: string;
  role: MemberRole;
  /** Emoji avatar; falls back to the name's initial when unset. */
  avatar?: string;
  /** Avatar background colour hex (persisted in `profiles.avatar_color`). */
  avatarColor?: string;
  /** Solo mode: temporarily detached from the flock (no group notifications). */
  solo?: boolean;
  /** Leaf subgroup the member currently belongs to, if any. */
  subgroupId?: string;
  coordinates?: Coordinates;
  /** ISO-8601 timestamp of the last location update. */
  lastUpdated?: string;
}

/** Subgroup mode: led by a sub-leader, or leaderless collaboration. */
export type SubgroupMode = 'led' | 'collab';

/**
 * A subgroup ("小隊") split off the main group. Subgroups nest — `parentId`
 * points at the enclosing subgroup (undefined = directly under the group) —
 * and merge back one level at a time. Members sit on leaf subgroups via
 * `MemberLocation.subgroupId`. Minimum 2 members (one person = Solo mode).
 */
export interface Subgroup {
  id: string;
  name: string;
  mode: SubgroupMode;
  /** Sub-leader (only for mode 'led'). */
  leaderId?: string;
  parentId?: string;
}

/** Lifecycle of a subgroup invite. */
export type SubgroupInviteStatus = 'pending' | 'accepted' | 'declined';

/**
 * An invite to join a subgroup ("小隊"). Forming a ≥2-person team is
 * invite-driven: a team member invites someone, who accepts to move in.
 * Backed by `public.subgroup_invites`; writes go through SECURITY DEFINER
 * RPCs (invite/accept/decline), never a direct table write.
 */
export interface SubgroupInvite {
  id: string;
  groupId: string;
  subgroupId: string;
  inviterId: string;
  inviteeId: string;
  status: SubgroupInviteStatus;
  createdAt?: string;
}

/** A pending invite enriched with display names for the accept/decline card. */
export interface PendingInvite extends SubgroupInvite {
  subgroupName: string;
  inviterName: string;
  /**
   * Direction of the pending row from the viewer's side:
   * - 'invite'  — someone invited ME to their team; I accept to join (default).
   * - 'request' — someone wants to join MY team; I approve to let them in.
   * Used to pick the prompt/button wording. Demo simulates 'request'.
   */
  kind?: 'invite' | 'request';
}

/**
 * A gathering point the user has actually reached, kept for the "歷史行程"
 * list (grouped by day, sorted by time). Personal — not scoped to a group.
 */
export interface VisitedWaypoint {
  id: string;
  name: string;
  coordinates: Coordinates;
  /** ISO-8601 timestamp of arrival. */
  arrivedAt: string;
}

/** A gathering point / itinerary stop. */
export interface Destination {
  id: string;
  title: string;
  /** Position within the group's ordered itinerary (0-based). */
  order: number;
  /** Which day of the trip this destination belongs to (1-based). */
  day: number;
  address?: string;
  coordinates: Coordinates;
  /** ISO-8601 target time to gather, set by the leader. Optional. */
  meetAt?: string;
  /** Owning subgroup's list; undefined = the main group's itinerary. */
  subgroupId?: string;
}

/** Aggregated live view of a group, consumed by the Map screen. */
export interface GroupState {
  group: Group;
  members: MemberLocation[];
  destinations: Destination[];
  /** Subgroups split off the group (empty when the flock is whole). */
  subgroups: Subgroup[];
  /** The destination the group is currently heading to, if any. */
  nextDestination?: Destination;
}

/**
 * Group commands: leader directives + follower quick requests. Kept as a
 * typed union so call sites and the DB `check` constraint stay in lockstep
 * (the server-side set lives in the `commands` table's `type` check,
 * migration 20260619000000). UI labels resolve through i18n (`command.<type>`).
 */
export const LEADER_COMMANDS = [
  'gather',
  'find_gathering',
  'depart',
  'rest',
  'be_careful',
  'go_left',
  'go_right',
  'stop',
  'hurry_up',
] as const;

export const FOLLOWER_COMMANDS = [
  'need_restroom',
  'need_break',
  'need_help',
  'found_something',
] as const;

export type CommandType =
  | (typeof LEADER_COMMANDS)[number]
  | (typeof FOLLOWER_COMMANDS)[number];

/** True if the command is a leader directive (vs a follower request). */
export function isLeaderCommand(type: CommandType): boolean {
  return (LEADER_COMMANDS as readonly string[]).includes(type);
}

/**
 * Per-category notification preferences. Stored server-side
 * (`notification_preferences`) — the APNs Edge Function filters recipients by
 * these flags, so "should this user get this push" is authoritative there.
 */
export interface NotificationPreferences {
  addGathering: boolean;
  leaderCommands: boolean;
  followerRequests: boolean;
  journey: boolean;
}

export type NotificationCategory = keyof NotificationPreferences;

/** Defaults when the user has no stored row yet: everything on. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  addGathering: true,
  leaderCommands: true,
  followerRequests: true,
  journey: true,
};
