// Authenticated APNs + FCM fan-out for alerts and ActivityKit remote updates.
// Postgres triggers call this function with a Vault-backed shared secret.
//
// Platform split: push_tokens.platform ios → APNs, android → FCM HTTP v1.
// Live Activity / push-to-start remain iOS/APNs only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secureEqual } from "./auth.ts";
import {
  providerToken,
  readApnsConfig,
  sendApns,
  sendBackgroundLocationRefresh,
  sendLiveActivityApns,
  sendLiveActivityStartApns,
  type ApnsConfig,
  type ApnsResult,
  type LiveActivityContentState,
} from "./apns.ts";
import {
  fcmAccessToken,
  readFcmConfig,
  sendFcm,
  sendFcmData,
  type FcmResult,
} from "./fcm.ts";
import { buildMessage, prefColumn, type PushPayload } from "./messages.ts";

interface MembershipRow {
  user_id: string;
  role: "leader" | "follower";
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

interface DeviceLiveActivityTokenRow {
  user_id: string;
  device_id: string;
  push_to_start_token: string;
}

interface DeviceTokenRow {
  user_id: string;
  token: string;
  platform: "ios" | "android";
}

type PushResult =
  | (ApnsResult & { provider: "apns" })
  | FcmResult;

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

function normalizePlatform(raw: unknown): "ios" | "android" {
  return raw === "android" ? "android" : "ios";
}

function splitByPlatform(rows: DeviceTokenRow[]): {
  ios: DeviceTokenRow[];
  android: DeviceTokenRow[];
} {
  const ios: DeviceTokenRow[] = [];
  const android: DeviceTokenRow[] = [];
  for (const row of rows) {
    if (row.platform === "android") android.push(row);
    else ios.push(row);
  }
  return { ios, android };
}

function alertData(payload: PushPayload): Record<string, string | undefined | null> {
  return {
    category: payload.category,
    groupId: payload.group_id,
    memberId: payload.member_id,
    senderId: payload.sender_id,
    requestId: payload.request_id,
  };
}

async function loadTokenRows(userIds: string[]): Promise<DeviceTokenRow[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase
    .from("push_tokens")
    .select("user_id, token, platform")
    .in("user_id", userIds);
  if (error) throw error;
  return ((data ?? []) as Array<{ user_id: string; token: string; platform?: string }>).map(
    (row) => ({
      user_id: row.user_id,
      token: row.token,
      platform: normalizePlatform(row.platform),
    }),
  );
}

async function sendAlerts(
  tokenRows: DeviceTokenRow[],
  payload: PushPayload,
): Promise<PushResult[]> {
  if (tokenRows.length === 0) return [];
  const { ios, android } = splitByPlatform(tokenRows);
  const { title, body } = buildMessage(payload);
  const data = alertData(payload);
  const results: PushResult[] = [];

  if (ios.length > 0) {
    const cfg = readApnsConfig();
    const jwt = await providerToken(cfg);
    const apnsResults = await Promise.all(
      ios.map(({ token }) =>
        sendApns(cfg, jwt, token, { title, body, data }).then(
          (r): PushResult => ({ ...r, provider: "apns" }),
        )),
    );
    results.push(...apnsResults);
  }

  if (android.length > 0) {
    const cfg = readFcmConfig();
    if (!cfg) {
      throw new Error(
        "Missing FCM config: set FIREBASE_SERVICE_ACCOUNT_JSON for Android tokens",
      );
    }
    const access = await fcmAccessToken(cfg);
    const fcmResults = await Promise.all(
      android.map(({ token }) => sendFcm(cfg, access, token, { title, body, data })),
    );
    results.push(...fcmResults);
  }

  return results;
}

async function sendBackgroundLocationRefreshes(
  tokenRows: DeviceTokenRow[],
  payload: PushPayload,
): Promise<PushResult[]> {
  if (tokenRows.length === 0) return [];
  const { ios, android } = splitByPlatform(tokenRows);
  const results: PushResult[] = [];

  if (ios.length > 0) {
    const cfg = readApnsConfig();
    const jwt = await providerToken(cfg);
    const apnsResults = await Promise.all(
      ios.map(({ token }) =>
        sendBackgroundLocationRefresh(cfg, jwt, token, {
          groupId: payload.group_id,
        }).then((r): PushResult => ({ ...r, provider: "apns" }))),
    );
    results.push(...apnsResults);
  }

  if (android.length > 0) {
    const cfg = readFcmConfig();
    if (!cfg) {
      throw new Error(
        "Missing FCM config: set FIREBASE_SERVICE_ACCOUNT_JSON for Android tokens",
      );
    }
    const access = await fcmAccessToken(cfg);
    const fcmResults = await Promise.all(
      android.map(({ token }) =>
        sendFcmData(cfg, access, token, {
          data: {
            category: "location_refresh",
            groupId: payload.group_id,
          },
        })),
    );
    results.push(...fcmResults);
  }

  return results;
}

function summarizePushResults(results: PushResult[]) {
  const apnsSent = results.filter((r) => r.provider === "apns" && r.status === 200).length;
  const fcmSent = results.filter((r) => r.provider === "fcm" && r.status === 200).length;
  return { apnsSent, fcmSent, sent: apnsSent + fcmSent };
}

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
      .select("user_id, role, subgroup_id, solo, status")
      .eq("group_id", payload.group_id);
    if (memberError) throw memberError;

    const members = (memberData ?? []) as MembershipRow[];
    const memberByUser = new Map(members.map((member) => [member.user_id, member]));
    const sender = memberByUser.get(payload.sender_id);
    if (!sender) return json({ error: "sender is not a group member" }, 403);

    const { data: senderProfile, error: senderProfileError } = await supabase
      .from("profiles")
      .select("nickname")
      .eq("id", payload.sender_id)
      .maybeSingle();
    if (senderProfileError) throw senderProfileError;
    const senderName = (senderProfile?.nickname as string | undefined)?.trim() || "隊員";
    payload = { ...payload, sender_name: senderName };

    if (payload.category === "navigation_session") {
      return await handleNavigationSession(
        payload,
        members,
        sender,
        memberByUser,
      );
    }

    const inSenderScope = (member: MembershipRow) =>
      member.subgroup_id === sender.subgroup_id;

    // Meet-time + straggler: notify everyone in scope including the sender
    // (leader who set the clock / who detected the straggler). Other alerts
    // exclude the sender and solo members.
    const includeSenderBroadcast =
      payload.category === "meet_time_set" ||
      payload.category === "meet_time_cleared" ||
      payload.category === "meet_warning" ||
      payload.category === "meet_due" ||
      payload.category === "straggler";
    const wholeGroupCommand =
      payload.category === "leader_commands" || payload.category === "follower_requests";

    // Alerts are scoped to the sender's main team/subgroup. Solo members never
    // receive general notifications (except pure meet-time, which includes all).
    const alertCandidates = payload.category === "live_activity" ||
        payload.category === "location_refresh"
      ? []
      : members
        .filter((member) =>
          payload.category === "gathering_request"
            ? member.role === "leader"
            : wholeGroupCommand
            ? true
            : inSenderScope(member)
        )
        .filter((member) => {
          if (
            payload.category === "meet_time_set" ||
            payload.category === "meet_time_cleared" ||
            payload.category === "meet_warning" ||
            payload.category === "meet_due"
          ) {
            return true;
          }
          if (member.solo) return false;
          if (includeSenderBroadcast) return true;
          return member.user_id !== payload.sender_id;
        })
        .map((member) => member.user_id);

    const allowedAlertUsers = await filterNotificationPreferences(
      alertCandidates,
      payload.category,
    );

    const tokenRows = await loadTokenRows(allowedAlertUsers);
    const refreshCandidates = payload.category === "location_refresh"
      ? members
        .filter((member) => member.user_id !== payload.sender_id)
        .filter((member) => member.status !== "offline")
        .map((member) => member.user_id)
      : [];
    const refreshTokenRows = await loadTokenRows(refreshCandidates);
    const liveSessions = await loadLiveSessions(payload, members, sender);

    if (tokenRows.length === 0 && refreshTokenRows.length === 0 && liveSessions.length === 0) {
      return json({
        sent: 0,
        apnsSent: 0,
        fcmSent: 0,
        total: 0,
        liveActivitySent: 0,
        reason: "no tokens",
      });
    }

    // Only require APNs secrets when ios tokens or Live Activity sessions exist.
    // Only require FCM when android tokens exist. Missing the unused provider
    // must not fail the whole batch.
    const needsApns =
      tokenRows.some((r) => r.platform === "ios") ||
      refreshTokenRows.some((r) => r.platform === "ios") ||
      liveSessions.length > 0;
    const needsFcm =
      tokenRows.some((r) => r.platform === "android") ||
      refreshTokenRows.some((r) => r.platform === "android");

    if (needsApns) {
      // Throws if APNs secrets missing — only when ios path is required.
      readApnsConfig();
    }
    if (needsFcm && !readFcmConfig()) {
      throw new Error(
        "Missing FCM config: set FIREBASE_SERVICE_ACCOUNT_JSON for Android tokens",
      );
    }

    const alertResults = await sendAlerts(tokenRows, payload);
    const refreshResults = await sendBackgroundLocationRefreshes(
      refreshTokenRows,
      payload,
    );
    const liveResults = liveSessions.length > 0
      ? await sendLiveActivities(liveSessions, members, memberByUser, payload)
      : [];

    const deadDeviceTokens = [...alertResults, ...refreshResults]
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

    const deviceSummary = summarizePushResults([...alertResults, ...refreshResults]);
    return json({
      sent: deviceSummary.sent,
      apnsSent: deviceSummary.apnsSent,
      fcmSent: deviceSummary.fcmSent,
      total: tokenRows.length + refreshTokenRows.length,
      locationRefreshSent: refreshResults.filter((result) => result.status === 200).length,
      locationRefreshTotal: refreshTokenRows.length,
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

async function handleNavigationSession(
  payload: PushPayload,
  members: MembershipRow[],
  sender: MembershipRow,
  memberByUser: Map<string, MembershipRow>,
): Promise<Response> {
  if (!payload.session_id || !payload.destination_id || !payload.status) {
    return json({ error: "navigation session payload is incomplete" }, 400);
  }

  const eligibleUserIds = await filterNotificationPreferences(
    members.filter((member) => !member.solo).map((member) => member.user_id),
    "navigation_session",
  );
  const isStart = payload.status === "active" && payload.version === 1;

  if (isStart) {
    const [tokenResponse, groupResponse, destinationResponse] = await Promise.all([
      eligibleUserIds.length > 0
        ? supabase
          .from("device_live_activity_tokens")
          .select("user_id, device_id, push_to_start_token")
          .eq("live_activities_enabled", true)
          .not("push_to_start_token", "is", null)
          .in("user_id", eligibleUserIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("groups").select("name").eq("id", payload.group_id).maybeSingle(),
      supabase.from("itinerary_items").select("title").eq("id", payload.destination_id)
        .maybeSingle(),
    ]);
    if (tokenResponse.error) throw tokenResponse.error;
    if (groupResponse.error) throw groupResponse.error;
    if (destinationResponse.error) throw destinationResponse.error;

    const startRows = (tokenResponse.data ?? []) as DeviceLiveActivityTokenRow[];
    const usersWithStartToken = new Set(startRows.map((row) => row.user_id));
    const fallbackUserIds = eligibleUserIds.filter(
      (userId) => !usersWithStartToken.has(userId),
    );
    const fallbackTokenRows = await loadTokenRows(fallbackUserIds);

    // Live Activity start is iOS-only; require APNs only when start tokens exist
    // or fallback includes ios tokens. FCM only when android fallbacks exist.
    let startResults: ApnsResult[] = [];
    if (startRows.length > 0) {
      const cfg = readApnsConfig();
      const jwt = await providerToken(cfg);
      const timestamp = Math.floor(Date.now() / 1000);
      const groupName = (groupResponse.data?.name as string | undefined) ?? "Hither";
      const gatheringTitle =
        (destinationResponse.data?.title as string | undefined) ?? "集合點";
      startResults = await Promise.all(
        startRows.map((row) =>
          sendLiveActivityStartApns(cfg, jwt, row.push_to_start_token, {
            timestamp,
            attributesType: "HitherGroupAttributes",
            attributes: { groupName },
            contentState: {
              navigationSessionId: payload.session_id,
              status: "starting",
              gatheringTitle,
              progress: 0,
            },
          })),
      );
    }

    let fallbackResults = await sendAlerts(fallbackTokenRows, payload);
    const deadStartTokens = startResults
      .filter((result) => result.dead)
      .map((result) => result.token);
    if (deadStartTokens.length > 0) {
      await supabase
        .from("device_live_activity_tokens")
        .update({ push_to_start_token: null, live_activities_enabled: false })
        .in("push_to_start_token", deadStartTokens);
      const deadStartUsers = startRows
        .filter((row) => deadStartTokens.includes(row.push_to_start_token))
        .map((row) => row.user_id);
      const deadStartFallbackRows = await loadTokenRows(deadStartUsers);
      fallbackResults = [
        ...fallbackResults,
        ...await sendAlerts(deadStartFallbackRows, payload),
      ];
    }
    const deadFallbackTokens = fallbackResults
      .filter((result) => result.dead)
      .map((result) => result.token);
    if (deadFallbackTokens.length > 0) {
      await supabase.from("push_tokens").delete().in("token", deadFallbackTokens);
    }
    const fallbackSummary = summarizePushResults(fallbackResults);
    return json({
      sent: fallbackSummary.sent,
      apnsSent: fallbackSummary.apnsSent +
        startResults.filter((r) => r.status === 200).length,
      fcmSent: fallbackSummary.fcmSent,
      liveActivitySent: startResults.filter((result) => result.status === 200).length,
      fallbackTotal: fallbackUserIds.length,
      liveActivityTotal: startRows.length,
      total: fallbackTokenRows.length + startRows.length,
      pruned: deadStartTokens.length + deadFallbackTokens.length,
    });
  }

  const sessions = await loadLiveSessions(payload, members, sender);
  const activityResults = sessions.length > 0
    ? await sendLiveActivities(sessions, members, memberByUser, payload)
    : [];
  const deadActivityTokens = activityResults
    .filter((result) => result.dead)
    .map((result) => result.token);
  if (deadActivityTokens.length > 0) {
    await supabase
      .from("live_activity_sessions")
      .delete()
      .in("push_token", deadActivityTokens);
  }
  if (payload.status !== "active") {
    await supabase.from("live_activity_sessions").delete().eq("group_id", payload.group_id);
  }
  return json({
    sent: 0,
    apnsSent: activityResults.filter((result) => result.status === 200).length,
    fcmSent: 0,
    liveActivitySent: activityResults.filter((result) => result.status === 200).length,
    liveActivityTotal: sessions.length,
    total: sessions.length,
    pruned: deadActivityTokens.length,
  });
}

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
  if (
    !["live_activity", "arrival", "straggler", "journey", "navigation_session"].includes(
      payload.category,
    )
  ) {
    return [];
  }

  let query = supabase
    .from("live_activity_sessions")
    .select(
      "user_id, group_id, destination_id, push_token, initial_distance_m, current_distance_m, eta_seconds, travel_mode",
    )
    .eq("group_id", payload.group_id)
    .not("push_token", "is", null);

  if (payload.category !== "navigation_session" || payload.status === "active") {
    query = query.gt("expires_at", new Date().toISOString());
  }

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

async function sendLiveActivities(
  sessions: LiveSessionRow[],
  members: MembershipRow[],
  memberByUser: Map<string, MembershipRow>,
  payload: PushPayload,
) {
  // Live Activity remote updates are APNs/ActivityKit only.
  const cfg: ApnsConfig = readApnsConfig();
  const jwt = await providerToken(cfg);

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
  const event = payload.category === "navigation_session"
    ? payload.status === "active" ? "update" as const : "end" as const
    : payload.category === "journey" && payload.status === "paused"
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
        navigationSessionId: payload.category === "navigation_session"
          ? payload.session_id ?? undefined
          : undefined,
        status: payload.category === "navigation_session"
          ? payload.status ?? undefined
          : undefined,
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
