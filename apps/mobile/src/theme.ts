/**
 * Hither MVP v1 visual tokens.
 *
 * Night + lantern theme from the design baseline ("Hither MVP v1 design"):
 * dark canvas, amber lantern accent. Not a full design system — just the
 * handful of tokens the MVP screens share.
 */
export const colors = {
  /** App background — deep night blue. */
  background: '#0E1320',
  /** Slightly raised surfaces (cards, inputs). */
  surface: '#1A2236',
  /** Frosted-glass card over the map. */
  glass: 'rgba(26, 34, 54, 0.92)',
  border: '#2A3450',
  /** Lantern amber — primary accent / CTA. */
  accent: '#F5B142',
  accentText: '#1A1206',
  textPrimary: '#F5F7FB',
  textSecondary: '#9AA6BF',
  danger: '#E5575C',
  leader: '#F5B142',
  follower: '#6FA8FF',
} as const;

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
