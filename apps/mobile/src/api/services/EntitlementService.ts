/**
 * EntitlementService — server-authoritative Free Plan / Small Trip Pass.
 *
 * Client never writes profiles.pro as proof of payment.
 *
 * ## Purchase grant path (BUILD-02 handoff)
 *
 * `apply_verified_purchase` is **service_role only**. Authenticated JWTs cannot
 * invent transaction ids. Production flow:
 *
 *   native IAP (BUILD-02) → Edge Function `verify-and-apply-purchase`
 *     → verifies Apple/Google receipt
 *     → RPC `apply_verified_purchase` with service_role
 *
 * This module prefers `supabase.functions.invoke('verify-and-apply-purchase')`.
 * Direct RPC remains only as a test/gateway fallback and maps 42501 to
 * `verification_service_required` (does not unlock Premium).
 */
import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';
import {
  mapTripEntitlementRow,
  mapPremiumProjectionRow,
  normalizeEntitlementError,
  type EntitlementMutationResult,
  type PremiumProjection,
  type TripEntitlement,
} from '../../entitlements';

/** Edge Function name for the StoreKit server verification boundary. */
export const VERIFY_AND_APPLY_PURCHASE_FN = 'verify-and-apply-purchase';
export const SYNC_APP_STORE_SUBSCRIPTION_FN = 'sync-app-store-subscription';

function asRecord(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

function mapApplyPayload(row: Record<string, unknown> | null): EntitlementMutationResult {
  if (!row) {
    return { ok: false, error: 'invalid' };
  }
  if (row.ok === false || row.success === false) {
    return {
      ok: false,
      error: normalizeEntitlementError(row.error ?? row.code ?? row),
      status: typeof row.status === 'string' ? row.status : undefined,
      entitlementId: (row.entitlement_id as string | undefined) ?? undefined,
      startedAt: (row.started_at as string | null | undefined) ?? null,
      expiresAt: (row.expires_at as string | null | undefined) ?? null,
      message: typeof row.message === 'string' ? row.message : undefined,
      durable: row.durable === true,
      entitlementVersion: typeof row.entitlementVersion === 'number'
        ? row.entitlementVersion
        : typeof row.entitlement_version === 'number'
          ? row.entitlement_version
          : null,
      personalPremiumActive: row.personalPremiumActive === true
        || row.personal_premium_active === true,
    };
  }
  if (row.ok === true || row.success === true) {
    const personalPremiumActive = row.personalPremiumActive === true
      || row.personal_premium_active === true;
    return {
      ok: true,
      success: true,
      durable: row.durable === true || personalPremiumActive,
      status: String(row.status ?? 'active'),
      planCode: String(row.plan_code ?? row.productId ?? row.product_id ?? 'premium_subscription'),
      startedAt: (row.started_at as string | null | undefined) ?? null,
      expiresAt: (row.expires_at as string | null | undefined) ?? null,
      entitlementId: (row.entitlement_id as string | null | undefined) ?? null,
      isPremium: row.is_premium === true || personalPremiumActive,
      teamPremiumActive: row.teamPremiumActive === true || row.team_premium_active === true || row.is_premium === true,
      personalPremiumActive,
      productId: typeof row.productId === 'string'
        ? row.productId
        : typeof row.product_id === 'string'
          ? row.product_id
          : null,
      transactionId: typeof row.transactionId === 'string'
        ? row.transactionId
        : typeof row.transaction_id === 'string'
          ? row.transaction_id
          : null,
      entitlementVersion: typeof row.entitlementVersion === 'number'
        ? row.entitlementVersion
        : typeof row.entitlement_version === 'number'
          ? row.entitlement_version
          : null,
    };
  }
  return { ok: false, error: 'invalid' };
}

export async function getTripEntitlement(groupId: string): Promise<TripEntitlement> {
  await requireUserId();
  const { data, error } = await supabase.rpc('get_trip_entitlement', {
    p_group_id: groupId,
  });
  orThrow(error);
  return mapTripEntitlementRow(asRecord(data));
}

/** Account-owned Premium plus the current group's server projection. */
export async function getPremiumProjection(
  groupId?: string | null,
): Promise<PremiumProjection> {
  await requireUserId();
  const { data, error } = await supabase.rpc('get_premium_projection', {
    p_group_id: groupId ?? null,
  });
  orThrow(error);
  return mapPremiumProjectionRow(asRecord(data));
}

/** Server-generated stable UUID passed to StoreKit's appAccountToken. */
export async function getPremiumAppAccountToken(): Promise<string> {
  await requireUserId();
  const { data, error } = await supabase.rpc('get_or_create_premium_app_account_token');
  orThrow(error);
  const token = typeof data === 'string'
    ? data
    : asRecord(data)?.app_account_token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('account_token_not_ready');
  }
  return token;
}

/**
 * Verify an auto-renewable StoreKit subscription and persist it server-side.
 * There is intentionally no RPC fallback: an authenticated client must never
 * be able to turn a transaction id into a Premium grant.
 */
export async function applyVerifiedSubscription(input: {
  signedTransaction: string;
  transactionId?: string;
  productId?: string;
  source?: 'purchase' | 'restore' | 'recovery';
}): Promise<EntitlementMutationResult> {
  await requireUserId();
  const functionsApi = (supabase as { functions?: { invoke?: Function } }).functions;
  if (typeof functionsApi?.invoke !== 'function') {
    return {
      ok: false,
      error: 'verification_service_unavailable',
      message: 'StoreKit verification service is not linked',
    };
  }

  try {
    const { data } = await functionsApi.invoke(VERIFY_AND_APPLY_PURCHASE_FN, {
      body: {
        signed_transaction: input.signedTransaction,
        transaction_id: input.transactionId,
        product_id: input.productId,
        source: input.source ?? 'purchase',
      },
    });
    const row = asRecord(data);
    if (!row) {
      return {
        ok: false,
        error: 'verification_service_unavailable',
        message: 'StoreKit verification returned no durable result',
      };
    }
    return mapApplyPayload(row);
  } catch {
    return {
      ok: false,
      error: 'verification_service_unavailable',
      message: 'StoreKit verification could not be reached',
    };
  }
}

/** Verify a StoreKit consumable and bind its durable ten-day grant to a group. */
export async function applyVerifiedTripPass(input: {
  signedTransaction: string;
  transactionId: string;
  productId: string;
  groupId: string;
}): Promise<EntitlementMutationResult> {
  await requireUserId();
  if (!input.groupId.trim() || !input.transactionId.trim() || !input.productId.trim()) {
    return { ok: false, error: 'invalid', message: 'trip purchase binding is incomplete' };
  }
  const functionsApi = (supabase as { functions?: { invoke?: Function } }).functions;
  if (typeof functionsApi?.invoke !== 'function') {
    return { ok: false, error: 'verification_service_unavailable' };
  }
  try {
    const { data } = await functionsApi.invoke(VERIFY_AND_APPLY_PURCHASE_FN, {
      body: {
        signed_transaction: input.signedTransaction,
        transaction_id: input.transactionId,
        product_id: input.productId,
        group_id: input.groupId,
      },
    });
    const row = asRecord(data);
    return row
      ? mapApplyPayload(row)
      : { ok: false, error: 'verification_service_unavailable' };
  } catch {
    return { ok: false, error: 'verification_service_unavailable' };
  }
}

/** Compensation path when StoreKit has a JWS the ledger lacks. */
export async function syncAppStoreSubscription(input: {
  signedTransaction?: string;
  originalTransactionId?: string;
} = {}): Promise<EntitlementMutationResult> {
  await requireUserId();
  const functionsApi = (supabase as { functions?: { invoke?: Function } }).functions;
  if (typeof functionsApi?.invoke !== 'function') {
    return { ok: false, error: 'verification_service_unavailable' };
  }
  try {
    const { data } = await functionsApi.invoke(SYNC_APP_STORE_SUBSCRIPTION_FN, {
      body: {
        signed_transaction: input.signedTransaction,
        original_transaction_id: input.originalTransactionId,
      },
    });
    return mapApplyPayload(asRecord(data));
  } catch {
    return { ok: false, error: 'verification_service_unavailable' };
  }
}

/**
 * Map a BUILD-02 *server-verified* purchase to a Small Trip Pass.
 *
 * Incomplete / unverified native purchases must never call this.
 * End-to-end unlock requires the BUILD-02 Edge Function; user-JWT RPC is denied.
 */
export async function applyVerifiedPurchase(input: {
  groupId: string;
  transactionId: string;
  productId?: string;
  /** iOS JWS / Android purchase token for server verification. */
  purchaseToken?: string;
}): Promise<EntitlementMutationResult> {
  await requireUserId();
  // Hard gate: never call grant RPC with empty / placeholder transaction ids.
  const txn = String(input.transactionId ?? '').trim();
  if (!txn || txn.length < 6 || /^(local|test|temp|dev)$/i.test(txn)) {
    return {
      ok: false,
      error: 'invalid',
      message: 'missing or invalid transaction id — Premium not unlocked',
    };
  }
  const body = {
    group_id: input.groupId,
    transaction_id: txn,
    product_id: input.productId ?? 'hither.small_trip_pass',
    purchase_token: input.purchaseToken ?? null,
    // camelCase aliases for Edge Function flexibility
    groupId: input.groupId,
    transactionId: txn,
    productId: input.productId ?? 'hither.small_trip_pass',
    purchaseToken: input.purchaseToken ?? null,
  };

  // Preferred production path: receipt-verifying Edge Function (service_role grant).
  // On non-2xx, supabase-js often sets `error` *and* returns a JSON `data` body
  // (invalid / duplicate / etc.). Always map a usable body; only fall through to
  // RPC when there is no body (function missing / network / empty response).
  const functionsApi = (supabase as { functions?: { invoke?: Function } }).functions;
  if (typeof functionsApi?.invoke === 'function') {
    try {
      const { data } = await functionsApi.invoke(VERIFY_AND_APPLY_PURCHASE_FN, {
        body,
      });
      const row = asRecord(data);
      if (row) {
        return mapApplyPayload(row);
      }
      // No parseable body → function missing / network / empty → RPC fallback.
    } catch {
      /* fall through when invoke throws without a body */
    }
  }

  // Test/gateway fallback: RPC is service_role-only in production.
  const { data, error } = await supabase.rpc('apply_verified_purchase', {
    p_group_id: input.groupId,
    p_transaction_id: txn,
    p_product_id: input.productId ?? 'hither.small_trip_pass',
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '42501' || /permission denied|not granted/i.test(error.message)) {
      return {
        ok: false,
        error: 'verification_service_required',
        message:
          'BUILD-02 Edge Function verify-and-apply-purchase required; user JWT cannot grant premium',
      };
    }
    orThrow(error);
  }
  return mapApplyPayload(asRecord(data));
}

/** Reinstall / device-change restore: trust server, not local storage. */
export async function restoreEntitlements(groupId?: string | null): Promise<{
  ok: boolean;
  isPremium: boolean;
  userPro: boolean;
  planCode: string;
  startedAt?: string | null;
  expiresAt?: string | null;
  trip?: TripEntitlement | null;
  error?: string;
}> {
  await requireUserId();
  const { data, error } = await supabase.rpc('restore_entitlements', {
    p_group_id: groupId ?? null,
  });
  orThrow(error);
  const row = asRecord(data);
  if (!row || row.ok === false) {
    return {
      ok: false,
      isPremium: false,
      userPro: false,
      planCode: 'free',
      error: typeof row?.error === 'string' ? row.error : 'unknown',
    };
  }
  const tripRaw = row.trip && typeof row.trip === 'object' ? (row.trip as Record<string, unknown>) : null;
  return {
    ok: true,
    isPremium: !!row.is_premium,
    userPro: !!row.user_pro,
    planCode: String(row.plan_code ?? 'free'),
    startedAt: (row.started_at as string | null | undefined) ?? null,
    expiresAt: (row.expires_at as string | null | undefined) ?? null,
    trip: tripRaw ? mapTripEntitlementRow(tripRaw) : null,
  };
}

export async function redeemPromoCode(
  code: string,
  groupId?: string | null,
): Promise<{ plan_name: string; plan_code?: string; expires_at?: string | null }> {
  await requireUserId();
  const { data, error } = await supabase.rpc('redeem_promo_code', {
    p_code: code.trim(),
    p_group_id: groupId ?? null,
  });
  orThrow(error);
  const row = asRecord(data);
  if (!row || row.success === false) {
    const codeKey = normalizeEntitlementError(row?.error ?? row?.code ?? 'invalid');
    const err = new Error(codeKey) as Error & { code?: string };
    err.code = codeKey;
    throw err;
  }
  return {
    plan_name: String(row.plan_name ?? row.plan_code ?? 'Premium'),
    plan_code: typeof row.plan_code === 'string' ? row.plan_code : undefined,
    expires_at: (row.expires_at as string | null | undefined) ?? null,
  };
}

/**
 * @deprecated Direct client Pro writes are forbidden. Kept only so old imports
 * fail clearly instead of silently granting premium.
 */
export async function setProStatus(_userId: string): Promise<void> {
  throw new Error(
    'entitlement_write_forbidden: use applyVerifiedPurchase, redeemPromoCode, or restoreEntitlements',
  );
}
