import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { commandSenderIsAuthorized, webhookAuthorization } from "./auth.ts";

Deno.test("webhook gate rejects missing or wrong secrets and fails closed when unset", () => {
  assertEquals(webhookAuthorization("s3cret", "s3cret"), "ok");
  assertEquals(webhookAuthorization("s3cret", null), "unauthorized");
  assertEquals(webhookAuthorization("s3cret", ""), "unauthorized");
  assertEquals(webhookAuthorization("s3cret", "s3cre"), "unauthorized");
  assertEquals(webhookAuthorization("s3cret", "s3cret "), "unauthorized");
  assertEquals(webhookAuthorization(undefined, ""), "not_configured");
  assertEquals(webhookAuthorization("", ""), "not_configured");
});

Deno.test("followers cannot fan out leader commands; role-dependent custom and requests stay valid", () => {
  for (const type of ["gather", "find_gathering", "depart", "rest", "be_careful", "go_left", "go_right", "stop", "hurry_up", "custom"]) {
    assertEquals(commandSenderIsAuthorized({ category: "leader_commands", type }, "follower"), false);
    assertEquals(commandSenderIsAuthorized({ category: "leader_commands", type }, "leader"), true);
    if (type !== "custom") assertEquals(commandSenderIsAuthorized({ category: "follower_requests", type }, "follower"), false);
  }
  for (const role of ["leader", "follower"]) {
    for (const type of ["need_restroom", "need_break", "need_help", "found_something", "request_start"]) {
      assertEquals(commandSenderIsAuthorized({ category: "follower_requests", type }, role), true);
      assertEquals(commandSenderIsAuthorized({ category: "leader_commands", type }, role), role === "leader");
    }
  }
  assertEquals(commandSenderIsAuthorized({ category: "follower_requests", type: "custom" }, "follower"), true);
  assertEquals(commandSenderIsAuthorized({ category: "follower_requests", type: "custom" }, "leader"), false);
  assertEquals(commandSenderIsAuthorized({ category: "leader_commands", type: "unknown" }, "leader"), false);
  assertEquals(commandSenderIsAuthorized({ category: "arrival" }, "follower"), true);
});
