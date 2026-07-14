/**
 * Dynamic Type policy for Hither.
 *
 * System text may scale up to {@link GLOBAL_FONT_SCALE_CAP}. Beyond that,
 * RN `maxFontSizeMultiplier` freezes visual size so glass layouts stay usable.
 * Role multipliers never exceed the global cap.
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

/**
 * Hard ceiling for ALL Text / TextInput (App.tsx defaultProps).
 * Within 1…this, type scales with the system; above system scale is ignored.
 */
export const GLOBAL_FONT_SCALE_CAP = 1.25;

/** Per-role caps (always ≤ GLOBAL_FONT_SCALE_CAP). */
export const TYPE_MAX_MULTIPLIER: Record<TypeRole, number> = {
  display: 1.15,
  title: 1.2,
  body: GLOBAL_FONT_SCALE_CAP,
  callout: GLOBAL_FONT_SCALE_CAP,
  footnote: 1.2,
  caption: 1.15,
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

/** Effective scale used for layout — never above the global text cap. */
export function cappedFontScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(scale, GLOBAL_FONT_SCALE_CAP);
}

/**
 * Map system fontScale → layout variant.
 * Uses capped scale so layout matches what Text actually renders.
 */
export function fontScaleBucket(scale: number): FontScaleBucket {
  const s = cappedFontScale(scale);
  if (s < 1.1) return 'regular';
  if (s < 1.2) return 'large';
  return 'xl';
}
