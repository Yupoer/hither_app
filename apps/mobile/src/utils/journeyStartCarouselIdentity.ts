import type { Destination } from '../types';
import { promoteDestinationWithinDay } from './tripDay';

/**
 * Carousel page offset. Card width is the window width (paging-aligned).
 */
export function carouselScrollX(index: number, windowWidth: number): number {
  return Math.max(0, index) * windowWidth;
}

/**
 * Follow/start selection is dest-id identity. Do not write an index from a
 * pre-promote order — wait until the visible list already matches the same-day
 * promote result, then return that dest's index (0 when it is first of the
 * first visible day).
 */
export function followCarouselIndexAfterPromote({
  destinations,
  sharedTargetId,
}: {
  destinations: ReadonlyArray<Pick<Destination, 'id' | 'day' | 'order'>>;
  sharedTargetId: string;
}): number | null {
  if (!sharedTargetId || destinations.length === 0) return null;
  const asDestinations = destinations as Destination[];
  const promoted = promoteDestinationWithinDay(asDestinations, sharedTargetId);
  const settled =
    promoted.length === destinations.length
    && promoted.every((item, index) => item.id === destinations[index]?.id);
  if (!settled) return null;
  const index = destinations.findIndex((item) => item.id === sharedTargetId);
  return index >= 0 ? index : null;
}
