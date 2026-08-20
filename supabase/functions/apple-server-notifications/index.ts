/** App Store Server Notifications V2 receiver (Ticket 8). */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  allowedStoreKitEnvironments,
  storeKitConfigFromEnv,
  validateStoreKitTransaction,
  verifyStoreKitJws,
  type StoreKitEnvironment,
} from '../_shared/storekit.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

type JsonRecord = Record<string, unknown>;

function json(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
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

function logOutcome(outcome: string): void {
  console.log(JSON.stringify({ event: 'storekit_notification', outcome }));
}

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

type NotificationHandlerDependencies = {
  env?: (name: string) => string | undefined;
  now?: () => number;
  verifyJws?: typeof verifyStoreKitJws;
  createAdmin?: (url: string, key: string) => AdminClient;
};

function defaultAdminClient(url: string, key: string): AdminClient {
  return createClient(url, key) as unknown as AdminClient;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateFromMilliseconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Keep the App Store Server Notifications V2 lifecycle vocabulary explicit at
// the server boundary. The signed transaction remains the source of dates and
// product identity; these sets only classify the notification that delivered
// that already-verified transaction.
const ENTITLED_UNTIL_EXPIRY_TYPES = new Set([
  'SUBSCRIBED',
  'DID_RENEW',
  'DID_CHANGE_RENEWAL_STATUS',
  'DID_CHANGE_RENEWAL_PREF',
]);

const EXPIRED_NOTIFICATION_TYPES = new Set(['EXPIRED']);

const TERMINAL_NOTIFICATION_TYPES = new Set(['REFUND', 'REVOKE']);

export type NotificationLifecycleStatus =
  | 'active'
  | 'expired'
  | 'refunded'
  | 'revoked'
  | 'billing_retry'
  | 'grace_period';

function lifecycleStatus(
  notificationType: string,
  transactionStatus: 'active' | 'expired' | 'revoked',
): NotificationLifecycleStatus {
  if (TERMINAL_NOTIFICATION_TYPES.has(notificationType)) {
    return notificationType === 'REFUND' ? 'refunded' : 'revoked';
  }
  if (EXPIRED_NOTIFICATION_TYPES.has(notificationType)) return 'expired';
  if (notificationType === 'DID_FAIL_TO_RENEW') {
    return transactionStatus === 'expired' ? 'expired' : 'billing_retry';
  }
  if (notificationType === 'GRACE_PERIOD') {
    return transactionStatus === 'expired' ? 'expired' : 'grace_period';
  }
  if (ENTITLED_UNTIL_EXPIRY_TYPES.has(notificationType)) return transactionStatus;
  // Unknown signed event types stay transaction-derived rather than being
  // guessed as active. This keeps new Apple event types fail-safe.
  return transactionStatus;
}

function createNotificationHandler(
  dependencies: NotificationHandlerDependencies = {},
): (req: Request) => Promise<Response> {
  const env = dependencies.env ?? ((name: string) => Deno.env.get(name));
  const now = dependencies.now ?? Date.now;
  const verifyJws = dependencies.verifyJws ?? verifyStoreKitJws;
  const createAdmin = dependencies.createAdmin ?? defaultAdminClient;

  return async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

    const baseConfig = storeKitConfigFromEnv(env);
    if (!baseConfig) {
      logOutcome('configuration_missing');
      return json(503, { ok: false, error: 'server_configuration_missing' });
    }

    let body: JsonRecord;
    try {
      const raw = await req.text();
      if (raw.length > 128 * 1024) return json(413, { ok: false, error: 'payload_too_large' });
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return json(400, { ok: false, error: 'invalid_body' });
      }
      body = parsed as JsonRecord;
    } catch {
      return json(400, { ok: false, error: 'invalid_body' });
    }

    const signedPayload = text(body.signedPayload) ?? text(body.signed_payload);
    if (!signedPayload) return json(400, { ok: false, error: 'signed_payload_required' });

    const outer = await verifyJws(signedPayload, baseConfig);
    if (!outer.ok) {
      logOutcome(outer.error);
      return json(422, { ok: false, error: outer.error });
    }
    const notification = outer.payload as StoreKitTransactionPayloadWithData;
    const notificationId = text(notification.notificationUUID);
    const notificationType = text(notification.notificationType);
    const subtype = text(notification.subtype);
    const data = notification.data;
    if (!notificationId || !notificationType || !data || typeof data !== 'object') {
      return json(422, { ok: false, error: 'notification_payload_invalid' });
    }
    const dataRecord = data as JsonRecord;
    const environment = text(dataRecord.environment);
    const signedTransactionInfo = text(dataRecord.signedTransactionInfo);
    const signedRenewalInfo = text(dataRecord.signedRenewalInfo);
    const outerSignedAt = dateFromMilliseconds(notification.signedDate);
    if (!environment || !signedTransactionInfo || !outerSignedAt) {
      return json(422, { ok: false, error: 'notification_data_invalid' });
    }
    const allowed = allowedStoreKitEnvironments(baseConfig);
    if (!allowed.includes(environment as StoreKitEnvironment)) {
      logOutcome('environment_mismatch');
      return json(422, { ok: false, error: 'environment_mismatch' });
    }

    const transactionJws = await verifyJws(signedTransactionInfo, baseConfig);
    if (!transactionJws.ok) {
      logOutcome(transactionJws.error);
      return json(422, { ok: false, error: transactionJws.error });
    }
    if (signedRenewalInfo) {
      const renewalJws = await verifyJws(signedRenewalInfo, baseConfig);
      if (!renewalJws.ok) {
        logOutcome(renewalJws.error);
        return json(422, { ok: false, error: renewalJws.error });
      }
    }
    const transactionPayload = transactionJws.payload;
    const accountToken = text(transactionPayload.appAccountToken);
    if (!accountToken) {
      logOutcome('account_token_missing');
      return json(422, { ok: false, error: 'account_token_missing' });
    }
    const config = { ...baseConfig, appAccountToken: accountToken };
    const validated = validateStoreKitTransaction(
      transactionPayload,
      config,
      now(),
      transactionJws.jwsSha256,
    );
    if (!validated.ok) {
      logOutcome(validated.error);
      return json(422, { ok: false, error: validated.error });
    }

    const transaction = validated.transaction;
    const supabaseUrl = env('SUPABASE_URL');
    if (!supabaseUrl) return json(503, { ok: false, error: 'server_configuration_missing' });
    const admin = createAdmin(supabaseUrl, adminKey(env));

    const { data: notificationRow, error: notificationError } = await admin.rpc(
      'record_storekit_notification',
      {
        p_notification_id: notificationId,
        p_notification_type: notificationType,
        p_subtype: subtype,
        p_environment: environment,
        p_transaction_id: transaction.transactionId,
        p_original_transaction_id: transaction.originalTransactionId,
        p_product_id: transaction.productId,
        p_signed_at: outerSignedAt,
      },
    );
    const notificationLedger = notificationRow as JsonRecord | null;
    if (notificationError || notificationLedger?.ok !== true) {
      if (notificationLedger?.error === 'notification_payload_mismatch') {
        logOutcome('notification_payload_mismatch');
        return json(422, { ok: false, error: 'notification_payload_mismatch' });
      }
      logOutcome('notification_ledger_failed');
      return json(503, { ok: false, error: 'notification_persistence_failed' });
    }
    if (notificationLedger.accepted === true) {
      logOutcome('duplicate_notification');
      return json(200, {
        ok: true,
        duplicate: notificationLedger.duplicate === true,
        accepted: true,
      });
    }

    const { data: accountRow, error: accountError } = await admin
      .from('premium_app_account_tokens')
      .select('user_id')
      .eq('app_account_token', accountToken)
      .maybeSingle();
    if (accountError) {
      logOutcome('account_lookup_failed');
      return json(503, { ok: false, error: 'account_lookup_failed' });
    }
    if (typeof accountRow?.user_id !== 'string') {
      // Keep the notification unaccepted until the account binding exists so
      // the same Apple notification can be retried without granting blindly.
      logOutcome('unbound_account');
      return json(503, { ok: false, error: 'account_not_bound' });
    }

    const status = lifecycleStatus(notificationType, transaction.status);
    const { data: applied, error: applyError } = await admin.rpc('apply_storekit_transaction', {
      p_user_id: accountRow.user_id,
      p_transaction_id: transaction.transactionId,
      p_original_transaction_id: transaction.originalTransactionId,
      p_product_id: transaction.productId,
      p_subscription_group_id: transaction.subscriptionGroupId,
      p_environment: transaction.environment,
      p_ownership_type: transaction.ownershipType,
      p_app_account_token: transaction.appAccountToken,
      p_status: status,
      p_purchase_date: transaction.purchaseDate,
      p_expires_at: transaction.expiresAt,
      p_revocation_date: transaction.revocationDate,
      p_signed_at: transaction.signedAt,
      p_jws_sha256: transaction.jwsSha256,
      p_source_version: `asn-v2:${notificationType}`,
    });
    const appliedLedger = applied as JsonRecord | null;
    if (applyError || appliedLedger?.ok !== true || appliedLedger.durable !== true) {
      const ledgerError = typeof appliedLedger?.error === 'string' ? appliedLedger.error : '';
      if (ledgerError === 'transaction_binding_mismatch' || ledgerError === 'account_token_mismatch') {
        logOutcome(ledgerError);
        return json(422, { ok: false, error: ledgerError });
      }
      // Do not acknowledge a valid notification until the transaction and its
      // projection are durable. The same notification remains retryable.
      logOutcome('transaction_ledger_failed');
      return json(503, { ok: false, error: 'transaction_persistence_failed' });
    }

    const { data: acceptedRow, error: acceptedError } = await admin.rpc(
      'accept_storekit_notification',
      {
        p_notification_id: notificationId,
        p_transaction_id: transaction.transactionId,
        p_original_transaction_id: transaction.originalTransactionId,
        p_product_id: transaction.productId,
        p_signed_at: outerSignedAt,
      },
    );
    const acceptedLedger = acceptedRow as JsonRecord | null;
    if (acceptedError || acceptedLedger?.ok !== true || acceptedLedger.accepted !== true) {
      if (acceptedLedger?.error === 'notification_payload_mismatch') {
        logOutcome('notification_payload_mismatch');
        return json(422, { ok: false, error: 'notification_payload_mismatch' });
      }
      // The transaction is durable, but Apple must retry the acceptance mark;
      // the transaction RPC is idempotent on the next attempt.
      logOutcome('notification_accept_failed');
      return json(503, { ok: false, error: 'notification_acceptance_failed' });
    }

    logOutcome(appliedLedger.duplicate === true ? 'duplicate_transaction' : 'lifecycle_applied');
    return json(200, {
      ok: true,
      duplicate: appliedLedger.duplicate === true,
      accepted: true,
      status,
      transactionId: transaction.transactionId,
    });
  };
}

type StoreKitTransactionPayloadWithData = {
  notificationUUID?: string;
  notificationType?: string;
  subtype?: string;
  signedDate?: number;
  data?: { environment?: string; signedTransactionInfo?: string; signedRenewalInfo?: string };
  [key: string]: unknown;
};

const handler = createNotificationHandler();

if (import.meta.main) Deno.serve(handler);

export { createNotificationHandler, handler, lifecycleStatus };
