import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stub } from "https://deno.land/std@0.224.0/testing/mock.ts";

Deno.test("send-push permits a departed sender only for its matching server-recorded departure", async () => {
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS", "PUSH_WEBHOOK_SECRET"];
  const previous = names.map(name => Deno.env.get(name));
  Deno.env.set("SUPABASE_URL", "https://notification.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  Deno.env.set("PUSH_WEBHOOK_SECRET", "test-webhook-secret");
  let handler: (request: Request) => Promise<Response>;
  let recorded = false;
  const departureQueries: URL[] = [];
  const serve = stub(Deno, "serve", (callback: unknown) => {
    handler = callback as typeof handler;
    return {} as Deno.HttpServer<Deno.NetAddr>;
  });
  const transport = stub(globalThis, "fetch", async (input: Request | URL | string) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const table = url.pathname.split("/").at(-1);
    let rows: object[];
    if (table === "memberships") rows = [];
    else if (table === "group_alerts") {
      departureQueries.push(url);
      rows = recorded ? [{ id: "recorded-departure" }] : [];
    } else if (table === "profiles") rows = [{ nickname: "Tokyo A" }];
    else throw new Error(`Unexpected notification HTTP boundary ${url}`);
    return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
  });
  try {
    await import("./index.ts");
    const request = (category: string) => new Request("https://notification.test/send-push", {
      method: "POST", headers: { "x-hither-webhook-secret": "test-webhook-secret" },
      body: JSON.stringify({ category, group_id: "group-1", sender_id: "departed-member", entity_id: "recorded-departure" }),
    });
    assertEquals((await handler!(request("journey"))).status, 403);
    assertEquals(departureQueries.length, 0);
    assertEquals((await handler!(request("member_left"))).status, 403);
    recorded = true;
    const delivered = await handler!(request("member_left"));
    assertEquals(delivered.status, 200);
    assertEquals((await delivered.json()).reason, "no tokens");
    const query = departureQueries.at(-1)!;
    assertEquals(query.searchParams.get("id"), "eq.recorded-departure");
    assertEquals(query.searchParams.get("group_id"), "eq.group-1");
    assertEquals(query.searchParams.get("sender_id"), "eq.departed-member");
    assertEquals(query.searchParams.get("kind"), "eq.member_left");
  } finally {
    serve.restore(); transport.restore();
    names.forEach((name,index) => previous[index] === undefined ? Deno.env.delete(name) : Deno.env.set(name,previous[index]!));
  }
});
