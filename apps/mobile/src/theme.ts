/**
 * Hither MVP v1 visual tokens.
 *
 * Night + lantern theme from the design baseline ("Hither MVP v1 design").
 * The palette is now selectable at runtime (Settings → 主題背景): the same set
 * of semantic tokens is provided by several named {@link Palette}s, and screens
 * read the active one via `useTheme()` (see state/PreferencesContext).
 *
 * `spacing` and `radius` are theme-independent and stay plain constants.
 */

/** Semantic colour tokens every screen shares. Same keys across all themes. */
export interface Palette {
  /** App background. */
  background: string;
  /** Slightly raised surfaces (cards, inputs). */
  surface: string;
  /** Frosted-glass card over the map (opaque fallback for non-glass devices). */
  glass: string;
  border: string;
  /** Lantern accent / primary CTA. */
  accent: string;
  /** Text drawn on top of `accent`. */
  accentText: string;
  textPrimary: string;
  textSecondary: string;
  danger: string;
  /** Leader pin / role colour. */
  leader: string;
  /** Follower pin / role colour. */
  follower: string;
}

/** Identifiers for the selectable themes. */
export type ThemeName = 'night' | 'day' | 'dusk';

/**
 * The selectable palettes. `night` is the original design baseline and the
 * default; `day` is a light variant; `dusk` is a warmer purple night.
 */
export const themes: Record<ThemeName, Palette> = {
  night: {
    background: '#0E1320',
    surface: '#1A2236',
    glass: 'rgba(26, 34, 54, 0.92)',
    border: '#2A3450',
    accent: '#F5B142',
    accentText: '#1A1206',
    textPrimary: '#F5F7FB',
    textSecondary: '#9AA6BF',
    danger: '#E5575C',
    leader: '#F5B142',
    follower: '#6FA8FF',
  },
  day: {
    background: '#F7F5F0',
    surface: '#FFFFFF',
    glass: 'rgba(255, 255, 255, 0.92)',
    border: '#E3DDD1',
    accent: '#E0912B',
    accentText: '#FFFFFF',
    textPrimary: '#1B2030',
    textSecondary: '#5B6478',
    danger: '#C8434A',
    leader: '#E0912B',
    follower: '#2F6FD0',
  },
  dusk: {
    background: '#15101F',
    surface: '#241B33',
    glass: 'rgba(36, 27, 51, 0.92)',
    border: '#3A2D52',
    accent: '#F08FB0',
    accentText: '#2A0A16',
    textPrimary: '#F4EEFB',
    textSecondary: '#B0A3C8',
    danger: '#E5707A',
    leader: '#F08FB0',
    follower: '#8FB8FF',
  },
};

/** Default palette / order shown in the theme picker. */
export const DEFAULT_THEME: ThemeName = 'night';
export const THEME_ORDER: ThemeName[] = ['night', 'day', 'dusk'];

/**
 * Back-compat static palette (the default theme). Modules that render outside a
 * React tree, or that have not been converted to `useTheme()`, can keep using
 * `colors.*`; converted screens read the live palette from the hook instead.
 */
export const colors = themes[DEFAULT_THEME];

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;
