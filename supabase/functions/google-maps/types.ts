export type TravelMode = "walk" | "drive" | "transit";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface PlaceResult {
  id: string;
  name: string;
  address?: string;
  coordinates: Coordinates;
}

export interface DirectionsRoute {
  distanceMeters: number;
  expectedTravelTimeSeconds: number;
  encodedPolyline: string;
}

export type GoogleMapsRequest =
  | {
    action: "search";
    query: string;
    region?: MapRegion;
    languageCode: "zh-TW";
  }
  | {
    action: "route";
    from: Coordinates;
    to: Coordinates;
    travelMode: TravelMode;
  };

export type GoogleMapsResponse =
  | { action: "search"; places: PlaceResult[] }
  | { action: "route"; route: DirectionsRoute | null }
  | { error: "quota_exceeded" | "invalid_input" | "upstream_unavailable" };

/** Places field mask — only fields Hither displays. */
export const PLACES_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location";

/** Routes field mask — geometry + timing only. */
export const ROUTES_FIELD_MASK =
  "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline";

export const SEARCH_DAILY_LIMIT = 100;
export const ROUTE_DAILY_LIMIT = 100;
export const MAX_QUERY_LENGTH = 200;
