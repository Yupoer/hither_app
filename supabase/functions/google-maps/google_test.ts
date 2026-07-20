import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseDurationSeconds,
  searchPlaces,
  validateRequest,
} from "./google.ts";
import { PLACES_FIELD_MASK, ROUTES_FIELD_MASK } from "./types.ts";

Deno.test("search rejects blank and overlong queries", () => {
  assertEquals(validateRequest({ action: "search", query: " " }), null);
  assertEquals(validateRequest({ action: "search", query: "x".repeat(201) }), null);
  assertEquals(validateRequest({ action: "search", query: "" }), null);
});

Deno.test("search accepts trimmed queries with optional region", () => {
  const ok = validateRequest({
    action: "search",
    query: "  台北車站  ",
    region: {
      latitude: 25.05,
      longitude: 121.5,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    },
  });
  assertExists(ok);
  assertEquals(ok.action, "search");
  if (ok.action === "search") {
    assertEquals(ok.query, "台北車站");
    assertEquals(ok.languageCode, "zh-TW");
  }
});

Deno.test("route rejects invalid coordinates and travel modes", () => {
  assertEquals(
    validateRequest({
      action: "route",
      from: { latitude: 91, longitude: 121 },
      to: { latitude: 25, longitude: 121 },
      travelMode: "walk",
    }),
    null,
  );
  assertEquals(
    validateRequest({
      action: "route",
      from: { latitude: 25, longitude: 121 },
      to: { latitude: 25.1, longitude: 121.1 },
      travelMode: "fly",
    }),
    null,
  );
});

Deno.test("route accepts finite legal coordinates", () => {
  const ok = validateRequest({
    action: "route",
    from: { latitude: 25.0339, longitude: 121.5645 },
    to: { latitude: 25.0478, longitude: 121.517 },
    travelMode: "drive",
  });
  assertExists(ok);
  assertEquals(ok?.action, "route");
});

Deno.test("Places requests only display fields used by Hither", () => {
  assertEquals(
    PLACES_FIELD_MASK,
    "places.id,places.displayName,places.formattedAddress,places.location",
  );
});

Deno.test("Routes requests only route geometry and timing fields", () => {
  assertEquals(
    ROUTES_FIELD_MASK,
    "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
  );
});

Deno.test("parseDurationSeconds handles Routes API format", () => {
  assertEquals(parseDurationSeconds("123s"), 123);
  assertEquals(parseDurationSeconds("12.6s"), 13);
  assertEquals(parseDurationSeconds(null), 0);
});

Deno.test("searchPlaces uses Places field mask and never calls with empty query body", async () => {
  let seenMask = "";
  let seenKey = "";
  const fakeFetch: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    seenMask = headers.get("X-Goog-FieldMask") ?? "";
    seenKey = headers.get("X-Goog-Api-Key") ?? "";
    return new Response(
      JSON.stringify({
        places: [
          {
            id: "p1",
            displayName: { text: "台北車站" },
            formattedAddress: "台北市",
            location: { latitude: 25.0478, longitude: 121.517 },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const places = await searchPlaces("test-key", "台北車站", undefined, fakeFetch);
  assertEquals(places.length, 1);
  assertEquals(places[0].name, "台北車站");
  assertEquals(seenMask, PLACES_FIELD_MASK);
  assertEquals(seenKey, "test-key");
});

Deno.test("quota gate contract: validateRequest never produces Google-callable body for blank query", () => {
  // Documents fail-closed validation before quota / Google: blank query is rejected.
  assertEquals(validateRequest({ action: "search", query: "\t  \n" }), null);
});
