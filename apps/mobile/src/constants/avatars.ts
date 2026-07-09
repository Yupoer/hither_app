/**
 * Emoji avatar catalogue + a stable default picker.
 *
 * The `avatar` field on `User` / `MemberLocation` holds a single emoji (never a
 * URL). Both the profile picker (MapScreen) and the login flow (SessionContext)
 * pull from this one list so they never drift apart.
 */

/** Selectable avatars — 30 emoji, rendered as a 5-column × 6-row grid. */
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

/**
 * Pick a default avatar for a user, deterministically from their id — the same
 * user always gets the same emoji, so we can default one at login without
 * persisting it or re-rolling on every sign-in.
 */
export function avatarForUser(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_EMOJI[h % AVATAR_EMOJI.length];
}
