// Authenticated Places / Routes proxy with per-user daily hard quotas.
// Client never holds GOOGLE_MAPS_SERVER_API_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeRoute, searchPlaces, validateRequest } from "./google.ts";
import {
  ROUTE_DAILY_LIMIT,
  SEARCH_DAILY_LIMIT,
  type GoogleMapsResponse,
} from "./types.ts";

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

function json(body: GoogleMapsResponse | { error: string }, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Never echo secrets.
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    return json({ error: "upstream_unavailable" }, 503);
  }

  let userId: string;
  try {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? token, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await userClient.auth.getUser(token);
    if (error || !data.user) {
      return json({ error: "unauthorized" }, 401);
    }
    userId = data.user.id;
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_input" }, 400);
  }

  const request = validateRequest(body);
  if (!request) {
    return json({ error: "invalid_input" }, 400);
  }

  const admin = createClient(supabaseUrl, readSupabaseAdminKey());
  const limit = request.action === "search" ? SEARCH_DAILY_LIMIT : ROUTE_DAILY_LIMIT;
  const { data: allowed, error: quotaError } = await admin.rpc("consume_google_maps_quota", {
    p_action: request.action,
    p_limit: limit,
    p_user_id: userId,
  });

  if (quotaError) {
    console.error("quota_rpc_failed", quotaError.message);
    return json({ error: "upstream_unavailable" }, 503);
  }
  if (allowed !== true) {
    return json({ error: "quota_exceeded" }, 429);
  }

  const apiKey = Deno.env.get("GOOGLE_MAPS_SERVER_API_KEY") ?? "";
  if (!apiKey) {
    // Fail closed without leaking configuration details.
    return json({ error: "upstream_unavailable" }, 503);
  }

  try {
    if (request.action === "search") {
      const places = await searchPlaces(apiKey, request.query, request.region);
      return json({ action: "search", places });
    }
    const route = await computeRoute(
      apiKey,
      request.from,
      request.to,
      request.travelMode,
    );
    return json({ action: "route", route });
  } catch (err) {
    console.error("google_upstream_failed", err instanceof Error ? err.message : "unknown");
    return json({ error: "upstream_unavailable" }, 503);
  }
});
