import type { Coordinates } from './user';

/**
 * A destination / itinerary stop (e.g. gathering point or next stop).
 * Mirrors `ItineraryItem` in the Vapor API (Models/ItineraryItem.swift).
 *
 * `travelDistance` is in meters and `travelTime` in seconds, matching
 * the API's Google Maps Directions fields.
 */
export interface Destination {
  id: string;
  title: string;
  description?: string;
  /** Position within the group's ordered itinerary (0-based). */
  order: number;
  address?: string;
  coordinates: Coordinates;
  googlePlaceID?: string;
  travelDistance?: number;
  travelTime?: number;
  startTime?: string;
  endTime?: string;
}
