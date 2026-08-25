/**
 * StoreKit 2 purchase verifier (#223 / #232).
 *
 * Accepts only the opaque signed transaction. Authenticates the Hither user
 * JWT, verifies Apple's JWS, writes the ledger + personal grant, and returns
 * durable projection fields from the database. The client may finish the
 * native transaction only after durable: true.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  allowedStoreKitEnvironments,
  storeKitConfigFromEnv,
  validateStoreKitTransaction,
  validateStoreKitTripTransaction,
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
      data: { user: { id: string; is_anonymous?: boolean } | null };
      error: unknown | null;
    }>;
  };
};

export type PurchaseHandlerDependencies = {
  env?: (name: string) => string | undefined;
  now?: () => number;
  verifyJws?: typeof verifyStoreKitJws;
  createAdmin?: (url: string, key: string) => AdminClient;
  createUser?: (url: string, anonKey: string, authorization: string) => UserClient;
};

function json(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function adminKey(env: (name: string) => string | undefined): string {
  const secretKeys = env('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const defaultKey = (JSON.parse(secretKeys) as Record<string, string>).default;
      if (defaultKey) return defaultKey;
    } catch {
      // Use the legacy secret below when the key map is not configured.
    }
  }
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('supabase_admin_key_missing');
  return key;
}

function requiredString(body: JsonRecord, ...names: string[]): string | null {
  for (const name of names) {
    if (typeof body[name] === 'string' && body[name].trim()) return body[name].trim();
  }
  return null;
}

function outcomeLog(outcome: string): void {
  console.log(JSON.stringify({ event: 'storekit_purchase_verification', outcome }));
}

function defaultAdminClient(url: string, key: string): AdminClient {
  return createClient(url, key) as unknown as AdminClient;
}

function defaultUserClient(url: string, anonKey: string, authorization: string): UserClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  }) as unknown as UserClient;
}

function applyHttpStatus(error: unknown): number {
  if (error === 'account_token_not_ready') return 409;
  if (error === 'account_token_mismatch' || error === 'transaction_binding_mismatch') return 422;
  if (error === 'anonymous_upgrade_required') return 403;
  if (error === 'not_authenticated') return 401;
  if (error === 'leader_required' || error === 'group_required' || error === 'not_applicable') return 422;
  return 503;
}

export function createPurchaseHandler(
  dependencies: PurchaseHandlerDependencies = {},
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

    const supabaseUrl = env('SUPABASE_URL');
    const anonKey = env('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) return json(503, { ok: false, error: 'server_configuration_missing' });

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

    let body: JsonRecord;
    try {
      const raw = await req.text();
      if (raw.length > 96 * 1024) return json(413, { ok: false, error: 'payload_too_large' });
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return json(400, { ok: false, error: 'invalid_body' });
      }
      body = parsed as JsonRecord;
    } catch {
      return json(400, { ok: false, error: 'invalid_body' });
    }

    const signedTransaction = requiredString(body, 'signed_transaction', 'signedTransaction', 'purchase_token');
    if (!signedTransaction) return json(400, { ok: false, error: 'signed_transaction_required' });

    const baseConfig = storeKitConfigFromEnv(env);
    if (!baseConfig) {
      outcomeLog('configuration_missing');
      return json(503, { ok: false, error: 'server_configuration_missing' });
    }

    const admin = createAdmin(supabaseUrl, adminKey(env));
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
    const verified = await verifyJws(signedTransaction, config);
    if (!verified.ok) {
      outcomeLog(verified.error);
      return json(422, { ok: false, error: verified.error });
    }

    const clientTransactionId = requiredString(body, 'transaction_id', 'transactionId');
    if (clientTransactionId && clientTransactionId !== verified.payload.transactionId) {
      outcomeLog('transaction_id_mismatch');
      return json(422, { ok: false, error: 'transaction_id_mismatch' });
    }
    const clientProductId = requiredString(body, 'product_id', 'productId');
    if (clientProductId && clientProductId !== verified.payload.productId) {
      outcomeLog('product_id_mismatch');
      return json(422, { ok: false, error: 'product_id_mismatch' });
    }

    if (baseConfig.tripProductId === verified.payload.productId) {
      const groupId = requiredString(body, 'group_id', 'groupId');
      if (!groupId) return json(400, { ok: false, error: 'group_required' });
      const tripTransaction = validateStoreKitTripTransaction(
        verified.payload,
        { ...baseConfig, appAccountToken: tokenRow.app_account_token },
        now(),
        verified.jwsSha256,
      );
      if (!tripTransaction.ok) {
        outcomeLog(tripTransaction.error);
        return json(422, { ok: false, error: tripTransaction.error });
      }
      const item = tripTransaction.transaction;
      if (item.status !== 'active') {
        outcomeLog('transaction_revoked');
        return json(422, { ok: false, error: 'transaction_revoked' });
      }
      const { data: applied, error: applyError } = await admin.rpc('apply_verified_trip_storekit_purchase', {
        p_user_id: userData.user.id,
        p_group_id: groupId,
        p_transaction_id: item.transactionId,
        p_original_transaction_id: item.originalTransactionId,
        p_product_id: item.productId,
        p_environment: item.environment,
        p_ownership_type: item.ownershipType,
        p_app_account_token: item.appAccountToken,
        p_purchase_date: item.purchaseDate,
        p_signed_at: item.signedAt,
        p_jws_sha256: item.jwsSha256,
      });
      const appliedTrip = (applied ?? null) as JsonRecord | null;
      if (applyError || !appliedTrip || appliedTrip.ok !== true || appliedTrip.durable !== true) {
        const tripError = typeof appliedTrip?.error === 'string' ? appliedTrip.error : 'entitlement_persistence_failed';
        outcomeLog(tripError);
        return json(applyHttpStatus(tripError), { ok: false, error: tripError });
      }
      outcomeLog(appliedTrip.duplicate === true ? 'duplicate_durable' : 'durable_trip_grant');
      return json(200, {
        ok: true,
        durable: true,
        duplicate: appliedTrip.duplicate === true,
        status: typeof appliedTrip.status === 'string' ? appliedTrip.status : 'active',
        planCode: typeof appliedTrip.plan_code === 'string' ? appliedTrip.plan_code : 'small_trip_pass',
        productId: item.productId,
        transactionId: item.transactionId,
        startedAt: appliedTrip.started_at ?? item.purchaseDate,
        expiresAt: appliedTrip.expires_at ?? null,
        teamPremiumActive: appliedTrip.teamPremiumActive === true
          || appliedTrip.team_premium_active === true
          || appliedTrip.is_premium === true,
        personalPremiumActive: false,
      });
    }

    const transaction = validateStoreKitTransaction(
      verified.payload,
      config,
      now(),
      verified.jwsSha256,
    );
    if (!transaction.ok) {
      outcomeLog(transaction.error);
      return json(422, { ok: false, error: transaction.error });
    }

    const item = transaction.transaction;
    if (!allowedStoreKitEnvironments(baseConfig).includes(item.environment)) {
      outcomeLog('environment_mismatch');
      return json(422, { ok: false, error: 'environment_mismatch' });
    }

    const { data: applied, error: applyError } = await admin.rpc('apply_storekit_transaction', {
      p_user_id: userData.user.id,
      p_transaction_id: item.transactionId,
      p_original_transaction_id: item.originalTransactionId,
      p_product_id: item.productId,
      p_subscription_group_id: item.subscriptionGroupId,
      p_environment: item.environment,
      p_ownership_type: item.ownershipType,
      p_app_account_token: item.appAccountToken,
      p_status: item.status,
      p_purchase_date: item.purchaseDate,
      p_expires_at: item.expiresAt,
      p_revocation_date: item.revocationDate,
      p_signed_at: item.signedAt,
      p_jws_sha256: item.jwsSha256,
      p_source_version: 'storekit-v1',
    });
    const appliedLedger = (applied ?? null) as JsonRecord | null;
    if (applyError || !appliedLedger || appliedLedger.ok !== true || appliedLedger.durable !== true) {
      const ledgerError = typeof appliedLedger?.error === 'string' ? appliedLedger.error : 'entitlement_persistence_failed';
      outcomeLog(ledgerError);
      return json(applyHttpStatus(ledgerError), { ok: false, error: ledgerError });
    }

    const entitlementVersion = typeof appliedLedger.entitlementVersion === 'number'
      ? appliedLedger.entitlementVersion
      : typeof appliedLedger.entitlement_version === 'number'
        ? appliedLedger.entitlement_version
        : Number(appliedLedger.entitlementVersion ?? appliedLedger.entitlement_version ?? 1);
    const personalPremiumActive = appliedLedger.personalPremiumActive === true
      || appliedLedger.personal_premium_active === true;

    outcomeLog(appliedLedger.duplicate === true ? 'duplicate_durable' : 'durable_grant');
    return json(200, {
      ok: true,
      durable: true,
      duplicate: appliedLedger.duplicate === true,
      status: typeof appliedLedger.status === 'string' ? appliedLedger.status : item.status,
      productId: item.productId,
      transactionId: item.transactionId,
      entitlementVersion: Number.isFinite(entitlementVersion) ? entitlementVersion : 1,
      personalPremiumActive,
    });
  };
}

const handler = createPurchaseHandler();

if (import.meta.main) Deno.serve(handler);

export { handler };
