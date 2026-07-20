import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildFcmDataMessage,
  buildFcmMessage,
  isFcmDeadToken,
} from "./fcm.ts";

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
