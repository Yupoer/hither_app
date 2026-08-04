/**
 * Apple StoreKit 2 JWS verification and payload validation.
 *
 * The verifier is intentionally server-only. The mobile client may forward a
 * StoreKit JWS, but it cannot choose the account, product, bundle, environment,
 * ownership, expiry, or revocation outcome.
 */

import { compactVerify, importX509 } from "npm:jose@5.10.0";

export type StoreKitTransactionPayload = {
  appAccountToken?: string;
  bundleId?: string;
  environment?: string;
  expiresDate?: number;
  inAppOwnershipType?: string;
  originalPurchaseDate?: number;
  originalTransactionId?: string;
  productId?: string;
  purchaseDate?: number;
  revocationDate?: number;
  revocationReason?: number;
  signedDate?: number;
  subscriptionGroupIdentifier?: string;
  transactionId?: string;
  type?: string;
  [key: string]: unknown;
};

export type StoreKitJwsHeader = {
  alg?: string;
  x5c?: string[];
  [key: string]: unknown;
};

export type StoreKitVerificationConfig = {
  bundleId: string;
  environment: 'Production' | 'Sandbox' | 'Xcode';
  productIds: readonly string[];
  subscriptionGroupId: string;
  appAccountToken: string;
  appleRootCertSha256: string;
};

export type ValidatedStoreKitTransaction = {
  payload: StoreKitTransactionPayload;
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  subscriptionGroupId: string;
  environment: 'Production' | 'Sandbox' | 'Xcode';
  ownershipType: 'PURCHASED';
  appAccountToken: string;
  status: 'active' | 'expired' | 'revoked';
  purchaseDate: string;
  expiresAt: string;
  revocationDate: string | null;
  signedAt: string;
  jwsSha256: string;
};

export type StoreKitVerificationResult =
  | {
    ok: true;
    header: StoreKitJwsHeader;
    payload: StoreKitTransactionPayload;
    jwsSha256: string;
  }
  | { ok: false; error: string };

function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeBase64(input: string): Uint8Array {
  const binary = atob(input);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(part))) as T;
}

function toPem(derBase64: string): string {
  const lines = derBase64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

async function verifyAppleCertificateChain(x5c: string[], rootFingerprint: string): Promise<void> {
  if (x5c.length < 2 || !rootFingerprint.trim()) {
    throw new Error('apple_certificate_chain_not_configured');
  }

  // `jose` verifies the JWS with the leaf key. X509ChainBuilder verifies the
  // certificate signatures and the pinned final Apple root prevents a foreign
  // chain from being accepted. Both checks are required.
  await import('npm:reflect-metadata');
  const { X509Certificate, X509ChainBuilder } = await import('npm:@peculiar/x509@2.0.0');
  const certificates = x5c.map((item) => new X509Certificate(decodeBase64(item)));
  const chain = new X509ChainBuilder({ certificates });
  const built = await chain.build(certificates[0]);
  const root = built[built.length - 1];
  const rootHash = hex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', root.rawData)),
  );
  if (rootHash.toLowerCase() !== rootFingerprint.trim().toLowerCase()) {
    throw new Error('apple_root_certificate_mismatch');
  }
}

export async function verifyStoreKitJws(
  compactJws: string,
  config: Pick<StoreKitVerificationConfig, 'appleRootCertSha256'>,
): Promise<StoreKitVerificationResult> {
  const parts = compactJws.split('.');
  if (parts.length !== 3 || compactJws.length > 64 * 1024) {
    return { ok: false, error: 'malformed_jws' };
  }

  try {
    const header = decodeJson<StoreKitJwsHeader>(parts[0]);
    if (header.alg !== 'ES256' || !Array.isArray(header.x5c)) {
      return { ok: false, error: 'unsupported_jws_header' };
    }
    await verifyAppleCertificateChain(header.x5c, config.appleRootCertSha256);
    const key = await importX509(toPem(header.x5c[0]), 'ES256');
    const verified = await compactVerify(compactJws, key, { algorithms: ['ES256'] });
    const payload = JSON.parse(new TextDecoder().decode(verified.payload)) as StoreKitTransactionPayload;
    return {
      ok: true,
      header,
      payload,
      jwsSha256: await sha256Hex(compactJws),
    };
  } catch {
    return { ok: false, error: 'jws_signature_or_chain_invalid' };
  }
}

function dateFromMilliseconds(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function validateStoreKitTransaction(
  payload: StoreKitTransactionPayload,
  config: Omit<StoreKitVerificationConfig, 'appleRootCertSha256'>,
  nowMs = Date.now(),
  jwsSha256 = '',
): { ok: true; transaction: ValidatedStoreKitTransaction } | { ok: false; error: string } {
  if (payload.bundleId !== config.bundleId) return { ok: false, error: 'bundle_mismatch' };
  if (payload.environment !== config.environment) return { ok: false, error: 'environment_mismatch' };
  if (!payload.productId || !config.productIds.includes(payload.productId)) {
    return { ok: false, error: 'product_mismatch' };
  }
  if (payload.subscriptionGroupIdentifier !== config.subscriptionGroupId) {
    return { ok: false, error: 'subscription_group_mismatch' };
  }
  if (payload.type !== 'Auto-Renewable Subscription') {
    return { ok: false, error: 'transaction_type_mismatch' };
  }
  if (payload.inAppOwnershipType !== 'PURCHASED') {
    return { ok: false, error: 'ownership_mismatch' };
  }
  if (
    typeof payload.appAccountToken !== 'string'
    || payload.appAccountToken.toLowerCase() !== config.appAccountToken.toLowerCase()
  ) {
    return { ok: false, error: 'account_token_mismatch' };
  }
  if (
    typeof payload.transactionId !== 'string'
    || typeof payload.originalTransactionId !== 'string'
    || !payload.transactionId
    || !payload.originalTransactionId
    || !payload.signedDate
  ) {
    return { ok: false, error: 'transaction_identity_missing' };
  }
  const signedAt = dateFromMilliseconds(payload.signedDate);
  const purchaseDate = dateFromMilliseconds(payload.purchaseDate);
  const expiresAt = dateFromMilliseconds(payload.expiresDate);
  if (!signedAt || !purchaseDate || !expiresAt) {
    return { ok: false, error: 'transaction_date_invalid' };
  }
  if (Date.parse(expiresAt) <= Date.parse(purchaseDate)) {
    return { ok: false, error: 'transaction_expiry_invalid' };
  }

  // A revocation field is optional, but an emitted field must be valid. Do
  // not let malformed revocation data fall through as an active entitlement.
  const hasRevocationDate = Object.prototype.hasOwnProperty.call(payload, 'revocationDate');
  const revocationDate = hasRevocationDate
    ? dateFromMilliseconds(payload.revocationDate)
    : null;
  if (
    hasRevocationDate
    && (
      !revocationDate
      || Date.parse(revocationDate) < Date.parse(purchaseDate)
    )
  ) {
    return { ok: false, error: 'transaction_revocation_date_invalid' };
  }
  const status = revocationDate
    ? 'revoked'
    : payload.expiresDate != null && payload.expiresDate <= nowMs
      ? 'expired'
      : 'active';
  return {
    ok: true,
    transaction: {
      payload,
      transactionId: payload.transactionId,
      originalTransactionId: payload.originalTransactionId,
      productId: payload.productId,
      subscriptionGroupId: payload.subscriptionGroupIdentifier,
      environment: payload.environment,
      ownershipType: 'PURCHASED',
      appAccountToken: payload.appAccountToken,
      status,
      purchaseDate,
      expiresAt,
      revocationDate,
      signedAt,
      jwsSha256,
    },
  };
}

export function storeKitConfigFromEnv(
  env: (name: string) => string | undefined,
): StoreKitVerificationConfig | null {
  const bundleId = env('APPLE_BUNDLE_ID')?.trim() ?? '';
  const environment = env('APPLE_STORE_ENVIRONMENT')?.trim() ?? '';
  const productIds = (env('PREMIUM_PRODUCT_IDS') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const subscriptionGroupId = env('PREMIUM_SUBSCRIPTION_GROUP_ID')?.trim() ?? '';
  const appleRootCertSha256 = env('APPLE_ROOT_CERT_SHA256')?.trim() ?? '';
  if (
    !bundleId
    || !['Production', 'Sandbox', 'Xcode'].includes(environment)
    || productIds.length !== 2
    || new Set(productIds).size !== 2
    || !subscriptionGroupId
    || !appleRootCertSha256
  ) return null;
  return {
    bundleId,
    environment: environment as StoreKitVerificationConfig['environment'],
    productIds,
    subscriptionGroupId,
    appAccountToken: '',
    appleRootCertSha256,
  };
}
