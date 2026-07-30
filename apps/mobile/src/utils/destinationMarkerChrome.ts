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
 * Marker background: always the trip-day color so changing a day color
 * updates every flag that day. Per-stop markerColor is not used for UI.
 */
export function destinationMarkerColor(
  dest: Pick<Destination, 'markerColor' | 'day'>,
  dayColors: Record<number, string>,
): string {
  return getColorForDay(dest.day, dayColors);
}

export function destinationMarkerEmoji(
  dest: Pick<Destination, 'emoji'>,
): string {
  return destinationEmojiDisplay(dest.emoji);
}
