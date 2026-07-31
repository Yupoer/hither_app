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
  normalizeEntitlementError,
  type EntitlementMutationResult,
  type TripEntitlement,
} from '../../entitlements';

/** Edge Function name BUILD-02 must deploy for store purchase grants. */
export const VERIFY_AND_APPLY_PURCHASE_FN = 'verify-and-apply-purchase';

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
    };
  }
  if (row.ok === true || row.success === true || row.is_premium === true) {
    return {
      ok: true,
      success: true,
      status: String(row.status ?? 'active'),
      planCode: String(row.plan_code ?? 'small_trip_pass'),
      startedAt: (row.started_at as string | null | undefined) ?? null,
      expiresAt: (row.expires_at as string | null | undefined) ?? null,
      entitlementId: (row.entitlement_id as string | null | undefined) ?? null,
      isPremium: true,
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
