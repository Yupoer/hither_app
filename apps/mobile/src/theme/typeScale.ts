/**
 * Dynamic Type roles for Hither.
 *
 * System font scale is allowed (true accessibility), but each role has a
 * multiplier cap so glass layouts stay usable. Emoji avatars never scale —
 * their shell owns layout size.
 */

export type TypeRole =
  | 'display' // Fredoka titles / heroes
  | 'title' // section / card titles
  | 'body'
  | 'callout'
  | 'footnote'
  | 'caption'
  | 'metric' // ETA / distance numerals
  | 'emoji'; // avatar glyphs — no scaling

/** Cap relative to design-token fontSize (iOS Accessibility largest ≈ this). */
export const TYPE_MAX_MULTIPLIER: Record<TypeRole, number> = {
  display: 1.2,
  title: 1.25,
  body: 1.3,
  callout: 1.3,
  footnote: 1.25,
  caption: 1.2,
  metric: 1.15,
  emoji: 1.0,
};

/** Design-token base sizes (px) — aligned to DS typography. */
export const TYPE_BASE: Record<TypeRole, number> = {
  display: 34,
  title: 19,
  body: 16,
  callout: 15,
  footnote: 13,
  caption: 11,
  metric: 34,
  emoji: 16,
};

/** Fixed avatar shell sizes — never grow with Dynamic Type. */
export const AVATAR_SIZE = {
  sm: 32,
  md: 40,
  lg: 48,
} as const;

export type FontScaleBucket = 'regular' | 'large' | 'xl';

/** Map system fontScale → layout variant. */
export function fontScaleBucket(scale: number): FontScaleBucket {
  if (scale < 1.15) return 'regular';
  if (scale < 1.35) return 'large';
  return 'xl';
}
