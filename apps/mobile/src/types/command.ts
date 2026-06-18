/**
 * Group commands: leader directives + follower quick requests.
 *
 * Ported from the legacy SwiftUI `CommandType` enum (see
 * docs/legacy-ios-reference.md). Kept as a typed union (never stringly-typed)
 * so call sites and the DB `check` constraint stay in lockstep. The matching
 * server-side set lives in the `commands` table's `type` check
 * (migration 20260619000000).
 *
 * UI labels / default messages are NOT stored here — they resolve through i18n
 * (`command.<type>` / `command.<type>.msg`) so both languages stay in one place.
 */

/** Directives only the leader can send. */
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

/** Quick requests a follower can send. */
export const FOLLOWER_COMMANDS = [
  'need_restroom',
  'need_break',
  'need_help',
  'found_something',
] as const;

export type LeaderCommandType = (typeof LEADER_COMMANDS)[number];
export type FollowerCommandType = (typeof FOLLOWER_COMMANDS)[number];
export type CommandType = LeaderCommandType | FollowerCommandType;

/** A short emoji glyph per command, for the Settings quick-button grid. */
export const COMMAND_ICON: Record<CommandType, string> = {
  gather: '🧲',
  find_gathering: '📍',
  depart: '🚶',
  rest: '☕️',
  be_careful: '⚠️',
  go_left: '⬅️',
  go_right: '➡️',
  stop: '✋',
  hurry_up: '⏩',
  need_restroom: '🚻',
  need_break: '😮‍💨',
  need_help: '🆘',
  found_something: '🔎',
};

/** True if the command is a leader directive (vs a follower request). */
export function isLeaderCommand(type: CommandType): boolean {
  return (LEADER_COMMANDS as readonly string[]).includes(type);
}
