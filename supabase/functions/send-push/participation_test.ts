import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { specialAlertRecipientIds } from "./recipients.ts";
import { buildMessage, prefColumn, type PushPayload } from "./messages.ts";

Deno.test("participation notices inform remaining non-solo members and preserve journey preferences", () => {
  const members = [
    { user_id: "leader", role: "leader", solo: false },
    { user_id: "peer", role: "follower", solo: false },
    { user_id: "subgroup-peer", role: "follower", subgroup_id: "sg", solo: false },
    { user_id: "solo", role: "follower", solo: true },
  ];
  for (const category of ["member_solo", "member_follow", "member_left"] as const) {
    const payload: PushPayload = { category, group_id: "g", sender_id: "peer", member_name: "Tokyo A" };
    assertEquals(specialAlertRecipientIds(payload, members), ["leader", "subgroup-peer"]);
    assertEquals(specialAlertRecipientIds(payload, members.filter(member => member.user_id !== "peer")), ["leader", "subgroup-peer"]);
    assertEquals(prefColumn(category), "journey");
    assertEquals(buildMessage(payload).title, "隊伍動態");
    assertEquals(buildMessage(payload).body.startsWith("Tokyo A "), true);
  }
});
