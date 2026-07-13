// Authenticated APNs fan-out for alerts and ActivityKit remote updates.
// Postgres triggers call this function with a Vault-backed shared secret.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secureEqual } from "./auth.ts";
import {
  providerToken,
  readApnsConfig,
  sendApns,
  sendLiveActivityApns,
  type LiveActivityContentState,
} from "./apns.ts";
import { buildMessage, prefColumn, type PushPayload } from "./messages.ts";

interface MembershipRow {
  user_id: string;
  subgroup_id: string | null;
  solo: boolean;
  status: "active" | "idle" | "arrived" | "offline";
}

interface LiveSessionRow {
  user_id: string;
  group_id: string;
  destination_id: string;
  push_token: string;
  initial_distance_m: number;
  current_distance_m: number;
  eta_seconds: number | null;
  travel_mode: "walk" | "transit" | "drive";
}

function readSupabaseAdminKey(): string {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    const defaultKey = (JSON.parse(secretKeys) as Record<string, string>).default;
    if (defaultKey) return defaultKey;
  }

  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacyKey) throw new Error("Supabase admin key is not configured");
  return legacyKey;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  readSupabaseAdminKey(),
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const webhookSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  if (!webhookSecret) return json({ error: "webhook secret not configured" }, 500);

  const suppliedSecret = req.headers.get("x-hither-webhook-secret") ?? "";
  if (!secureEqual(suppliedSecret, webhookSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: PushPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!payload?.category || !payload?.group_id || !payload?.sender_id) {
    return json({ error: "missing category/group_id/sender_id" }, 400);
  }

  try {
    const { data: memberData, error: memberError } = await supabase
      .from("memberships")
      .select("user_id, subgroup_id, solo, status")
      .eq("group_id", payload.group_id);
    if (memberError) throw memberError;

    const members = (memberData ?? []) as MembershipRow[];
    const memberByUser = new Map(members.map((member) => [member.user_id, member]));
    const sender = memberByUser.get(payload.sender_id);
    if (!sender) return json({ error: "sender is not a group member" }, 403);

    const inSenderScope = (member: MembershipRow) =>
      member.subgroup_id === sender.subgroup_id;

    // Alerts are scoped to the sender's main team/subgroup. Solo members and
    // the sender never receive the corresponding general notification.
    const alertCandidates = payload.category === "live_activity"
      ? []
      : members
        .filter(inSenderScope)
        .filter((member) => member.user_id !== payload.sender_id && !member.solo)
        .map((member) => member.user_id);

    const allowedAlertUsers = await filterNotificationPreferences(
      alertCandidates,
      payload.category,
    );

    const { data: tokenData, error: tokenError } = allowedAlertUsers.length > 0
      ? await supabase
        .from("push_tokens")
        .select("user_id, token")
        .in("user_id", allowedAlertUsers)
      : { data: [], error: null };
    if (tokenError) throw tokenError;

    const tokenRows = (tokenData ?? []) as Array<{ user_id: string; token: string }>;
    const liveSessions = await loadLiveSessions(payload, members, sender);

    if (tokenRows.length === 0 && liveSessions.length === 0) {
      return json({ sent: 0, liveActivitySent: 0, reason: "no tokens" });
    }

    const cfg = readApnsConfig();
    const jwt = await providerToken(cfg);

    const alertResults = tokenRows.length > 0
      ? await sendAlerts(cfg, jwt, tokenRows, payload)
      : [];
    const liveResults = liveSessions.length > 0
      ? await sendLiveActivities(cfg, jwt, liveSessions, members, memberByUser, payload)
      : [];

    const deadDeviceTokens = alertResults
      .filter((result) => result.dead)
      .map((result) => result.token);
    if (deadDeviceTokens.length > 0) {
      await supabase.from("push_tokens").delete().in("token", deadDeviceTokens);
    }

    const deadActivityTokens = liveResults
      .filter((result) => result.dead)
      .map((result) => result.token);
    if (deadActivityTokens.length > 0) {
      await supabase
        .from("live_activity_sessions")
        .delete()
        .in("push_token", deadActivityTokens);
    }

    if (payload.category === "journey" && payload.status === "paused") {
      await supabase
        .from("live_activity_sessions")
        .delete()
        .eq("group_id", payload.group_id);
    }

    return json({
      sent: alertResults.filter((result) => result.status === 200).length,
      total: tokenRows.length,
      liveActivitySent: liveResults.filter((result) => result.status === 200).length,
      liveActivityTotal: liveSessions.length,
      pruned: deadDeviceTokens.length + deadActivityTokens.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("send-push failed", message);
    return json({ error: message }, 500);
  }
});

async function filterNotificationPreferences(
  userIds: string[],
  category: PushPayload["category"],
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const column = prefColumn(category);
  const { data, error } = await supabase
    .from("notification_preferences")
    .select(`user_id, ${column}`)
    .in("user_id", userIds);
  if (error) throw error;

  const disabled = new Set(
    (data ?? [])
      .filter((row) => (row as Record<string, unknown>)[column] === false)
      .map((row) => (row as Record<string, unknown>).user_id as string),
  );
  return userIds.filter((userId) => !disabled.has(userId));
}

async function loadLiveSessions(
  payload: PushPayload,
  members: MembershipRow[],
  sender: MembershipRow,
): Promise<LiveSessionRow[]> {
  if (!["live_activity", "arrival", "straggler", "journey"].includes(payload.category)) {
    return [];
  }

  let query = supabase
    .from("live_activity_sessions")
    .select(
      "user_id, group_id, destination_id, push_token, initial_distance_m, current_distance_m, eta_seconds, travel_mode",
    )
    .eq("group_id", payload.group_id)
    .not("push_token", "is", null)
    .gt("expires_at", new Date().toISOString());

  if (payload.category === "live_activity") {
    if (!payload.target_user_id) return [];
    query = query.eq("user_id", payload.target_user_id);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as LiveSessionRow[];
  if (payload.category !== "arrival" && payload.category !== "straggler") {
    return rows;
  }

  const scopedUsers = new Set(
    members
      .filter((member) => member.subgroup_id === sender.subgroup_id)
      .map((member) => member.user_id),
  );
  return rows.filter((session) => scopedUsers.has(session.user_id));
}

async function sendAlerts(
  cfg: ReturnType<typeof readApnsConfig>,
  jwt: string,
  tokenRows: Array<{ user_id: string; token: string }>,
  payload: PushPayload,
) {
  const { title, body } = buildMessage(payload);
  const data = {
    category: payload.category,
    groupId: payload.group_id,
    memberId: payload.member_id,
  };
  return await Promise.all(
    tokenRows.map(({ token }) => sendApns(cfg, jwt, token, { title, body, data })),
  );
}

async function sendLiveActivities(
  cfg: ReturnType<typeof readApnsConfig>,
  jwt: string,
  sessions: LiveSessionRow[],
  members: MembershipRow[],
  memberByUser: Map<string, MembershipRow>,
  payload: PushPayload,
) {
  const destinationIds = [...new Set(sessions.map((session) => session.destination_id))];
  const userIds = members.map((member) => member.user_id);

  const [{ data: destinations, error: destinationError }, { data: profiles, error: profileError }] =
    await Promise.all([
      supabase.from("itinerary_items").select("id, title").in("id", destinationIds),
      supabase.from("profiles").select("id, avatar").in("id", userIds),
    ]);
  if (destinationError) throw destinationError;
  if (profileError) throw profileError;

  const titleByDestination = new Map(
    (destinations ?? []).map((row) => [row.id as string, row.title as string]),
  );
  const avatarByUser = new Map(
    (profiles ?? []).map((row) => [row.id as string, (row.avatar as string | null) ?? "🙂"]),
  );
  const event = payload.category === "journey" && payload.status === "paused"
    ? "end" as const
    : "update" as const;
  const timestamp = Math.floor(Date.now() / 1000);

  return await Promise.all(
    sessions.map((session) => {
      const owner = memberByUser.get(session.user_id);
      const visibleMembers = owner
        ? members.filter((member) => member.subgroup_id === owner.subgroup_id && !member.solo)
        : [];
      const contentState: LiveActivityContentState = {
        gatheringTitle: titleByDestination.get(session.destination_id) ?? "集合點",
        distanceMeters: Math.max(0, Math.round(session.current_distance_m)),
        etaSeconds: Math.max(0, session.eta_seconds ?? 0),
        progress: clampProgress(
          1 - session.current_distance_m / session.initial_distance_m,
        ),
        gatheredCount: visibleMembers.filter((member) => member.status === "arrived").length,
        memberCount: visibleMembers.length,
        accentHex: "#58D68D",
        travelMode: session.travel_mode,
        memberEmojis: visibleMembers.map(
          (member) => avatarByUser.get(member.user_id) ?? "🙂",
        ),
        memberArrived: visibleMembers.map((member) => member.status === "arrived"),
      };

      return sendLiveActivityApns(cfg, jwt, session.push_token, {
        event,
        timestamp,
        contentState,
      });
    }),
  );
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
