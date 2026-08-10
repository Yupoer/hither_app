/**
 * Merge daily accommodation markers with itinerary destination markers.
 * Dedupe: identity (destination id / accommodation source id) first,
 * then normalized coordinates.
 */

import type { Coordinates, Destination } from '../types';
import { coordinateDedupeKey } from './placeIdentity';

export type MapMarkerKind = 'destination' | 'daily_accommodation';

export interface MapMarkerInput {
  id: string;
  title: string;
  coordinates: Coordinates;
  kind: MapMarkerKind;
  /** Destination day when kind=destination. */
  day?: number;
  emoji?: string | null;
  markerColor?: string | null;
  /** When daily accommodation was copied from a destination id. */
  sourceDestinationId?: string | null;
}

/**
 * Build display markers for a single map day (or all-days overview).
 * Daily accommodation always wins a slot when present; itinerary markers
 * that share identity or coordinates are suppressed.
 */
export function mergeMapMarkers(input: {
  destinations: readonly Destination[];
  dailyAccommodation?: {
    id: string;
    title: string;
    coordinates: Coordinates;
    sourceDestinationId?: string | null;
    /** Trip day for bed marker color / callout (1-based). */
    day?: number;
  } | null;
}): MapMarkerInput[] {
  const out: MapMarkerInput[] = [];
  const seenIdentity = new Set<string>();
  const seenCoords = new Set<string>();

  const push = (marker: MapMarkerInput) => {
    if (seenIdentity.has(marker.id)) return;
    if (
      marker.sourceDestinationId
      && seenIdentity.has(marker.sourceDestinationId)
    ) {
      return;
    }
    const coordKey = coordinateDedupeKey(marker.coordinates);
    if (seenCoords.has(coordKey)) return;
    seenIdentity.add(marker.id);
    if (marker.sourceDestinationId) {
      seenIdentity.add(marker.sourceDestinationId);
    }
    seenCoords.add(coordKey);
    out.push(marker);
  };

  if (input.dailyAccommodation) {
    const daily = input.dailyAccommodation;
    push({
      id: `daily:${daily.id}`,
      title: daily.title,
      coordinates: daily.coordinates,
      kind: 'daily_accommodation',
      day: daily.day,
      sourceDestinationId: daily.sourceDestinationId ?? null,
    });
  }

  for (const dest of input.destinations) {
    push({
      id: dest.id,
      title: dest.title,
      coordinates: dest.coordinates,
      kind: 'destination',
      day: dest.day,
      emoji: dest.emoji,
      markerColor: dest.markerColor,
    });
  }

  return out;
}
