// send-push — APNs fan-out Edge Function.
//
// Invoked by Postgres triggers (pg_net, see migration 20260619000000) after a
// command insert, a new itinerary item, or a journey_status change. Resolves the
// recipients (all group members EXCEPT the sender), drops anyone who has the
// matching notification category switched off, and pushes to each of their
// device tokens via APNs. Dead tokens (410 / Unregistered) are pruned.
//
// Auth: called with the service-role bearer (set on the DB side). The default
// Edge gateway JWT check accepts it; we additionally use the service role to
// read across users (bypassing RLS) — that is the whole point of this function.
//
// Required secrets (supabase secrets set ...):
//   APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_ENV
// Auto-provided by the runtime: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { providerToken, readApnsConfig, sendApns } from "./apns.ts";
import { buildMessage, prefColumn, type PushPayload } from "./messages.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  let payload: PushPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!payload?.category || !payload?.group_id) {
    return json({ error: "missing category/group_id" }, 400);
  }

  // 1) Recipients = group members minus the sender and minus anyone in Solo
  //    mode (deploy after the solo_mode migration — the column must exist).
  const { data: members, error: mErr } = await supabase
    .from("memberships")
    .select("user_id, solo")
    .eq("group_id", payload.group_id)
    .neq("user_id", payload.sender_id);
  if (mErr) return json({ error: mErr.message }, 500);

  const recipientIds = (members ?? [])
    .filter((m) => !(m as { solo?: boolean }).solo)
    .map((m) => m.user_id as string);
  if (recipientIds.length === 0) return json({ sent: 0, reason: "no recipients" });

  // 2) Drop recipients who disabled this category. Missing row = all-on.
  const column = prefColumn(payload.category);
  const { data: prefs, error: pErr } = await supabase
    .from("notification_preferences")
    .select(`user_id, ${column}`)
    .in("user_id", recipientIds);
  if (pErr) return json({ error: pErr.message }, 500);

  const disabled = new Set(
    (prefs ?? [])
      .filter((row) => (row as Record<string, unknown>)[column] === false)
      .map((row) => (row as Record<string, unknown>).user_id as string),
  );
  const allowed = recipientIds.filter((id) => !disabled.has(id));
  if (allowed.length === 0) return json({ sent: 0, reason: "all opted out" });

  // 3) Their device tokens.
  const { data: tokenRows, error: tErr } = await supabase
    .from("push_tokens")
    .select("user_id, token")
    .in("user_id", allowed);
  if (tErr) return json({ error: tErr.message }, 500);

  const tokens = (tokenRows ?? []).map((r) => r.token as string);
  if (tokens.length === 0) return json({ sent: 0, reason: "no device tokens" });

  // 4) Sign once, fan out.
  const cfg = readApnsConfig();
  const jwt = await providerToken(cfg);
  const { title, body } = buildMessage(payload);
  const data = { category: payload.category, groupId: payload.group_id };

  const results = await Promise.all(
    tokens.map((token) => sendApns(cfg, jwt, token, { title, body, data })),
  );

  // 5) Prune dead tokens.
  const dead = results.filter((r) => r.dead).map((r) => r.token);
  if (dead.length > 0) {
    await supabase.from("push_tokens").delete().in("token", dead);
  }

  const sent = results.filter((r) => r.status === 200).length;
  return json({ sent, total: tokens.length, pruned: dead.length });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
