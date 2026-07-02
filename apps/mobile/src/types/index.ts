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
  /** Solo mode: temporarily detached from the flock (no group notifications). */
  solo?: boolean;
  coordinates?: Coordinates;
  /** ISO-8601 timestamp of the last location update. */
  lastUpdated?: string;
}

/** A gathering point / itinerary stop. */
export interface Destination {
  id: string;
  title: string;
  /** Position within the group's ordered itinerary (0-based). */
  order: number;
  address?: string;
  coordinates: Coordinates;
}

/** Aggregated live view of a group, consumed by the Map screen. */
export interface GroupState {
  group: Group;
  members: MemberLocation[];
  destinations: Destination[];
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
