/**
 * Google AdMob Rewarded Ads SSV (server-side verification) helpers.
 * Manual ECDSA verify per Google docs:
 * https://developers.google.com/admob/android/ssv
 *
 * Content to verify = query string before `&signature=` (order preserved).
 * Signature is base64 ECDSA-SHA256 **DER** (ASN.1). Web Crypto requires
 * IEEE P1363 (r‖s), so we convert DER → raw before subtle.verify.
 */

export const GOOGLE_SSV_KEYS_URL =
  "https://www.gstatic.com/admob/reward/verifier-keys.json";

/** In-process key cache TTL (Google recommends ≤ 24h). */
export const SSV_KEY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const ALLOWED_AD_UNITS = new Set([
  "ca-app-pub-8135109277557342/7899053731", // iOS rewarded
  "ca-app-pub-8135109277557342/7100977386", // Android rewarded
]);

export type SsvPublicKey = {
  keyId: number;
  pem?: string;
  base64: string;
};

export type SsvKeysPayload = {
  keys: SsvPublicKey[];
};

export type ParsedSsvQuery = {
  /** Original query string (without leading ?) */
  queryString: string;
  /** Content bytes for signature verify (before &signature=) */
  contentToVerify: string;
  signatureBase64: string;
  keyId: number;
  adUnit: string | null;
  customData: string | null;
  rewardAmount: string | null;
  rewardItem: string | null;
  transactionId: string | null;
  timestamp: string | null;
};

export type SsvVerifyResult =
  | { ok: true; parsed: ParsedSsvQuery }
  | { ok: false; error: string };

export type KeyFetcher = () => Promise<SsvKeysPayload>;

type KeyCacheEntry = {
  keys: SsvKeysPayload;
  fetchedAt: number;
};

let keyCache: KeyCacheEntry | null = null;

/** Test helper: clear in-memory SSV key cache. */
export function __resetSsvKeyCacheForTests(): void {
  keyCache = null;
}

/** Default production key fetcher (injectable for tests). */
export async function fetchGoogleSsvKeys(
  fetchImpl: typeof fetch = fetch,
): Promise<SsvKeysPayload> {
  const res = await fetchImpl(GOOGLE_SSV_KEYS_URL);
  if (!res.ok) {
    throw new Error(`ssv_keys_http_${res.status}`);
  }
  const body = await res.json() as SsvKeysPayload;
  if (!body?.keys?.length) {
    throw new Error("ssv_keys_empty");
  }
  return body;
}

/**
 * Cached key fetch: fresh within TTL; on fetch failure returns last good keys
 * if any (stale fallback). Throws only when no keys are available at all.
 */
export async function getGoogleSsvKeysCached(
  fetchKeys: KeyFetcher = fetchGoogleSsvKeys,
  now: () => number = Date.now,
): Promise<SsvKeysPayload> {
  const t = now();
  if (keyCache && t - keyCache.fetchedAt < SSV_KEY_CACHE_TTL_MS) {
    return keyCache.keys;
  }
  try {
    const keys = await fetchKeys();
    keyCache = { keys, fetchedAt: t };
    return keys;
  } catch (err) {
    if (keyCache?.keys?.keys?.length) {
      return keyCache.keys;
    }
    throw err;
  }
}

/**
 * Parse SSV query. Signature and key_id must be the last two params
 * (signature then key_id) per Google docs; we still locate them safely.
 */
export function parseSsvQueryString(queryString: string): ParsedSsvQuery | null {
  const qs = queryString.startsWith("?") ? queryString.slice(1) : queryString;
  if (!qs) return null;

  // Google: content = query substring before "&signature=" (exclude the &).
  const sigMarker = "signature=";
  const sigIdx = qs.indexOf(sigMarker);
  if (sigIdx <= 0) return null;
  const contentToVerify = qs.slice(0, sigIdx - 1); // drop trailing &

  const afterSig = qs.slice(sigIdx + sigMarker.length);
  const amp = afterSig.indexOf("&");
  const signatureBase64 = amp === -1 ? afterSig : afterSig.slice(0, amp);
  if (!signatureBase64) return null;

  const keyMarker = "key_id=";
  const keyIdx = qs.indexOf(keyMarker);
  if (keyIdx === -1) return null;
  const keyRaw = qs.slice(keyIdx + keyMarker.length).split("&")[0] ?? "";
  const keyId = Number(keyRaw);
  if (!Number.isFinite(keyId)) return null;

  const params = new URLSearchParams(qs);
  return {
    queryString: qs,
    contentToVerify,
    signatureBase64: decodeURIComponent(signatureBase64),
    keyId,
    adUnit: params.get("ad_unit"),
    customData: params.get("custom_data"),
    rewardAmount: params.get("reward_amount"),
    rewardItem: params.get("reward_item"),
    transactionId: params.get("transaction_id"),
    timestamp: params.get("timestamp"),
  };
}

export function base64UrlToBytes(input: string): Uint8Array {
  let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function spkiFromBase64Key(base64: string): Uint8Array {
  // Google provides SPKI (SubjectPublicKeyInfo) base64 for EC keys.
  return base64UrlToBytes(base64.replace(/\s+/g, ""));
}

/**
 * Convert ASN.1 DER ECDSA signature (SEQUENCE of two INTEGERs) to IEEE P1363
 * fixed-width r‖s for P-256 (32 + 32 = 64 bytes). Web Crypto subtle.verify
 * requires P1363; Google SSV delivers DER (e.g. base64 starting with MEUCI…).
 */
export function derEcdsaSignatureToP1363(
  der: Uint8Array,
  componentLen = 32,
): Uint8Array {
  let offset = 0;
  if (der[offset++] !== 0x30) {
    throw new Error("der_not_sequence");
  }
  // length (short or long form)
  let seqLen = der[offset++]!;
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < n; i++) {
      seqLen = (seqLen << 8) | der[offset++]!;
    }
  }
  void seqLen;

  const readInt = (): Uint8Array => {
    if (der[offset++] !== 0x02) throw new Error("der_not_integer");
    const len = der[offset++]!;
    if (len === 0 || offset + len > der.length) throw new Error("der_int_bounds");
    let bytes = der.subarray(offset, offset + len);
    offset += len;
    // Strip leading zero pad used for positive INTEGER encoding.
    while (bytes.length > componentLen && bytes[0] === 0) {
      bytes = bytes.subarray(1);
    }
    if (bytes.length > componentLen) throw new Error("der_component_too_long");
    return bytes;
  };

  const r = readInt();
  const s = readInt();
  const out = new Uint8Array(componentLen * 2);
  out.set(r, componentLen - r.length);
  out.set(s, componentLen * 2 - s.length);
  return out;
}

/**
 * Encode IEEE P1363 r‖s as ASN.1 DER ECDSA signature (for fixtures / tests).
 */
export function p1363EcdsaSignatureToDer(
  raw: Uint8Array,
  componentLen = 32,
): Uint8Array {
  if (raw.length !== componentLen * 2) {
    throw new Error("p1363_length");
  }
  const encodeInt = (half: Uint8Array): number[] => {
    let i = 0;
    while (i < half.length - 1 && half[i] === 0) i++;
    let bytes = Array.from(half.subarray(i));
    // Leading 0x00 if high bit set (positive INTEGER).
    if (bytes[0]! & 0x80) bytes = [0, ...bytes];
    return [0x02, bytes.length, ...bytes];
  };
  const r = encodeInt(raw.subarray(0, componentLen));
  const s = encodeInt(raw.subarray(componentLen));
  const body = [...r, ...s];
  if (body.length < 128) {
    return Uint8Array.from([0x30, body.length, ...body]);
  }
  // Long-form length (not expected for P-256 but keep general).
  return Uint8Array.from([0x30, 0x81, body.length, ...body]);
}

/**
 * Normalize signature bytes for Web Crypto: accept DER or already-P1363 (64B).
 */
export function signatureToP1363(signature: Uint8Array): Uint8Array {
  if (signature.length === 64) {
    // Already raw r‖s (some stacks); still accept.
    return signature;
  }
  if (signature[0] === 0x30) {
    return derEcdsaSignatureToP1363(signature);
  }
  throw new Error("unknown_signature_encoding");
}

export async function verifyEcdsaSha256(
  contentUtf8: string,
  signatureBase64: string,
  publicKeyBase64: string,
): Promise<boolean> {
  const keyData = spkiFromBase64Key(publicKeyBase64);
  const cryptoKey = await crypto.subtle.importKey(
    "spki",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(contentUtf8);
  const signatureRaw = base64UrlToBytes(signatureBase64);
  const signatureP1363 = signatureToP1363(signatureRaw);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    signatureP1363,
    data,
  );
}

export async function verifySsvCallback(
  queryString: string,
  options?: {
    fetchKeys?: KeyFetcher;
    keys?: SsvKeysPayload;
  },
): Promise<SsvVerifyResult> {
  const parsed = parseSsvQueryString(queryString);
  if (!parsed) {
    return { ok: false, error: "malformed_query" };
  }
  if (!parsed.signatureBase64 || !parsed.contentToVerify) {
    return { ok: false, error: "missing_signature" };
  }

  let keys: SsvKeysPayload;
  try {
    keys = options?.keys ??
      (await getGoogleSsvKeysCached(options?.fetchKeys ?? fetchGoogleSsvKeys));
  } catch {
    return { ok: false, error: "keys_unavailable" };
  }

  const match = keys.keys.find((k) => Number(k.keyId) === parsed.keyId);
  if (!match?.base64) {
    return { ok: false, error: "unknown_key" };
  }

  let valid = false;
  try {
    valid = await verifyEcdsaSha256(
      parsed.contentToVerify,
      parsed.signatureBase64,
      match.base64,
    );
  } catch {
    return { ok: false, error: "verify_error" };
  }

  if (!valid) {
    return { ok: false, error: "invalid_signature" };
  }

  return { ok: true, parsed };
}

/** Latency bucket for diagnostics (ms) — no raw timestamps. */
export function latencyBucketMs(ms: number): string {
  if (ms < 100) return "lt_100";
  if (ms < 500) return "lt_500";
  if (ms < 2000) return "lt_2s";
  if (ms < 10000) return "lt_10s";
  return "gte_10s";
}

export function platformFromAdUnit(adUnit: string | null): "ios" | "android" | null {
  if (adUnit === "ca-app-pub-8135109277557342/7899053731") return "ios";
  if (adUnit === "ca-app-pub-8135109277557342/7100977386") return "android";
  return null;
}
