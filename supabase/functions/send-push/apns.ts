// APNs over HTTP/2 with token-based (.p8) auth, for Deno / Supabase Edge runtime.
//
// Deno's fetch negotiates HTTP/2 for https automatically, which APNs requires.
// The provider token is a short-lived ES256 JWT signed with the .p8 key; Apple
// allows reusing it for up to ~1h, so we cache it per cold start.

interface ApnsConfig {
  /** Full PEM contents of the AuthKey_XXX.p8 (PKCS#8). */
  key: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  /** 'sandbox' for dev builds, 'production' for TestFlight/App Store. */
  env: "sandbox" | "production";
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let cachedToken: { jwt: string; iat: number } | null = null;

/** Build (or reuse) the APNs provider JWT. Refreshes after ~50 minutes. */
export async function providerToken(cfg: ApnsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedToken.iat < 50 * 60) {
    return cachedToken.jwt;
  }
  const header = base64url(
    new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: cfg.keyId })),
  );
  const claims = base64url(
    new TextEncoder().encode(JSON.stringify({ iss: cfg.teamId, iat: now })),
  );
  const signingInput = `${header}.${claims}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(cfg.key),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  // Web Crypto returns the raw r||s signature, which is exactly ES256/JWT form.
  const jwt = `${signingInput}.${base64url(new Uint8Array(sig))}`;
  cachedToken = { jwt, iat: now };
  return jwt;
}

export interface ApnsResult {
  token: string;
  status: number;
  /** True when Apple says the token is permanently invalid (410 / BadDeviceToken). */
  dead: boolean;
}

/** Send one alert notification to a single device token. */
export async function sendApns(
  cfg: ApnsConfig,
  jwt: string,
  deviceToken: string,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<ApnsResult> {
  const host = cfg.env === "production"
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";
  const res = await fetch(`https://${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
      },
      ...(payload.data ?? {}),
    }),
  });
  let reason = "";
  if (res.status !== 200) {
    reason = (await res.text().catch(() => "")) || "";
  }
  const dead = res.status === 410 || reason.includes("BadDeviceToken") ||
    reason.includes("Unregistered");
  return { token: deviceToken, status: res.status, dead };
}

export function readApnsConfig(): ApnsConfig {
  const env = (Deno.env.get("APNS_ENV") ?? "sandbox") as
    | "sandbox"
    | "production";
  const key = Deno.env.get("APNS_KEY");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const bundleId = Deno.env.get("APNS_BUNDLE_ID");
  if (!key || !keyId || !teamId || !bundleId) {
    throw new Error(
      "Missing APNs secrets: set APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID (and optionally APNS_ENV).",
    );
  }
  return { key, keyId, teamId, bundleId, env };
}
