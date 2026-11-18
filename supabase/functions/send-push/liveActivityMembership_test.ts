import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stub } from "https://deno.land/std@0.224.0/testing/mock.ts";

Deno.test("Live Activity start and update reach only currently eligible members", async () => {
  const signingKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const keyBytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", signingKey.privateKey));
  const env = {
    SUPABASE_URL: "https://notification.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    SUPABASE_SECRET_KEYS: undefined,
    PUSH_WEBHOOK_SECRET: "test-webhook-secret",
    APNS_ENV: "sandbox",
    APNS_KEY: btoa(String.fromCharCode(...keyBytes)),
    APNS_KEY_ID: "test-key",
    APNS_TEAM_ID: "test-team",
    APNS_BUNDLE_ID: "test.hither",
  };
  const previous = Object.keys(env).map((name) => [name, Deno.env.get(name)] as const);
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }

  const members = ["leader", "current", "expired", "departed"];
  const activityUsers = ["current", "expired", "departed"];
  const eligible = new Set(["leader", "current"]);
  const sent: { token: string; event: string }[] = [];
  let handler: (request: Request) => Promise<Response>;
  const serve = stub(Deno, "serve", (callback: unknown) => {
    handler = callback as typeof handler;
    return {} as Deno.HttpServer<Deno.NetAddr>;
  });
  const transport = stub(globalThis, "fetch", (input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const table = url.pathname.split("/").at(-1);
    const respond = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    }));
    if (url.hostname === "api.sandbox.push.apple.com") {
      assertEquals(new Headers(init?.headers).get("apns-push-type"), "liveactivity");
      sent.push({ token: table!, event: JSON.parse(String(init?.body)).aps.event });
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    assertEquals(url.hostname, "notification.test");
    switch (table) {
      case "memberships":
        return respond(members.map((user_id) => ({
          user_id, role: user_id === "leader" ? "leader" : "follower", subgroup_id: null, solo: false, status: "active",
        })));
      case "current_push_member_ids": {
        const { p_group_id, p_user_ids } = JSON.parse(String(init?.body));
        assertEquals(p_group_id, "group-1");
        return respond((p_user_ids as string[]).filter((id) => eligible.has(id)).map((user_id) => ({ user_id })));
      }
      case "navigation_sessions":
        return respond([{
          id: "session-1", scope_key: "main", scope_subgroup_id: null, origin: "manual", status: "active", version: 1,
        }]);
      case "device_live_activity_tokens":
        return respond(activityUsers.map((user_id) => ({ user_id, device_id: user_id, push_to_start_token: `start-${user_id}` })));
      case "live_activity_sessions": {
        if (url.searchParams.get("select") === "user_id") return respond([]);
        const user_id = url.searchParams.get("user_id")?.slice(3);
        return respond([{
          user_id, group_id: "group-1", destination_id: "destination-1", push_token: `update-${user_id}`,
          current_distance_m: 10, eta_seconds: 30, travel_mode: "walk", updated_at: "2026-01-01T00:00:00Z",
        }]);
      }
      case "groups":
        return respond([{ name: "Team" }]);
      case "itinerary_items":
        return respond([{ id: "destination-1", title: "Meeting Point" }]);
      case "notification_preferences":
      case "profiles":
      case "destination_arrivals":
        return respond([]);
      case "push_tokens":
        assertEquals(url.searchParams.get("user_id"), "in.(current)");
        return respond([]);
      default:
        throw new Error(`Unexpected push HTTP boundary ${url}`);
    }
  });
  try {
    await import("./index.ts");
    const request = (payload: Record<string, unknown>) => new Request("https://notification.test/send-push", {
      method: "POST",
      headers: { "x-hither-webhook-secret": "test-webhook-secret" },
      body: JSON.stringify({ group_id: "group-1", sender_id: "leader", sender_name: "Leader", ...payload }),
    });
    const start = await handler!(request({
      category: "navigation_session", destination_id: "destination-1", session_id: "session-1", status: "active", version: 1,
    }));
    assertEquals(start.status, 200);
    assertEquals((await start.json()).liveActivitySent, 1);

    for (const target_user_id of activityUsers) {
      const update = await handler!(request({ category: "live_activity", target_user_id }));
      assertEquals(update.status, 200);
      assertEquals((await update.json()).liveActivitySent, target_user_id === "current" ? 1 : 0);
    }
    assertEquals(sent, [{ token: "start-current", event: "start" }, { token: "update-current", event: "update" }]);
  } finally {
    serve.restore();
    transport.restore();
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
