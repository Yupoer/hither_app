/**
 * StoreKit subscription coordinator.
 *
 * The coordinator owns the durable-grant boundary: verify on the server first,
 * then finish the native transaction. A failed network/server step leaves the
 * transaction unfinished so the next launch can retry it.
 */

import {
  applyVerifiedSubscription,
  getPremiumAppAccountToken,
  getPremiumProjection,
} from '../api/client';
import {
  fetchPremiumProducts,
  finishPremiumPurchase,
  getUnfinishedPremiumPurchases,
  isVerifiedPurchase,
  requestPremiumSubscription,
  restorePremiumPurchases,
  type PremiumStoreProduct,
  type StorePurchase,
  type PurchaseResult,
} from '../native/purchases';
import type { PremiumProjection, EntitlementMutationResult } from '../entitlements';
import type { PremiumPlan } from '../premiumCatalog';
import { premiumProductForPlan } from '../premiumCatalog';

export type PremiumPurchaseFlowResult =
  | { ok: true; purchase: StorePurchase; projection?: PremiumProjection }
  | {
    ok: false;
    error: string;
    native?: PurchaseResult;
    applied?: EntitlementMutationResult;
  };

const inFlight = new Map<string, Promise<PremiumPurchaseFlowResult>>();

/** Shared in-flight product fetch so Store + Paywall do not double-hit the store. */
let productsInFlight: Promise<PremiumStoreProduct[]> | null = null;
let productsCache: PremiumStoreProduct[] | null = null;
let productsCacheAt = 0;
const PRODUCTS_CACHE_TTL_MS = 60_000;

export async function loadPremiumStoreProducts(): Promise<PremiumStoreProduct[]> {
  if (productsCache && Date.now() - productsCacheAt < PRODUCTS_CACHE_TTL_MS) {
    return productsCache;
  }
  if (productsInFlight) return productsInFlight;
  productsInFlight = fetchPremiumProducts()
    .then((next) => {
      productsCache = next;
      productsCacheAt = Date.now();
      return next;
    })
    .finally(() => {
      productsInFlight = null;
    });
  return productsInFlight;
}

function failedFromNative(result: PurchaseResult): PremiumPurchaseFlowResult {
  const reason = 'reason' in result ? result.reason : undefined;
  if (result.status === 'unavailable') return { ok: false, error: reason ?? 'store_unavailable', native: result };
  if (result.status === 'cancelled') return { ok: false, error: 'cancelled', native: result };
  if (result.status === 'pending') return { ok: false, error: 'pending', native: result };
  return { ok: false, error: reason ?? 'store_purchase_failed', native: result };
}

async function settlePurchase(
  purchase: StorePurchase,
  source: 'purchase' | 'restore' | 'recovery',
): Promise<PremiumPurchaseFlowResult> {
  const existing = inFlight.get(purchase.transactionId);
  if (existing) return existing;

  const work = (async (): Promise<PremiumPurchaseFlowResult> => {
    const applied = await applyVerifiedSubscription({
      signedTransaction: purchase.purchaseToken,
      transactionId: purchase.transactionId,
      productId: purchase.productId,
      source,
    });
    if (!applied.ok) {
      // Do not finish: server/network failure must be retried from the native
      // unfinished queue after restart.
      return { ok: false, error: String(applied.error ?? 'verification_failed'), applied };
    }

    try {
      await finishPremiumPurchase(purchase);
    } catch {
      // The ledger is durable, but the native queue remains recoverable. The
      // next foreground/startup reconciliation will retry finishTransaction.
      return { ok: false, error: 'finish_transaction_failed', applied };
    }
    return { ok: true, purchase };
  })();
  inFlight.set(purchase.transactionId, work);
  try {
    return await work;
  } finally {
    if (inFlight.get(purchase.transactionId) === work) inFlight.delete(purchase.transactionId);
  }
}

export async function purchasePremiumSubscription(
  plan: PremiumPlan,
): Promise<PremiumPurchaseFlowResult> {
  const product = premiumProductForPlan(plan);
  if (!product) return { ok: false, error: 'subscription_catalog_not_ready' };

  let appAccountToken: string;
  try {
    appAccountToken = await getPremiumAppAccountToken();
  } catch {
    return { ok: false, error: 'account_token_not_ready' };
  }

  const nativeResult = await requestPremiumSubscription(product.productId, appAccountToken);
  if (!isVerifiedPurchase(nativeResult)) return failedFromNative(nativeResult);
  return settlePurchase(nativeResult, 'purchase');
}

export async function restorePremiumSubscription(
  groupId?: string | null,
): Promise<{
  ok: boolean;
  restored: number;
  projection: PremiumProjection;
  error?: string;
}> {
  const nativePurchases = await restorePremiumPurchases();
  let firstError: string | undefined;
  let restored = 0;
  for (const purchase of nativePurchases) {
    const result = await settlePurchase(purchase, 'restore');
    if (result.ok) restored += 1;
    else if (!firstError && result.error !== 'cancelled') firstError = result.error;
  }

  try {
    const projection = await getPremiumProjection(groupId);
    return { ok: !firstError, restored, projection, error: firstError };
  } catch {
    return {
      ok: false,
      restored,
      projection: {
        personalPremiumActive: false,
        teamPremiumActive: false,
        status: 'none',
        productId: null,
        expiresAt: null,
        sourceVersion: null,
      },
      error: firstError ?? 'projection_unavailable',
    };
  }
}

/** Cold-start/foreground recovery for unfinished StoreKit transactions. */
export async function reconcileUnfinishedPremiumPurchases(): Promise<{
  attempted: number;
  settled: number;
  failed: number;
}> {
  const nativePurchases = await getUnfinishedPremiumPurchases();
  let settled = 0;
  let failed = 0;
  for (const purchase of nativePurchases) {
    const result = await settlePurchase(purchase, 'recovery');
    if (result.ok) settled += 1;
    else failed += 1;
  }
  return { attempted: nativePurchases.length, settled, failed };
}
