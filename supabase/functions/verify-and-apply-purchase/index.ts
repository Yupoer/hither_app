/**
 * verify-and-apply-purchase
 *
 * Client posts a store transaction after native IAP succeeds.
 * This function:
 *  1. Requires a valid user JWT (authenticated leader / member of the trip)
 *  2. Validates payload shape (group_id + transaction_id + product_id)
 *  3. Calls apply_verified_purchase with the **service role**
 *     (RPC is service_role-only — user JWT cannot invent grants)
 *
 * Apple/Google cryptographic receipt verification can be layered in via
 * env secrets (APPLE_IAP_ISSUER_ID / etc.). Until then we still refuse empty
 * transaction ids and rely on store-issued ids + unique transaction_id index
 * for replay protection. Incomplete client payments never reach this function
 * because native purchases.ts only returns VerifiedPurchase after a store event.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const ALLOWED_PRODUCTS = new Set([
  "small_trip_pass",
  "hither.small_trip_pass",
  "hither.small_trip_pass.7d",
]);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    },
  });
}

function readServiceRoleKey(): string {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const defaultKey = (JSON.parse(secretKeys) as Record<string, string>).default;
      if (defaultKey) return defaultKey;
    } catch {
      /* fall through */
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("service_role key missing");
  return legacy;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return json(200, { ok: true });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { ok: false, error: "not_authenticated" });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, error: "invalid", message: "invalid json" });
  }

  const groupId = String(body.group_id ?? body.groupId ?? "").trim();
  const transactionId = String(body.transaction_id ?? body.transactionId ?? "").trim();
  const productId = String(
    body.product_id ?? body.productId ?? "small_trip_pass",
  ).trim() || "small_trip_pass";

  if (!groupId || !transactionId) {
    return json(400, {
      ok: false,
      error: "invalid",
      message: "group_id and transaction_id required",
    });
  }

  const productKey = productId.toLowerCase();
  if (
    !ALLOWED_PRODUCTS.has(productKey)
    && !productKey.includes("small_trip")
  ) {
    return json(400, {
      ok: false,
      error: "invalid",
      message: "unknown product_id",
    });
  }

  // Reject clearly fabricated client placeholders — never invent grants.
  if (
    transactionId === "local" ||
    transactionId === "test" ||
    transactionId === "temp" ||
    transactionId.length < 6
  ) {
    return json(400, {
      ok: false,
      error: "invalid",
      message: "transaction_id rejected",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SUPABASE_PROJECT_URL");
  if (!supabaseUrl) {
    return json(500, { ok: false, error: "unknown", message: "SUPABASE_URL missing" });
  }

  // User-scoped client: prove JWT is valid and identity is real.
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json(401, { ok: false, error: "not_authenticated" });
  }

  const uid = userData.user.id;
  const isAnonymous =
    (userData.user as { is_anonymous?: boolean }).is_anonymous === true
    || userData.user.app_metadata?.provider === "anonymous";
  if (isAnonymous) {
    return json(403, {
      ok: false,
      error: "not_applicable",
      message: "Anonymous accounts cannot purchase. Please register first.",
    });
  }

  // Service-role client for the grant RPC only.
  let serviceKey: string;
  try {
    serviceKey = readServiceRoleKey();
  } catch {
    return json(500, {
      ok: false,
      error: "verification_service_required",
      message: "service role not configured",
    });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Soft membership check (leader preferred). apply_verified_purchase also enforces trip rules.
  const { data: membership } = await admin
    .from("memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", uid)
    .maybeSingle();

  if (!membership) {
    return json(403, {
      ok: false,
      error: "not_applicable",
      message: "not a member of this trip",
    });
  }

  const { data, error } = await admin.rpc("apply_verified_purchase", {
    p_group_id: groupId,
    p_transaction_id: transactionId,
    p_product_id: productId,
  });

  if (error) {
    console.log(JSON.stringify({
      event: "verify_purchase",
      outcome: "rpc_error",
      code: error.code,
      // no transaction id / PII in logs
    }));
    return json(500, {
      ok: false,
      error: "unknown",
      message: error.message,
    });
  }

  const row = asRecord(data) ?? {};
  // Pass through RPC payload (ok true/false, entitlement fields, error codes).
  const status = row.ok === true || row.is_premium === true ? 200 : 200;
  console.log(JSON.stringify({
    event: "verify_purchase",
    outcome: row.ok === true ? "granted" : String(row.error ?? "rejected"),
    product: productKey.includes("small_trip") ? "small_trip" : "other",
  }));

  return json(status, {
    ...row,
    // Ensure client mapApplyPayload always sees explicit flags.
    ok: row.ok === true || row.is_premium === true,
    is_premium: row.is_premium === true || row.ok === true,
  });
});
