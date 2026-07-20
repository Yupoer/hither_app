import {
  type Coordinates,
  type DirectionsRoute,
  type GoogleMapsRequest,
  type MapRegion,
  type PlaceResult,
  type TravelMode,
  MAX_QUERY_LENGTH,
  PLACES_FIELD_MASK,
  ROUTES_FIELD_MASK,
} from "./types.ts";

export { PLACES_FIELD_MASK, ROUTES_FIELD_MASK };

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isValidCoords(c: unknown): c is Coordinates {
  if (!c || typeof c !== "object") return false;
  const { latitude, longitude } = c as Coordinates;
  return (
    isFiniteNumber(latitude) &&
    isFiniteNumber(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function isValidRegion(r: unknown): r is MapRegion {
  if (!r || typeof r !== "object") return false;
  const region = r as MapRegion;
  return (
    isValidCoords(region) &&
    isFiniteNumber(region.latitudeDelta) &&
    isFiniteNumber(region.longitudeDelta) &&
    region.latitudeDelta > 0 &&
    region.longitudeDelta > 0
  );
}

const TRAVEL_MODES: TravelMode[] = ["walk", "drive", "transit"];

/**
 * Validate and normalize a client request body.
 * Returns null on invalid input (caller maps to 400 invalid_input).
 */
export function validateRequest(body: unknown): GoogleMapsRequest | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const action = raw.action;

  if (action === "search") {
    if (typeof raw.query !== "string") return null;
    const query = raw.query.trim();
    if (!query || query.length > MAX_QUERY_LENGTH) return null;
    if (raw.region !== undefined && !isValidRegion(raw.region)) return null;
    return {
      action: "search",
      query,
      region: raw.region as MapRegion | undefined,
      languageCode: "zh-TW",
    };
  }

  if (action === "route") {
    if (!isValidCoords(raw.from) || !isValidCoords(raw.to)) return null;
    if (typeof raw.travelMode !== "string") return null;
    if (!TRAVEL_MODES.includes(raw.travelMode as TravelMode)) return null;
    return {
      action: "route",
      from: raw.from,
      to: raw.to,
      travelMode: raw.travelMode as TravelMode,
    };
  }

  return null;
}

function travelModeToGoogle(mode: TravelMode): string {
  switch (mode) {
    case "drive":
      return "DRIVE";
    case "transit":
      return "TRANSIT";
    case "walk":
    default:
      return "WALK";
  }
}

/** Parse Routes API duration strings like `"123s"` into whole seconds. */
export function parseDurationSeconds(duration: unknown): number {
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return Math.max(0, Math.round(duration));
  }
  if (typeof duration === "string") {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(duration.trim());
    if (match) return Math.max(0, Math.round(Number.parseFloat(match[1])));
  }
  return 0;
}

export async function searchPlaces(
  apiKey: string,
  query: string,
  region: MapRegion | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceResult[]> {
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "zh-TW",
    pageSize: 10,
  };
  if (region) {
    body.locationBias = {
      circle: {
        center: {
          latitude: region.latitude,
          longitude: region.longitude,
        },
        // Rough radius from the larger viewport half-span (degrees → meters ~111km).
        radius: Math.max(
          500,
          Math.min(
            50_000,
            Math.max(region.latitudeDelta, region.longitudeDelta) * 111_000 * 0.5,
          ),
        ),
      },
    };
  }

  const res = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`places_upstream_${res.status}`);
  }
  const data = await res.json() as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    }>;
  };

  return (data.places ?? [])
    .map((p, i): PlaceResult | null => {
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
      return {
        id: p.id ?? `place-${i}`,
        name: p.displayName?.text?.trim() || p.formattedAddress || query,
        address: p.formattedAddress,
        coordinates: { latitude: lat, longitude: lng },
      };
    })
    .filter((p): p is PlaceResult => p !== null);
}

export async function computeRoute(
  apiKey: string,
  from: Coordinates,
  to: Coordinates,
  travelMode: TravelMode,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectionsRoute | null> {
  const body: Record<string, unknown> = {
    origin: {
      location: { latLng: { latitude: from.latitude, longitude: from.longitude } },
    },
    destination: {
      location: { latLng: { latitude: to.latitude, longitude: to.longitude } },
    },
    travelMode: travelModeToGoogle(travelMode),
    languageCode: "zh-TW",
  };
  if (travelMode === "drive") {
    body.routingPreference = "TRAFFIC_AWARE";
  }

  const res = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": ROUTES_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`routes_upstream_${res.status}`);
  }
  const data = await res.json() as {
    routes?: Array<{
      distanceMeters?: number;
      duration?: string;
      polyline?: { encodedPolyline?: string };
    }>;
  };
  const route = data.routes?.[0];
  if (!route) return null;
  const encoded = route.polyline?.encodedPolyline;
  if (!encoded) return null;
  return {
    distanceMeters: Math.max(0, Math.round(route.distanceMeters ?? 0)),
    expectedTravelTimeSeconds: parseDurationSeconds(route.duration),
    encodedPolyline: encoded,
  };
}
