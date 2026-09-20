import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isExpiredPush } from "./deadline.ts";

Deno.test("durable command deadline rejects expired or invalid values and preserves legacy events", () => {
  assertEquals(isExpiredPush({}, 1000), false);
  assertEquals(isExpiredPush({ expires_at: new Date(999).toISOString() }, 1000), true);
  assertEquals(isExpiredPush({ expires_at: new Date(1000).toISOString() }, 1000), true);
  assertEquals(isExpiredPush({ expires_at: "invalid" }, 1000), true);
  assertEquals(isExpiredPush({ expires_at: new Date(1001).toISOString() }, 1000), false);
});
