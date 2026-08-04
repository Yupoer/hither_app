/**
 * StoreKit 2 purchase verifier for Tickets 7-8.
 *
 * The function accepts only the opaque signed transaction from expo-iap. It
 * authenticates the Hither user from the JWT, verifies Apple's JWS and the
 * server catalog, writes the transaction ledger + personal grant atomically,
 * and returns `durable: true`. The client may finish the native transaction
 * only after that response.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  storeKitConfigFromEnv,
  validateStoreKitTransaction,
  verifyStoreKitJws,
} from '../_shared/storekit.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

type JsonRecord = Record<string, unknown>;

function json(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function adminKey(): string {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const defaultKey = (JSON.parse(secretKeys) as Record<string, string>).default;
      if (defaultKey) return defaultKey;
    } catch {
      // Use the legacy secret below when the key map is not configured.
    }
  }
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
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
  // Never log the JWS, account token, transaction token, or user id.
  console.log(JSON.stringify({ event: 'storekit_purchase_verification', outcome }));
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    outcomeLog('missing_auth');
    return json(401, { ok: false, error: 'not_authenticated' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return json(503, { ok: false, error: 'server_configuration_missing' });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    outcomeLog('invalid_auth');
    return json(401, { ok: false, error: 'not_authenticated' });
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

  const baseConfig = storeKitConfigFromEnv((name) => Deno.env.get(name));
  if (!baseConfig) {
    outcomeLog('configuration_missing');
    return json(503, { ok: false, error: 'server_configuration_missing' });
  }

  const admin = createClient(supabaseUrl, adminKey());
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
  const verified = await verifyStoreKitJws(signedTransaction, config);
  if (!verified.ok) {
    outcomeLog(verified.error);
    return json(422, { ok: false, error: verified.error });
  }

  const transaction = validateStoreKitTransaction(
    verified.payload,
    config,
    Date.now(),
    verified.jwsSha256,
  );
  if (!transaction.ok) {
    outcomeLog(transaction.error);
    return json(422, { ok: false, error: transaction.error });
  }

  const clientTransactionId = requiredString(body, 'transaction_id', 'transactionId');
  if (clientTransactionId && clientTransactionId !== transaction.transaction.transactionId) {
    outcomeLog('transaction_id_mismatch');
    return json(422, { ok: false, error: 'transaction_id_mismatch' });
  }
  const clientProductId = requiredString(body, 'product_id', 'productId');
  if (clientProductId && clientProductId !== transaction.transaction.productId) {
    outcomeLog('product_id_mismatch');
    return json(422, { ok: false, error: 'product_id_mismatch' });
  }

  const item = transaction.transaction;
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
  if (applyError || !applied || applied.ok !== true || applied.durable !== true) {
    outcomeLog('ledger_write_failed');
    return json(503, { ok: false, error: 'entitlement_persistence_failed' });
  }

  outcomeLog(applied.duplicate === true ? 'duplicate_durable' : 'durable_grant');
  return json(200, {
    ok: true,
    durable: true,
    duplicate: applied.duplicate === true,
    status: item.status,
    productId: item.productId,
    transactionId: item.transactionId,
    isPremium: item.status === 'active',
  });
}

Deno.serve(handler);

export { handler };
