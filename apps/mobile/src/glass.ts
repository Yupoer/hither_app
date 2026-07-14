/**
 * Dark "Liquid Glass" chrome tokens for the new Hither iOS Flow design.
 *
 * The map underneath is themeable (night / dusk / day — see theme.ts), but the
 * glass chrome that floats over it (the pull-up sheet, Dynamic Island, group
 * pill, gathering-point carousel and the stacked overlays) is ALWAYS a dark,
 * translucent material, exactly like Apple Maps. These constants capture that
 * material so every surface reads the same values.
 *
 * The amber accent is NOT baked in here — it comes from the active theme's
 * `colors.accent` so the Settings "map theme" picker still tints the UI (night
 * is the design's `#F5B142`). Call sites pass `accent` where the design uses it.
 */

export const glass = {
  /** Bottom sheet body — translucent so the map reads through (Apple Maps feel). */
  sheet: 'rgba(30, 32, 38, 0.48)',
  /** Stacked overlay sheet (search / route / settings) — more opaque. */
  overlay: 'rgba(22, 26, 34, 0.9)',
  /** Sheet header veil — thin, so content visibly blurs through beneath it. */
  headerVeil: 'rgba(22, 26, 34, 0.35)',
  /** Floating pills (group pill, role chip, recenter, FABs). */
  // ≥0.85 so liquidGlass underlayForTint uses full tint (not half-alpha wash).
  // BUG-24: near-opaque so light system map / sky doesn't show through.
  pill: 'rgba(40, 44, 52, 0.9)',
  /** Carousel card, inactive. Near-opaque so the card reads over any map. */
  card: 'rgba(28, 32, 40, 0.9)',
  /** Carousel card, active (selected stop). */
  cardActive: 'rgba(38, 44, 54, 0.94)',
  /** Inset list / button fill. */
  fill: 'rgba(255, 255, 255, 0.07)',
  /** Stronger inset fill (secondary buttons). */
  fillStrong: 'rgba(255, 255, 255, 0.1)',
  /** Hairline separators / borders on glass. */
  hairline: 'rgba(255, 255, 255, 0.14)',
  /** Soft hairline for sheet shells (BUG-10) — barely visible, no white halo. */
  hairlineSoft: 'rgba(255, 255, 255, 0.06)',
  /** Brighter hairline (overlay top edge, active fields). */
  hairlineStrong: 'rgba(255, 255, 255, 0.22)',
  /** Dim scrim behind a raised overlay. */
  scrim: 'rgba(4, 7, 12, 0.5)',
  /** Grabber handle. */
  grabber: 'rgba(255, 255, 255, 0.32)',

  // Text on the dark glass (theme-independent — always light).
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(235, 235, 245, 0.6)',
  textTertiary: 'rgba(235, 235, 245, 0.45)',

  /** Destructive action colour on glass. */
  danger: '#FF6B6B',
  /** "Arrived" / positive status. */
  ok: '#5FD08A',
  /** "Falling behind" / warning status. */
  warn: '#FF9F6B',
} as const;

/** Deterministic member-pin / avatar colours from the design. */
export const MEMBER_COLORS = ['#2a3450', '#34507a', '#4a3a6a', '#6a4a3a'] as const;

/** Pick a stable colour for a member by id/index (design's avatar palette). */
export function memberColor(seed: string, fallbackIndex = 0): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const idx = seed.length ? h % MEMBER_COLORS.length : fallbackIndex % MEMBER_COLORS.length;
  return MEMBER_COLORS[idx];
}

/** color-mix(in srgb, accent X%, transparent) — the design's translucent amber fills. */
export function accentMix(accent: string, pct: number): string {
  const hex = accent.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${(pct / 100).toFixed(3)})`;
}

/**
 * Shift a hex colour toward white (amt > 0) or black (amt < 0), amt in -1..1.
 * Used to derive a deep→light gradient from a single accent token so the
 * onboarding progress bar stays theme-driven instead of hard-coding green.
 */
export function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const to = amt < 0 ? 0 : 255;
  const p = Math.min(1, Math.abs(amt));
  const mix = (c: number) => Math.round(c + (to - c) * p);
  const r = mix(parseInt(h.slice(0, 2), 16));
  const g = mix(parseInt(h.slice(2, 4), 16));
  const b = mix(parseInt(h.slice(4, 6), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
