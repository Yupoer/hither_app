/**
 * Exercises production eventIdFromPayload (not a reimplementation).
 * Vectors shared with mobile Jest via eventId.vectors.json.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { eventIdFromPayload, eventIdsFromPayload, mapPushCategoryToEventKey } from "./eventId.ts";

import { buildAlertRequest } from "./apns.ts";
import { buildFcmMessage } from "./fcm.ts";

type Vector = {
  name: string;
  deno: Parameters<typeof eventIdFromPayload>[0];
  expected: string;
  push: { eventId: string; eventIdV2?: string };
};

const vectors: Vector[] = JSON.parse(
  await Deno.readTextFile(new URL("./eventId.vectors.json", import.meta.url)),
);

for (const v of vectors) {
  Deno.test(`eventIdFromPayload: ${v.name}`, () => {
    assertEquals(eventIdFromPayload(v.deno), v.expected);
    assertEquals(eventIdsFromPayload(v.deno), v.push);
  });
}

Deno.test("mapPushCategoryToEventKey arrival → member_arrival", () => {
  assertEquals(mapPushCategoryToEventKey("arrival"), "member_arrival");
  assertEquals(
    mapPushCategoryToEventKey("follower_requests", "request_start"),
    "route_request",
  );
});

Deno.test("APNs and FCM preserve the legacy and lifecycle identities", () => {
  const config = { key: "unused", keyId: "key", teamId: "team", bundleId: "app.hither.mobile", env: "production" as const };
  for (const vector of vectors) {
    const data = eventIdsFromPayload(vector.deno);
    const alert = { title: "Journey", body: "Changed", data };
    const apns = JSON.parse(String(buildAlertRequest(config, "jwt", "token", alert).init.body));
    assertEquals(apns.eventId, vector.push.eventId);
    assertEquals(apns.eventIdV2, vector.push.eventIdV2);
    assertEquals(buildFcmMessage("token", alert).message.data, vector.push);
  }
});
