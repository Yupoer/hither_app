/**
 * App Store Server API client (#223 / #235).
 * Connect keys stay in the Edge secret manager. Never log P8, JWS, or JWT.
 */

import { importPKCS8, SignJWT } from 'npm:jose@5.10.0';
import {
  storeKitConfigFromEnv,
  validateStoreKitTransaction,
  verifyStoreKitJws,
  type StoreKitEnvironment,
  type StoreKitVerificationConfig,
  type ValidatedStoreKitTransaction,
} from './storekit.ts';

const PRODUCTION_API = 'https://api.storekit.itunes.apple.com';
const SANDBOX_API = 'https://api.storekit-sandbox.itunes.apple.com';

export type AppStoreServerSecrets = {
  issuerId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
};

let cachedJwt: { token: string; expiresAtMs: number } | null = null;

export function appStoreServerSecretsFromEnv(
  env: (name: string) => string | undefined,
): AppStoreServerSecrets | null {
  const issuerId = env('APPLE_ISSUER_ID')?.trim() ?? '';
  const keyId = env('APPLE_KEY_ID')?.trim() ?? '';
  const privateKey = (env('APPLE_PRIVATE_KEY') ?? env('APPLE_P8') ?? '').trim();
  const bundleId = env('APPLE_BUNDLE_ID')?.trim() ?? '';
  if (!issuerId || !keyId || !privateKey || !bundleId) return null;
  return { issuerId, keyId, privateKey, bundleId };
}

export async function createAppStoreConnectJwt(
  secrets: AppStoreServerSecrets,
  nowMs = Date.now(),
): Promise<string> {
  if (cachedJwt && cachedJwt.expiresAtMs - 30_000 > nowMs) return cachedJwt.token;
  const key = await importPKCS8(normalizeP8(secrets.privateKey), 'ES256');
  const expiresAtMs = nowMs + 20 * 60 * 1000;
  const token = await new SignJWT({ bid: secrets.bundleId })
    .setProtectedHeader({ alg: 'ES256', kid: secrets.keyId, typ: 'JWT' })
    .setIssuer(secrets.issuerId)
    .setAudience('appstoreconnect-v1')
    .setIssuedAt(Math.floor(nowMs / 1000))
    .setExpirationTime(Math.floor(expiresAtMs / 1000))
    .sign(key);
  cachedJwt = { token, expiresAtMs };
  return token;
}

export function __resetAppStoreConnectJwtCacheForTests(): void {
  cachedJwt = null;
}

function normalizeP8(value: string): string {
  const trimmed = value.replace(/\\n/g, '\n').trim();
  if (trimmed.includes('BEGIN PRIVATE KEY')) return trimmed;
  const body = trimmed.replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [body];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

function apiBase(environment: StoreKitEnvironment): string {
  return environment === 'Sandbox' ? SANDBOX_API : PRODUCTION_API;
}

export type AppleFetch = (
  input: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export async function fetchSignedTransactionInfo(options: {
  secrets: AppStoreServerSecrets;
  transactionId: string;
  environment: StoreKitEnvironment;
  fetchImpl?: AppleFetch;
  nowMs?: number;
  connectJwt?: string;
}): Promise<{ ok: true; signedTransaction: string } | { ok: false; error: string; status: number }> {
  const token = options.connectJwt
    ?? await createAppStoreConnectJwt(options.secrets, options.nowMs);
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as AppleFetch);
  const url = `${apiBase(options.environment)}/inApps/v1/transactions/${encodeURIComponent(options.transactionId)}`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 429) return { ok: false, error: 'apple_rate_limited', status: 429 };
  if (!response.ok) return { ok: false, error: 'apple_transaction_lookup_failed', status: response.status };
  const payload = await response.json() as { signedTransactionInfo?: unknown };
  if (typeof payload.signedTransactionInfo !== 'string' || !payload.signedTransactionInfo) {
    return { ok: false, error: 'apple_transaction_missing', status: 502 };
  }
  return { ok: true, signedTransaction: payload.signedTransactionInfo };
}

export async function fetchSubscriptionStatuses(options: {
  secrets: AppStoreServerSecrets;
  originalTransactionId: string;
  environment: StoreKitEnvironment;
  fetchImpl?: AppleFetch;
  nowMs?: number;
  connectJwt?: string;
}): Promise<{ ok: true; signedTransactions: string[] } | { ok: false; error: string; status: number }> {
  const token = options.connectJwt
    ?? await createAppStoreConnectJwt(options.secrets, options.nowMs);
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as AppleFetch);
  const url = `${apiBase(options.environment)}/inApps/v1/subscriptions/${encodeURIComponent(options.originalTransactionId)}`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 429) return { ok: false, error: 'apple_rate_limited', status: 429 };
  if (!response.ok) return { ok: false, error: 'apple_subscription_lookup_failed', status: response.status };
  const payload = await response.json() as {
    data?: Array<{ lastTransactions?: Array<{ signedTransactionInfo?: string }> }>;
  };
  const signed: string[] = [];
  for (const group of payload.data ?? []) {
    for (const item of group.lastTransactions ?? []) {
      if (typeof item.signedTransactionInfo === 'string' && item.signedTransactionInfo) {
        signed.push(item.signedTransactionInfo);
      }
    }
  }
  if (signed.length === 0) return { ok: false, error: 'apple_subscription_missing', status: 404 };
  return { ok: true, signedTransactions: signed };
}

export async function verifyAppleSignedTransaction(
  signedTransaction: string,
  config: StoreKitVerificationConfig,
  nowMs: number,
  verifyJws = verifyStoreKitJws,
): Promise<{ ok: true; transaction: ValidatedStoreKitTransaction } | { ok: false; error: string }> {
  const verified = await verifyJws(signedTransaction, config);
  if (!verified.ok) return verified;
  return validateStoreKitTransaction(verified.payload, config, nowMs, verified.jwsSha256);
}

export function storeKitConfigOrNull(
  env: (name: string) => string | undefined,
): StoreKitVerificationConfig | null {
  return storeKitConfigFromEnv(env);
}
