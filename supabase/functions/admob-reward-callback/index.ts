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

export async function handleAdmobRewardRequest(
  req: Request,
  deps?: {
    fetchKeys?: KeyFetcher;
    credit?: CreditRpc;
  },
): Promise<Response> {
  const started = Date.now();

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

  if (!queryString) {
    logOutcome("rejected", { reason: "empty_query", latency: latencyBucketMs(Date.now() - started) });
    return json(400, { ok: false, error: "empty_query" });
  }

  const verified = await verifySsvCallback(queryString, {
    fetchKeys: deps?.fetchKeys,
  });

  if (!verified.ok) {
    logOutcome("rejected", {
      reason: verified.error,
      latency: latencyBucketMs(Date.now() - started),
    });
    // Intentional HTTP 400 for invalid signature / malformed SSV:
    // - Does NOT credit (safe).
    // - Google retries non-200 up to ~5× (ops noise only).
    // - Prefer 400 over silent 200+ok:false so misconfigured AdMob / bad
    //   ECDSA keys surface in operator logs until SSV is healthy.
    // Valid txn replays return 200 below after successful verify + credit path.
    const status = verified.error === "keys_unavailable" ? 503 : 400;
    return json(status, { ok: false, error: verified.error });
  }

  const { parsed } = verified;
  const adUnit = parsed.adUnit ?? "";
  if (!ALLOWED_AD_UNITS.has(adUnit)) {
    logOutcome("rejected", {
      reason: "invalid_ad_unit",
      latency: latencyBucketMs(Date.now() - started),
    });
    return json(400, { ok: false, error: "invalid_ad_unit" });
  }

  const sessionRef = parsed.customData ? decodeURIComponent(parsed.customData) : "";
  if (!sessionRef || sessionRef.length < 16) {
    logOutcome("rejected", {
      reason: "invalid_session",
      latency: latencyBucketMs(Date.now() - started),
    });
    return json(400, { ok: false, error: "invalid_session" });
  }

  const txn = parsed.transactionId ?? "";
  if (!txn) {
    logOutcome("rejected", {
      reason: "missing_transaction",
      latency: latencyBucketMs(Date.now() - started),
    });
    return json(400, { ok: false, error: "missing_transaction" });
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
        return json(500, { ok: false, error: "credit_failed" });
      }
      result = (data ?? { ok: false, error: "empty" }) as typeof result;
    }

    if (!result.ok) {
      logOutcome("rejected", {
        reason: result.error ?? "credit_denied",
        latency: latencyBucketMs(Date.now() - started),
      });
      // Session/reward validation failures: 400. Idempotent already handled as ok.
      return json(400, { ok: false, error: result.error ?? "credit_denied" });
    }

    logOutcome(result.already_credited ? "replay" : "credited", {
      platform: platform ?? "unknown",
      latency: latencyBucketMs(Date.now() - started),
    });
    // Google expects HTTP 200 for successful processing (incl. idempotent replay).
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
