/**
 * App Store Server API compensation path (#223 / #235).
 * POST /functions/v1/sync-app-store-subscription
 *
 * User JWT + optional device JWS, or service_role + already-bound
 * originalTransactionId. Never webhook-only. Never log P8 / JWS / JWT.
 * Play Developer API is intentionally not used.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  appStoreServerSecretsFromEnv,
  fetchSignedTransactionInfo,
  fetchSubscriptionStatuses,
  verifyAppleSignedTransaction,
  type AppleFetch,
} from '../_shared/appStoreServerApi.ts';
import {
  allowedStoreKitEnvironments,
  storeKitConfigFromEnv,
  type StoreKitEnvironment,
  verifyStoreKitJws,
} from '../_shared/storekit.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

type JsonRecord = Record<string, unknown>;

type AdminQuery = {
  select: (columns: string) => AdminQuery;
  eq: (column: string, value: unknown) => AdminQuery;
  maybeSingle: () => Promise<{ data: JsonRecord | null; error: unknown | null }>;
};

type AdminClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown | null }>;
  from: (table: string) => AdminQuery;
};

type UserClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; is_anonymous?: boolean; role?: string } | null };
      error: unknown | null;
    }>;
  };
};

export type SyncHandlerDependencies = {
  env?: (name: string) => string | undefined;
  now?: () => number;
  verifyJws?: typeof verifyStoreKitJws;
  createAdmin?: (url: string, key: string) => AdminClient;
  createUser?: (url: string, anonKey: string, authorization: string) => UserClient;
  fetchImpl?: AppleFetch;
  connectJwt?: string;
};

function json(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function outcomeLog(outcome: string): void {
  console.log(JSON.stringify({ event: 'app_store_subscription_sync', outcome }));
}

function adminKey(env: (name: string) => string | undefined): string {
  const secretKeys = env('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const defaultKey = (JSON.parse(secretKeys) as Record<string, string>).default;
      if (defaultKey) return defaultKey;
    } catch {
      // Legacy key below.
    }
  }
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('supabase_admin_key_missing');
  return key;
}

function defaultAdminClient(url: string, key: string): AdminClient {
  return createClient(url, key) as unknown as AdminClient;
}

function defaultUserClient(url: string, anonKey: string, authorization: string): UserClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  }) as unknown as UserClient;
}

function requiredString(body: JsonRecord, ...names: string[]): string | null {
  for (const name of names) {
    if (typeof body[name] === 'string' && body[name].trim()) return body[name].trim();
  }
  return null;
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

function base64UrlToBytes(part: string): Uint8Array {
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifiedHs256Role(token: string, secret: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  let header: { alg?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerPart))) as { alg?: string };
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${headerPart}.${payloadPart}`)),
  );
  const actual = base64UrlToBytes(signaturePart);
  if (expected.length !== actual.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected[i] ^ actual[i];
  if (mismatch !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart))) as {
      role?: string;
    };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

async function isVerifiedServiceRole(
  bearer: string,
  env: (name: string) => string | undefined,
): Promise<boolean> {
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && timingSafeEqual(bearer, serviceKey)) return true;
  const jwtSecret = env('SUPABASE_JWT_SECRET') ?? env('JWT_SECRET');
  if (!jwtSecret) return false;
  const role = await verifiedHs256Role(bearer, jwtSecret);
  return role === 'service_role';
}

function applyStatus(error: string): number {
  if (error === 'account_token_not_ready') return 409;
  if (error === 'account_token_mismatch' || error === 'transaction_binding_mismatch') return 422;
  if (error === 'anonymous_upgrade_required') return 403;
  if (error === 'not_authenticated') return 401;
  return 503;
}

async function applyValidated(
  admin: AdminClient,
  userId: string,
  transaction: {
    transactionId: string;
    originalTransactionId: string;
    productId: string;
    subscriptionGroupId: string;
    environment: StoreKitEnvironment;
    ownershipType: 'PURCHASED';
    appAccountToken: string;
    status: string;
    purchaseDate: string;
    expiresAt: string;
    revocationDate: string | null;
    signedAt: string;
    jwsSha256: string;
  },
  sourceVersion: string,
): Promise<Response> {
  const { data: applied, error: applyError } = await admin.rpc('apply_storekit_transaction', {
    p_user_id: userId,
    p_transaction_id: transaction.transactionId,
    p_original_transaction_id: transaction.originalTransactionId,
    p_product_id: transaction.productId,
    p_subscription_group_id: transaction.subscriptionGroupId,
    p_environment: transaction.environment,
    p_ownership_type: transaction.ownershipType,
    p_app_account_token: transaction.appAccountToken,
    p_status: transaction.status,
    p_purchase_date: transaction.purchaseDate,
    p_expires_at: transaction.expiresAt,
    p_revocation_date: transaction.revocationDate,
    p_signed_at: transaction.signedAt,
    p_jws_sha256: transaction.jwsSha256,
    p_source_version: sourceVersion,
  });
  const appliedLedger = (applied ?? null) as JsonRecord | null;
  if (applyError || !appliedLedger || appliedLedger.ok !== true || appliedLedger.durable !== true) {
    const ledgerError = typeof appliedLedger?.error === 'string'
      ? appliedLedger.error
      : 'entitlement_persistence_failed';
    outcomeLog(ledgerError);
    return json(applyStatus(ledgerError), { ok: false, error: ledgerError });
  }
  const entitlementVersion = Number(
    appliedLedger.entitlementVersion ?? appliedLedger.entitlement_version ?? 1,
  );
  outcomeLog(appliedLedger.duplicate === true ? 'duplicate_durable' : 'durable_grant');
  return json(200, {
    ok: true,
    durable: true,
    duplicate: appliedLedger.duplicate === true,
    status: appliedLedger.status ?? transaction.status,
    productId: transaction.productId,
    transactionId: transaction.transactionId,
    entitlementVersion: Number.isFinite(entitlementVersion) ? entitlementVersion : 1,
    personalPremiumActive: appliedLedger.personalPremiumActive === true
      || appliedLedger.personal_premium_active === true,
  });
}

export function createSyncHandler(
  dependencies: SyncHandlerDependencies = {},
): (req: Request) => Promise<Response> {
  const env = dependencies.env ?? ((name: string) => Deno.env.get(name));
  const now = dependencies.now ?? Date.now;
  const verifyJws = dependencies.verifyJws ?? verifyStoreKitJws;
  const createAdmin = dependencies.createAdmin ?? defaultAdminClient;
  const createUser = dependencies.createUser ?? defaultUserClient;

  return async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      outcomeLog('missing_auth');
      return json(401, { ok: false, error: 'not_authenticated' });
    }
    const bearer = authorization.slice('Bearer '.length).trim();

    const supabaseUrl = env('SUPABASE_URL');
    const anonKey = env('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) return json(503, { ok: false, error: 'server_configuration_missing' });

    const baseConfig = storeKitConfigFromEnv(env);
    const secrets = appStoreServerSecretsFromEnv(env);
    if (!baseConfig) {
      outcomeLog('configuration_missing');
      return json(503, { ok: false, error: 'server_configuration_missing' });
    }

    let body: JsonRecord = {};
    try {
      const raw = await req.text();
      if (raw.length > 96 * 1024) return json(413, { ok: false, error: 'payload_too_large' });
      if (raw.trim()) {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return json(400, { ok: false, error: 'invalid_body' });
        }
        body = parsed as JsonRecord;
      }
    } catch {
      return json(400, { ok: false, error: 'invalid_body' });
    }

    const admin = createAdmin(supabaseUrl, adminKey(env));
    const isService = await isVerifiedServiceRole(bearer, env);

    if (isService) {
      const originalTransactionId = requiredString(body, 'originalTransactionId', 'original_transaction_id');
      const environment = (requiredString(body, 'environment') ?? 'Production') as StoreKitEnvironment;
      if (!originalTransactionId) {
        return json(400, { ok: false, error: 'original_transaction_id_required' });
      }
      if (!allowedStoreKitEnvironments(baseConfig).includes(environment)) {
        return json(422, { ok: false, error: 'environment_mismatch' });
      }
      const { data: bindRow, error: bindError } = await admin
        .from('premium_transaction_bindings')
        .select('user_id,app_account_token,environment')
        .eq('original_transaction_id', originalTransactionId)
        .eq('environment', environment)
        .maybeSingle();
      if (bindError) return json(503, { ok: false, error: 'binding_lookup_failed' });
      if (typeof bindRow?.user_id !== 'string') {
        outcomeLog('unbound_original');
        return json(503, { ok: false, error: 'account_not_bound' });
      }
      if (!secrets) {
        outcomeLog('server_configuration_missing');
        return json(503, { ok: false, error: 'server_configuration_missing' });
      }
      const statuses = await fetchSubscriptionStatuses({
        secrets,
        originalTransactionId,
        environment,
        fetchImpl: dependencies.fetchImpl,
        nowMs: now(),
        connectJwt: dependencies.connectJwt,
      });
      if (!statuses.ok) {
        outcomeLog(statuses.error);
        return json(statuses.status === 429 ? 503 : 503, { ok: false, error: statuses.error });
      }
      let last: Response | null = null;
      for (const signed of statuses.signedTransactions) {
        const verified = await verifyAppleSignedTransaction(
          signed,
          { ...baseConfig, appAccountToken: String(bindRow.app_account_token ?? '') },
          now(),
          verifyJws,
        );
        if (!verified.ok) {
          outcomeLog(verified.error);
          return json(422, { ok: false, error: verified.error });
        }
        last = await applyValidated(
          admin,
          bindRow.user_id,
          verified.transaction,
          'app-store-server-api',
        );
        if (!last.ok) return last;
      }
      return last ?? json(503, { ok: false, error: 'apple_subscription_missing' });
    }

    const userClient = createUser(supabaseUrl, anonKey, authorization);
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      outcomeLog('invalid_auth');
      return json(401, { ok: false, error: 'not_authenticated' });
    }
    if (userData.user.is_anonymous === true) {
      outcomeLog('anonymous_upgrade_required');
      return json(403, { ok: false, error: 'anonymous_upgrade_required' });
    }

    const signedTransaction = requiredString(body, 'signed_transaction', 'signedTransaction');
    const { data: tokenRow, error: tokenError } = await admin
      .from('premium_app_account_tokens')
      .select('app_account_token')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (tokenError || typeof tokenRow?.app_account_token !== 'string') {
      outcomeLog('account_token_missing');
      return json(409, { ok: false, error: 'account_token_not_ready' });
    }
    const config = { ...baseConfig, appAccountToken: tokenRow.app_account_token };

    if (signedTransaction) {
      const verified = await verifyAppleSignedTransaction(signedTransaction, config, now(), verifyJws);
      if (!verified.ok) {
        outcomeLog(verified.error);
        return json(422, { ok: false, error: verified.error });
      }
      return applyValidated(admin, userData.user.id, verified.transaction, 'app-store-server-api:device-jws');
    }

    const requestedOriginal = requiredString(body, 'originalTransactionId', 'original_transaction_id');
    if (requestedOriginal) {
      const { data: bindRow } = await admin
        .from('premium_transaction_bindings')
        .select('user_id,environment')
        .eq('original_transaction_id', requestedOriginal)
        .maybeSingle();
      if (typeof bindRow?.user_id !== 'string' || bindRow.user_id !== userData.user.id) {
        await admin.rpc('record_premium_security_event', {
          p_event_type: 'transaction_binding_mismatch',
          p_user_id: userData.user.id,
          p_other_user_id: bindRow?.user_id ?? null,
          p_original_transaction_id: requestedOriginal,
          p_environment: bindRow?.environment ?? null,
          p_reason: 'user supplied originalTransactionId not bound to caller',
        });
        outcomeLog('transaction_binding_mismatch');
        return json(422, { ok: false, error: 'transaction_binding_mismatch' });
      }
    }

    const { data: ownBind } = await admin
      .from('premium_transaction_bindings')
      .select('original_transaction_id,environment,user_id')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (typeof ownBind?.original_transaction_id !== 'string') {
      outcomeLog('no_bound_subscription');
      return json(404, { ok: false, error: 'subscription_required' });
    }
    if (!secrets) {
      outcomeLog('server_configuration_missing');
      return json(503, { ok: false, error: 'server_configuration_missing' });
    }
    const environment = (ownBind.environment as StoreKitEnvironment) ?? 'Production';
    const lookup = await fetchSignedTransactionInfo({
      secrets,
      transactionId: ownBind.original_transaction_id,
      environment,
      fetchImpl: dependencies.fetchImpl,
      nowMs: now(),
      connectJwt: dependencies.connectJwt,
    });
    if (!lookup.ok) {
      const statuses = await fetchSubscriptionStatuses({
        secrets,
        originalTransactionId: ownBind.original_transaction_id,
        environment,
        fetchImpl: dependencies.fetchImpl,
        nowMs: now(),
        connectJwt: dependencies.connectJwt,
      });
      if (!statuses.ok) {
        outcomeLog(statuses.error);
        return json(503, { ok: false, error: statuses.error });
      }
      const verified = await verifyAppleSignedTransaction(
        statuses.signedTransactions[0],
        config,
        now(),
        verifyJws,
      );
      if (!verified.ok) return json(422, { ok: false, error: verified.error });
      return applyValidated(admin, userData.user.id, verified.transaction, 'app-store-server-api');
    }
    const verified = await verifyAppleSignedTransaction(lookup.signedTransaction, config, now(), verifyJws);
    if (!verified.ok) return json(422, { ok: false, error: verified.error });
    return applyValidated(admin, userData.user.id, verified.transaction, 'app-store-server-api');
  };
}

/** Optional service_role near-expiry sweep. This parent keeps it a no-op helper. */
export function planNearExpirySweep(): { ok: true; skipped: true } {
  return { ok: true, skipped: true };
}

const handler = createSyncHandler();

if (import.meta.main) Deno.serve(handler);

export { handler };
