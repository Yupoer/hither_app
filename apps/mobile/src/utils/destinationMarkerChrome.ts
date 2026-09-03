/**
 * Map marker chrome for itinerary destinations (Ticket 07).
 * Pure helpers — safe for unit tests without loading GroupMap / react-native-maps.
 *
 * Flag background is day-scoped only (day header "更換顏色"). Per-stop
 * `markerColor` is legacy and ignored for display.
 */

import type { Destination } from '../types';
import { DAY_COLORS } from '../theme';
import { destinationEmojiDisplay } from './destinationEmojiColor';

export function getColorForDay(
  day: number | undefined,
  dayColors: Record<number, string>,
): string {
  if (!day) return dayColors[1] || DAY_COLORS[0];
  return dayColors[day] || DAY_COLORS[(day - 1) % DAY_COLORS.length];
}

/**
 * Marker background is always scoped to the trip day. `markerColor` remains
 * accepted in the persisted shape for backwards compatibility, but is a
 * legacy per-stop value and must not override a day-color change.
 */
export function destinationMarkerColor(
  dest: Pick<Destination, 'markerColor' | 'day'>,
  dayColors: Record<number, string>,
): string {
  void dest.markerColor;
  return getColorForDay(dest.day, dayColors);
}

/** Bed icon for daily stay / accommodation cards on the map. */
export const STAY_MARKER_EMOJI = '🛏️';

export function destinationMarkerEmoji(
  dest: Pick<Destination, 'emoji' | 'kind'>,
): string {
  if (dest.kind === 'accommodation') return STAY_MARKER_EMOJI;
  return destinationEmojiDisplay(dest.emoji);
}

/** Callout description: "Day N · 住宿" / "Day N · Stay". */
export function stayMarkerDescription(
  day: number | undefined,
  stayLabel: string,
): string {
  const d = Math.max(1, day || 1);
  return `Day ${d} · ${stayLabel}`;
}
