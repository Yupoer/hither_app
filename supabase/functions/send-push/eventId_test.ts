/**
 * Exercises production eventIdFromPayload (not a reimplementation).
 * Vectors shared with mobile Jest via eventId.vectors.json.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { eventIdFromPayload, mapPushCategoryToEventKey } from "./eventId.ts";

type Vector = {
  name: string;
  deno: Parameters<typeof eventIdFromPayload>[0];
  expected: string;
};

const vectors: Vector[] = JSON.parse(
  await Deno.readTextFile(new URL("./eventId.vectors.json", import.meta.url)),
);

for (const v of vectors) {
  Deno.test(`eventIdFromPayload: ${v.name}`, () => {
    assertEquals(eventIdFromPayload(v.deno), v.expected);
  });
}

Deno.test("mapPushCategoryToEventKey arrival → member_arrival", () => {
  assertEquals(mapPushCategoryToEventKey("arrival"), "member_arrival");
  assertEquals(
    mapPushCategoryToEventKey("follower_requests", "request_start"),
    "route_request",
  );
});
