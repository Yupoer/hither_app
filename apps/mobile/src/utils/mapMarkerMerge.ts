/**
 * Merge daily accommodation markers with itinerary destination markers.
 * Gathering stops always win over daily bed pins at the same place so setting
 * stay from a stop never hides that gathering point on the map.
 * Multi-day stays at the same coordinates still each get a bed marker when no
 * stop occupies that day+coords slot.
 */

import type { Coordinates, Destination } from '../types';
import { coordinateDedupeKey } from './placeIdentity';

export type MapMarkerKind = 'destination' | 'daily_accommodation';

export interface MapMarkerInput {
  id: string;
  title: string;
  coordinates: Coordinates;
  kind: MapMarkerKind;
  /** Destination / stay day (1-based). */
  day?: number;
  emoji?: string | null;
  markerColor?: string | null;
  /** When daily accommodation was copied from a destination id. */
  sourceDestinationId?: string | null;
}

export type DailyAccommodationMarker = {
  id: string;
  title: string;
  coordinates: Coordinates;
  sourceDestinationId?: string | null;
  /** Trip day for bed marker color / callout (1-based). */
  day?: number;
};

function isBedKind(kind: MapMarkerKind, destKind?: string | null): boolean {
  if (kind === 'daily_accommodation') return true;
  return destKind === 'accommodation';
}

/** Dedupe key: same coords on different days keep separate markers. */
function markerSlotKey(coords: Coordinates, day?: number): string {
  const coord = coordinateDedupeKey(coords);
  if (typeof day === 'number' && day > 0) return `${coord}|d${day}`;
  return coord;
}

function bedPriority(marker: MapMarkerInput): number {
  // Higher wins when upgrading a slot.
  if (marker.kind === 'daily_accommodation') return 3;
  if (marker.emoji === '🛏️') return 2;
  return 1;
}

/**
 * Build display markers for the map.
 * - All itinerary destinations are included (stops never suppressed by stay).
 * - Daily bed markers fill empty day+coords slots, or upgrade accommodation cards.
 * - Same hotel across days → one bed per day when no stop claims the slot.
 */
export function mergeMapMarkers(input: {
  destinations: readonly Destination[];
  /** @deprecated Prefer dailyAccommodations array. */
  dailyAccommodation?: DailyAccommodationMarker | null;
  dailyAccommodations?: readonly DailyAccommodationMarker[] | null;
}): MapMarkerInput[] {
  const dailies: DailyAccommodationMarker[] = [];
  if (input.dailyAccommodations?.length) {
    dailies.push(...input.dailyAccommodations);
  } else if (input.dailyAccommodation) {
    dailies.push(input.dailyAccommodation);
  }

  // slotKey → marker (upgrade in place when bed beats stop-less slot)
  const bySlot = new Map<string, MapMarkerInput>();
  const identityTaken = new Set<string>();

  const consider = (
    marker: MapMarkerInput,
    destKind?: string | null,
  ) => {
    if (identityTaken.has(marker.id)) return;

    const slot = markerSlotKey(marker.coordinates, marker.day);
    const existing = bySlot.get(slot);
    const incomingBed = isBedKind(marker.kind, destKind);
    const existingBed = existing
      ? isBedKind(existing.kind, existing.emoji === '🛏️' ? 'accommodation' : null)
      : false;
    const existingIsStop =
      existing != null
      && existing.kind === 'destination'
      && existing.emoji !== '🛏️';
    const incomingIsStop =
      marker.kind === 'destination' && !incomingBed;

    if (!existing) {
      bySlot.set(slot, marker);
      identityTaken.add(marker.id);
      return;
    }

    // Gathering stops always keep the pin — daily bed never hides them.
    if (existingIsStop && incomingBed) {
      return;
    }
    if (incomingIsStop && existingBed) {
      identityTaken.delete(existing.id);
      bySlot.set(slot, marker);
      identityTaken.add(marker.id);
      return;
    }

    // Upgrade empty/other → accommodation card bed.
    if (incomingBed && !existingBed) {
      identityTaken.delete(existing.id);
      bySlot.set(slot, marker);
      identityTaken.add(marker.id);
      return;
    }

    // Same bed tier: prefer higher priority / keep first daily.
    if (incomingBed && existingBed) {
      if (bedPriority(marker) > bedPriority(existing)) {
        identityTaken.delete(existing.id);
        bySlot.set(slot, marker);
        identityTaken.add(marker.id);
      }
      return;
    }

    // Non-bed when bed already occupies slot (and existing is not a stop): drop.
    if (!incomingBed && existingBed) return;
  };

  // Destinations first so gathering stops claim slots before daily beds.
  for (const dest of input.destinations) {
    consider(
      {
        id: dest.id,
        title: dest.title,
        coordinates: dest.coordinates,
        kind: 'destination',
        day: dest.day,
        emoji: dest.kind === 'accommodation' ? '🛏️' : dest.emoji,
        markerColor: dest.markerColor,
      },
      dest.kind,
    );
  }

  for (const daily of dailies) {
    consider({
      id: `daily:${daily.id}`,
      title: daily.title,
      coordinates: daily.coordinates,
      kind: 'daily_accommodation',
      day: daily.day,
      sourceDestinationId: daily.sourceDestinationId ?? null,
    });
  }

  return [...bySlot.values()];
}
