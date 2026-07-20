// Firebase Cloud Messaging HTTP v1 sender for Deno / Supabase Edge runtime.
// Uses a service-account JWT (RS256) to obtain a short-lived OAuth access token.
// Never log the service-account JSON, private key, access token, or full device token.

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface FcmResult {
  token: string;
  status: number;
  dead: boolean;
  provider: "fcm";
}

export interface FcmAlertPayload {
  title: string;
  body: string;
  data?: Record<string, string | undefined | null>;
}

export interface FcmDataOnlyPayload {
  data: Record<string, string>;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  const body = normalized
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function stringData(
  data: Record<string, string | undefined | null> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    out[key] = String(value);
  }
  return out;
}

/** Build FCM HTTP v1 message for a visible Android alert. */
export function buildFcmMessage(
  token: string,
  alert: FcmAlertPayload,
): { message: Record<string, unknown> } {
  return {
    message: {
      token,
      notification: { title: alert.title, body: alert.body },
      data: stringData(alert.data),
      android: { priority: "high" },
    },
  };
}

/** Build data-only high-priority message (e.g. location_refresh). */
export function buildFcmDataMessage(
  token: string,
  payload: FcmDataOnlyPayload,
): { message: Record<string, unknown> } {
  return {
    message: {
      token,
      data: stringData(payload.data),
      android: { priority: "high" },
    },
  };
}

let cachedAccess: { token: string; exp: number } | null = null;

export function readFcmConfig(): FcmConfig | null {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      return null;
    }
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
  } catch {
    return null;
  }
}

/** Exchange service-account JWT for OAuth access token; cache until 5 min before expiry. */
export async function fcmAccessToken(cfg: FcmConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccess && cachedAccess.exp - 5 * 60 > now) {
    return cachedAccess.token;
  }

  const header = base64url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const claims = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: cfg.clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(cfg.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${base64url(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM OAuth token exchange failed (${res.status})`);
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new Error("FCM OAuth response missing access_token");
  }
  const exp = now + (typeof body.expires_in === "number" ? body.expires_in : 3600);
  cachedAccess = { token: body.access_token, exp };
  return body.access_token;
}

export function isFcmDeadToken(status: number, errorBody: string): boolean {
  if (status === 404) return true;
  if (status !== 400 && status !== 404) return false;
  const upper = errorBody.toUpperCase();
  if (upper.includes("UNREGISTERED")) return true;
  if (upper.includes("INVALID_ARGUMENT") && upper.includes("TOKEN")) return true;
  if (upper.includes("INVALID_ARGUMENT") && upper.includes("REGISTRATION")) return true;
  // FCM returns NOT_FOUND for unregistered tokens in some error shapes.
  if (upper.includes("NOT_FOUND") && upper.includes("TOKEN")) return true;
  return false;
}

async function resultFromResponse(
  token: string,
  res: Response,
): Promise<FcmResult> {
  let body = "";
  if (!res.ok) {
    body = (await res.text().catch(() => "")) || "";
  }
  return {
    token,
    status: res.status,
    dead: isFcmDeadToken(res.status, body),
    provider: "fcm",
  };
}

export async function sendFcm(
  cfg: FcmConfig,
  accessToken: string,
  deviceToken: string,
  alert: FcmAlertPayload,
): Promise<FcmResult> {
  const url =
    `https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildFcmMessage(deviceToken, alert)),
  });
  return resultFromResponse(deviceToken, res);
}

export async function sendFcmData(
  cfg: FcmConfig,
  accessToken: string,
  deviceToken: string,
  payload: FcmDataOnlyPayload,
): Promise<FcmResult> {
  const url =
    `https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildFcmDataMessage(deviceToken, payload)),
  });
  return resultFromResponse(deviceToken, res);
}

/** Reset OAuth cache (tests only). */
export function __resetFcmTokenCacheForTests(): void {
  cachedAccess = null;
}
