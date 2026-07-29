import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildFcmDataMessage,
  buildFcmMessage,
  isFcmDeadToken,
} from "./fcm.ts";
import {
  buildMessage,
  prefColumn,
} from "./messages.ts";
import { requestStartRecipientIds } from "./recipients.ts";

Deno.test("builds an Android alert with string data values", () => {
  const alert = {
    title: "新的集合點",
    body: "集合點：台北車站",
    data: {
      category: "add_gathering",
      groupId: "g1",
      memberId: undefined,
      senderId: "u1",
      requestId: null,
    },
  };
  assertEquals(buildFcmMessage("token", alert), {
    message: {
      token: "token",
      notification: { title: alert.title, body: alert.body },
      data: { category: "add_gathering", groupId: "g1", senderId: "u1" },
      android: { priority: "high" },
    },
  });
});

Deno.test("builds data-only location_refresh with high priority", () => {
  assertEquals(
    buildFcmDataMessage("tok", {
      data: { category: "location_refresh", groupId: "g1" },
    }),
    {
      message: {
        token: "tok",
        data: { category: "location_refresh", groupId: "g1" },
        android: { priority: "high" },
      },
    },
  );
});

Deno.test("builds the follower request_start message", () => {
  assertEquals(
    buildMessage({
      category: "follower_requests",
      group_id: "g1",
      sender_id: "u1",
      type: "request_start",
      message: "請開始前往「台北車站」",
    }),
    {
      title: "成員：要求開始",
      body: "請開始前往「台北車站」",
    },
  );
  assertEquals(
    requestStartRecipientIds(
      {
        category: "follower_requests",
        group_id: "g1",
        sender_id: "u1",
        type: "request_start",
      },
      [
        { user_id: "leader", role: "leader" },
        { user_id: "follower", role: "follower" },
      ],
    ),
    ["leader"],
  );
  assertEquals(prefColumn("follower_requests"), "follower_requests");
});

Deno.test("marks UNREGISTERED and invalid token as dead", () => {
  assert(isFcmDeadToken(404, JSON.stringify({ error: { status: "NOT_FOUND" } })));
  assert(
    isFcmDeadToken(
      404,
      JSON.stringify({ error: { details: [{ errorCode: "UNREGISTERED" }] } }),
    ),
  );
  assert(
    isFcmDeadToken(
      400,
      JSON.stringify({
        error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" },
      }),
    ),
  );
  assert(!isFcmDeadToken(401, "unauthorized"));
  assert(!isFcmDeadToken(429, "rate limited"));
  assert(!isFcmDeadToken(500, "internal"));
  assert(!isFcmDeadToken(400, JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "Invalid data key" } })));
});
