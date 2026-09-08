import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { specialAlertRecipientIds } from "./recipients.ts";
import { prefColumn } from "./messages.ts";

Deno.test("arrival includes self and leaders exactly once, never unrelated followers", () => {
  const members = [
    { user_id: "leader", role: "leader", solo: false },
    { user_id: "follower", role: "follower", solo: false },
    { user_id: "other", role: "follower", solo: false },
  ];
  assertEquals(specialAlertRecipientIds({ category: "arrival", group_id: "g", sender_id: "leader" }, members), ["leader"]);
  assertEquals(specialAlertRecipientIds({ category: "arrival", group_id: "g", sender_id: "follower" }, members), ["follower", "leader"]);
  assertEquals(prefColumn("arrival"), "arrival");
  assertEquals(prefColumn("journey"), "journey");
});
