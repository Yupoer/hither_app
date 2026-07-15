/**
 * Dynamic Type policy for Hither.
 *
 * System text may scale up to {@link GLOBAL_FONT_SCALE_CAP}. Beyond that,
 * RN `maxFontSizeMultiplier` freezes visual size so glass layouts stay usable.
 * Role multipliers never exceed the global cap.
 *
 * App Settings `textScale` (0.8–1.2) multiplies design fontSize and layout
 * chrome only — it is NOT a second system Dynamic Type pass. Emoji avatar
 * glyphs never scale (system or app).
 *
 * iOS Bold Text (and Android high-contrast text) makes glyphs wider without
 * changing fontScale. That width is folded into layout via
 * {@link BOLD_TEXT_LAYOUT_FACTOR} so density buckets kick in earlier — it is
 * never applied to Text fontSize (the OS already bolds the face).
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

/**
 * Absolute ceiling for layout chrome after system × app textScale × bold.
 * Prevents 1.25 × 1.2 × bold-factor from blowing glass minHeights.
 */
export const LAYOUT_SCALE_ABS_CAP = 1.5;

/**
 * Extra layout pressure when system Bold Text / high-contrast text is on.
 * ~12% is enough that default size + bold lands in the `large` density
 * bucket (threshold 1.1), so glass chrome switches to compact/icon-only
 * before labels clip. Used only for chrome scale + density buckets — never
 * as Text fontSize (the OS already bolds the face).
 */
export const BOLD_TEXT_LAYOUT_FACTOR = 1.12;

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

/** Fixed avatar shell sizes — never grow with Dynamic Type or app textScale. */
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
 * Layout scale = capped(system) × app textScale × optional bold factor,
 * hard-capped at {@link LAYOUT_SCALE_ABS_CAP}.
 *
 * Do not use this product as Text fontSize when allowFontScaling is also on
 * (would double-apply system scale). Bold factor is layout-only.
 */
export function layoutFontScale(
  systemScale: number,
  textScale = 1,
  boldText = false,
): number {
  const user =
    Number.isFinite(textScale) && textScale > 0 ? textScale : 1;
  const bold = boldText ? BOLD_TEXT_LAYOUT_FACTOR : 1;
  const product = cappedFontScale(systemScale) * user * bold;
  return Math.min(product, LAYOUT_SCALE_ABS_CAP);
}

/**
 * Map layout scale → structural density variant.
 * Prefer the full layout scale (system × app textScale × bold) so Bold Text
 * and small app text sizes shift chrome density correctly.
 * Buckets still work on raw system scale for unit tests.
 */
export function fontScaleBucket(scale: number): FontScaleBucket {
  const s = Math.min(
    Number.isFinite(scale) && scale > 0 ? scale : 1,
    LAYOUT_SCALE_ABS_CAP,
  );
  // Thresholds align with pre-user-scale system buckets when textScale=1, bold off.
  if (s < 1.1) return 'regular';
  if (s < 1.2) return 'large';
  return 'xl';
}
