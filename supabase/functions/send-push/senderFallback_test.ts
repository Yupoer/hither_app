import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildMessage, type PushPayload } from "./messages.ts";
import { deliverWithSenderFallback } from "./senderFallback.ts";

Deno.test("sender profile failure still delivers one fallback-copy batch", async () => {
  const payload: PushPayload = {
    category: "leader_commands",
    group_id: "group-1",
    sender_id: "leader-1",
    type: "gather",
  };
  const delivered: PushPayload[] = [];
  const lookupErrors: unknown[] = [];

  const result = await deliverWithSenderFallback(
    payload,
    "leader",
    async () => ({ data: null, error: new Error("profiles unavailable") }),
    async (batch) => {
      delivered.push(batch);
      return buildMessage(batch);
    },
    (error) => lookupErrors.push(error),
  );

  assertEquals(delivered.length, 1);
  assertEquals(delivered[0].sender_name, "隊長");
  assertEquals(result, buildMessage({ ...payload, sender_name: "隊長" }));
  assert(lookupErrors.length === 1);
});
