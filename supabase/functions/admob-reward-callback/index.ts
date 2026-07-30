/**
 * Public AdMob Rewarded SSV webhook.
 * Google does not send Supabase JWT — verify ECDSA signature in-handler.
 *
 * Callback URL:
 *   https://htqrucnjafhhvxdqslbv.supabase.co/functions/v1/admob-reward-callback
 *
 * Never logs signatures, full query, raw session refs, tokens, or PII.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ALLOWED_AD_UNITS,
  latencyBucketMs,
  platformFromAdUnit,
  verifySsvCallback,
  type KeyFetcher,
} from "./ssv.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

function readSupabaseAdminKey(): string {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const defaultKey = (JSON.parse(secretKeys) as Record<string, string>).default;
      if (defaultKey) return defaultKey;
    } catch {
      /* fall through */
    }
  }
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacyKey) throw new Error("Supabase admin key is not configured");
  return legacyKey;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/** Outcome-only log line (no signature / raw session / PII). */
function logOutcome(
  outcome: string,
  extra?: Record<string, string | number | boolean>,
): void {
  console.log(JSON.stringify({
    event: "admob_ssv",
    outcome,
    ...extra,
  }));
}

export type CreditRpc = (args: {
  session_ref: string;
  google_transaction_id: string;
  ad_unit: string;
  reward_amount: string;
  reward_item: string;
  platform_hint: string | null;
}) => Promise<{ ok: boolean; already_credited?: boolean; error?: string; balance?: number }>;

/**
 * AdMob URL verification and live SSV both require HTTP 200 once the endpoint
 * is reachable. Non-200 causes console "伺服器傳回 400" and Google retries.
 * Security stays in the body + credit path: only verified SSV credits a wallet.
 * Temporary outages still use 503 so Google can retry.
 */
function rejected200(
  started: number,
  reason: string,
  extra?: Record<string, string | number | boolean>,
): Response {
  logOutcome("rejected", {
    reason,
    latency: latencyBucketMs(Date.now() - started),
    ...extra,
  });
  return json(200, { ok: false, error: reason });
}

export async function handleAdmobRewardRequest(
  req: Request,
  deps?: {
    fetchKeys?: KeyFetcher;
    credit?: CreditRpc;
  },
): Promise<Response> {
  const started = Date.now();

  // AdMob / probes may use HEAD or OPTIONS when verifying the callback URL.
  if (req.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Cache-Control": "no-store",
      },
    });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const url = new URL(req.url);
  let queryString = url.search.startsWith("?") ? url.search.slice(1) : url.search;

  // Some test tools POST form body; prefer query string when present.
  if (!queryString && req.method === "POST") {
    try {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/x-www-form-urlencoded")) {
        queryString = await req.text();
      } else if (ct.includes("application/json")) {
        const body = await req.json() as Record<string, string>;
        queryString = new URLSearchParams(body).toString();
      }
    } catch {
      /* ignore */
    }
  }

  // AdMob console "Verify URL" probes the bare callback with no SSV query
  // params and requires HTTP 200. Real reward callbacks always include
  // signature + transaction_id; empty-query never credits.
  if (!queryString) {
    logOutcome("probe", { reason: "empty_query", latency: latencyBucketMs(Date.now() - started) });
    return json(200, { ok: true, probe: true });
  }

  const verified = await verifySsvCallback(queryString, {
    fetchKeys: deps?.fetchKeys,
  });

  if (!verified.ok) {
    // keys_unavailable is transient — ask Google to retry.
    if (verified.error === "keys_unavailable") {
      logOutcome("rejected", {
        reason: verified.error,
        latency: latencyBucketMs(Date.now() - started),
      });
      return json(503, { ok: false, error: verified.error });
    }
    // Invalid / incomplete SSV (incl. AdMob console test params): HTTP 200,
    // no credit. Returning 400 fails AdMob's "Verify URL" step.
    return rejected200(started, verified.error);
  }

  const { parsed } = verified;
  const adUnit = parsed.adUnit ?? "";
  if (!ALLOWED_AD_UNITS.has(adUnit)) {
    return rejected200(started, "invalid_ad_unit");
  }

  const sessionRef = parsed.customData ? decodeURIComponent(parsed.customData) : "";
  if (!sessionRef || sessionRef.length < 16) {
    return rejected200(started, "invalid_session");
  }

  const txn = parsed.transactionId ?? "";
  if (!txn) {
    return rejected200(started, "missing_transaction");
  }

  const platform = platformFromAdUnit(adUnit);

  const creditArgs = {
    session_ref: sessionRef,
    google_transaction_id: txn,
    ad_unit: adUnit,
    reward_amount: parsed.rewardAmount ?? "",
    reward_item: parsed.rewardItem ?? "",
    platform_hint: platform,
  };

  try {
    let result: { ok: boolean; already_credited?: boolean; error?: string; balance?: number };

    if (deps?.credit) {
      result = await deps.credit(creditArgs);
    } else {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      if (!supabaseUrl) throw new Error("SUPABASE_URL missing");
      const admin = createClient(supabaseUrl, readSupabaseAdminKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await admin.rpc("credit_rewarded_ad_transaction", {
        p_session_ref: creditArgs.session_ref,
        p_google_transaction_id: creditArgs.google_transaction_id,
        p_ad_unit: creditArgs.ad_unit,
        p_reward_amount: creditArgs.reward_amount,
        p_reward_item: creditArgs.reward_item,
        p_platform_hint: creditArgs.platform_hint,
      });
      if (error) {
        logOutcome("rejected", {
          reason: "rpc_error",
          latency: latencyBucketMs(Date.now() - started),
        });
        // Transient credit failure — allow Google retry.
        return json(503, { ok: false, error: "credit_failed" });
      }
      result = (data ?? { ok: false, error: "empty" }) as typeof result;
    }

    if (!result.ok) {
      // Business reject (bad session, wrong reward, etc.): ack with 200, no credit.
      return rejected200(started, result.error ?? "credit_denied");
    }

    logOutcome(result.already_credited ? "replay" : "credited", {
      platform: platform ?? "unknown",
      latency: latencyBucketMs(Date.now() - started),
    });
    return json(200, {
      ok: true,
      already_credited: !!result.already_credited,
    });
  } catch {
    logOutcome("rejected", {
      reason: "handler_error",
      latency: latencyBucketMs(Date.now() - started),
    });
    return json(500, { ok: false, error: "internal" });
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleAdmobRewardRequest(req));
}
