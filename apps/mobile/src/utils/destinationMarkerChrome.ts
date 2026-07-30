/**
 * Map marker chrome for itinerary destinations (Ticket 07).
 * Pure helpers — safe for unit tests without loading GroupMap / react-native-maps.
 */

import type { Destination } from '../types';
import { DAY_COLORS } from '../theme';
import {
  destinationEmojiDisplay,
  resolveDestinationColor,
} from './destinationEmojiColor';

export function getColorForDay(
  day: number | undefined,
  dayColors: Record<number, string>,
): string {
  if (!day) return dayColors[1] || DAY_COLORS[0];
  return dayColors[day] || DAY_COLORS[(day - 1) % DAY_COLORS.length];
}

/**
 * Marker background: per-stop palette when set; else day-header color so
 * legacy trips keep day differentiation when emoji/color are null.
 * Invalid non-empty hex falls through resolveDestinationColor → stable fallback.
 */
export function destinationMarkerColor(
  dest: Pick<Destination, 'markerColor' | 'day'>,
  dayColors: Record<number, string>,
): string {
  if (dest.markerColor != null && String(dest.markerColor).trim()) {
    return resolveDestinationColor(dest.markerColor);
  }
  return getColorForDay(dest.day, dayColors);
}

export function destinationMarkerEmoji(
  dest: Pick<Destination, 'emoji'>,
): string {
  return destinationEmojiDisplay(dest.emoji);
}
