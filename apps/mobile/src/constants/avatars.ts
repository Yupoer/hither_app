/**
 * Emoji avatar catalogue + a stable default picker.
 *
 * The `avatar` field on `User` / `MemberLocation` holds a single emoji (never a
 * URL). Both the profile picker (MapScreen) and the login flow (SessionContext)
 * pull from this one list so they never drift apart.
 */
import { memberColor } from '../glass';

/** Selectable avatars. */
export const AVATAR_EMOJI = [
  '🐑', '🐺', '🦊', '🐰', '🐻',
  '🐼', '🐸', '🐥', '🦁', '🐯',
  '🐨', '🐢', '🐙', '🦄', '🐳',
  '🦉', '⭐', '🔥', '🌙', '🍀',
  '🍎', '⚽', '🎧', '🎈', '🐷',
  '🐮', '🐹', '🦋', '🌸', '🍕',
] as const;

/**
 * Selectable avatar background colours (persisted in `profiles.avatar_color`).
 * When unset, the app falls back to the derived `memberColor` / theme accent.
 */
export const AVATAR_COLORS = [
  '#E8543F', '#F0883E', '#F4C13E', '#5FB56A', '#3FB4A6',
  '#4A90D9', '#6A5ACD', '#B565C4', '#E06B9A', '#8A8F99',
] as const;

export const HOME_AVATAR_COLORS = [
  '#E0634A', '#F08A3C', '#F3C443', '#5FB36B',
  '#3FB3A6', '#4A90E2', '#8A6AD9', '#E06A9E',
] as const;

export function isAvatarColor(color: string): boolean {
  return [...AVATAR_COLORS, ...HOME_AVATAR_COLORS].some(option => option === color);
}

/**
 * Pick a default avatar for a user, deterministically from their id — the same
 * user always gets the same emoji, so we can default one at login without
 * persisting it or re-rolling on every sign-in.
 */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function avatarForUser(id: string): string {
  return AVATAR_EMOJI[hashId(id) % AVATAR_EMOJI.length];
}

/** Stable group emoji from the same catalogue. Never use the leader's face. */
export function avatarForGroup(groupId: string): string {
  return AVATAR_EMOJI[hashId(`group:${groupId}`) % AVATAR_EMOJI.length];
}

/** Stable group colour when an older row has no persisted selection. */
export function avatarColorForGroup(groupId: string): string {
  return AVATAR_COLORS[hashId(`group-color:${groupId}`) % AVATAR_COLORS.length];
}

export type DisplayAvatar = {
  emoji: string;
  color: string | undefined;
};

/**
 * Single member-avatar resolver. Known userIds never fall back to initials.
 * Empty / unknown stored emoji uses the deterministic catalogue pick.
 */
export function displayMemberAvatar(
  stored: string | null | undefined,
  userId: string,
  storedColor?: string | null,
): DisplayAvatar {
  const trimmed = typeof stored === 'string' ? stored.trim() : '';
  const known = (AVATAR_EMOJI as readonly string[]).includes(trimmed);
  const color = typeof storedColor === 'string' ? storedColor.trim() : '';
  return {
    emoji: known ? trimmed : avatarForUser(userId),
    color: isAvatarColor(color)
      ? color
      : memberColor(userId),
  };
}
