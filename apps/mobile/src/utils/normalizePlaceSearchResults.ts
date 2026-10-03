import type { PlaceResult } from '../native/maps';

/** Provider identity stays intact; list identity also distinguishes its locations. */
export function placeSearchResultKey(place: PlaceResult): string {
  return JSON.stringify([place.id, place.coordinates.latitude, place.coordinates.longitude]);
}

export function normalizePlaceSearchResults(results: readonly PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const unique: PlaceResult[] = [];
  for (const place of results) {
    const searchResultKey = placeSearchResultKey(place);
    if (seen.has(searchResultKey)) continue;
    seen.add(searchResultKey);
    unique.push(place);
  }
  return unique;
}
