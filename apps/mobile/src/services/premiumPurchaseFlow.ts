/**
 * StoreKit subscription coordinator.
 *
 * The coordinator owns the durable-grant boundary: verify on the server first,
 * then finish the native transaction. A failed network/server step leaves the
 * transaction unfinished so the next launch can retry it.
 */

import {
  applyVerifiedSubscription,
  applyVerifiedTripPass,
  getPremiumAppAccountToken,
  getPremiumProjection,
} from '../api/client';
import { syncAppStoreSubscription } from '../api/services/EntitlementService';
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
import {
  EMPTY_PREMIUM_PROJECTION,
  type PremiumProjection,
  type EntitlementMutationResult,
} from '../entitlements';
import type { PremiumPlan } from '../premiumCatalog';
import { premiumPlanForProduct, premiumProductForPlan } from '../premiumCatalog';
import {
  cacheBlobToProjection,
  emptyPersonalProjection,
  readPremiumProjectionCache,
  writePremiumProjectionCache,
} from './premiumProjectionCache';

export type PremiumPurchaseFlowResult =
  | { ok: true; purchase: StorePurchase; projection?: PremiumProjection }
  | {
    ok: false;
    error: string;
    native?: PurchaseResult;
    applied?: EntitlementMutationResult;
  };

const inFlight = new Map<string, Promise<PremiumPurchaseFlowResult>>();
let refreshInFlight: Promise<PremiumProjection> | null = null;

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

function projectionFromApply(
  applied: EntitlementMutationResult,
  previous?: PremiumProjection,
): PremiumProjection {
  const live = applied.personalPremiumActive === true;
  return {
    ...EMPTY_PREMIUM_PROJECTION,
    ...previous,
    personalPremiumActive: live,
    status: (applied.status as PremiumProjection['status']) ?? (live ? 'active' : 'none'),
    productId: applied.productId ?? previous?.productId ?? null,
    expiresAt: applied.expiresAt ?? previous?.expiresAt ?? null,
    entitlementVersion: applied.entitlementVersion ?? previous?.entitlementVersion ?? null,
    lastSyncedAt: new Date().toISOString(),
    ok: live,
    error: live ? null : 'subscription_required',
  };
}

async function persistProjection(
  userId: string | null | undefined,
  projection: PremiumProjection,
): Promise<PremiumProjection> {
  if (userId && (projection.personalPremiumActive || projection.error !== 'subscription_required')) {
    await writePremiumProjectionCache(userId, projection);
  }
  return projection;
}

async function settlePurchase(
  purchase: StorePurchase,
  source: 'purchase' | 'restore' | 'recovery',
  userId?: string | null,
  groupId?: string | null,
): Promise<PremiumPurchaseFlowResult> {
  const existing = inFlight.get(purchase.transactionId);
  if (existing) return existing;

  const work = (async (): Promise<PremiumPurchaseFlowResult> => {
    const plan = premiumPlanForProduct(purchase.productId);
    const isConsumable = plan === 'trip';
    if (isConsumable && !groupId) {
      return { ok: false, error: 'group_required_for_trip_pass' };
    }
    let applied: EntitlementMutationResult;
    try {
      applied = isConsumable
        ? await applyVerifiedTripPass({
          signedTransaction: purchase.purchaseToken,
          transactionId: purchase.transactionId,
          productId: purchase.productId,
          groupId: groupId!,
        })
        : await applyVerifiedSubscription({
          signedTransaction: purchase.purchaseToken,
          transactionId: purchase.transactionId,
          productId: purchase.productId,
          source,
        });
    } catch {
      return { ok: false, error: 'verification_service_unavailable' };
    }
    if (!applied.ok) {
      return { ok: false, error: String(applied.error ?? 'verification_failed'), applied };
    }

    const projection = isConsumable ? undefined : projectionFromApply(applied);
    if (userId && projection) await persistProjection(userId, projection);

    try {
      await finishPremiumPurchase(purchase, { isConsumable });
    } catch {
      return { ok: false, error: 'finish_transaction_failed', applied };
    }
    return { ok: true, purchase, ...(projection ? { projection } : {}) };
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
  options: {
    userId?: string | null;
    isAnonymous?: boolean;
    groupId?: string | null;
    onNativePurchased?: () => void;
  } = {},
): Promise<PremiumPurchaseFlowResult> {
  if (options.isAnonymous) return { ok: false, error: 'anonymous_upgrade_required' };
  const product = premiumProductForPlan(plan);
  if (!product) return { ok: false, error: 'subscription_catalog_not_ready' };
  if (plan === 'trip' && !options.groupId) {
    return { ok: false, error: 'group_required_for_trip_pass' };
  }

  let appAccountToken: string;
  try {
    appAccountToken = await getPremiumAppAccountToken();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'account_token_not_ready';
    if (/anonymous/i.test(message)) return { ok: false, error: 'anonymous_upgrade_required' };
    return { ok: false, error: 'account_token_not_ready' };
  }

  const nativeResult = await requestPremiumSubscription(product.productId, appAccountToken);
  if (!isVerifiedPurchase(nativeResult)) return failedFromNative(nativeResult);
  options.onNativePurchased?.();
  return settlePurchase(nativeResult, 'purchase', options.userId, options.groupId);
}

export async function restorePremiumSubscription(
  groupId?: string | null,
  options: { userId?: string | null; isAnonymous?: boolean } = {},
): Promise<{
  ok: boolean;
  restored: number;
  projection: PremiumProjection;
  error?: string;
}> {
  if (options.isAnonymous) {
    return {
      ok: false,
      restored: 0,
      projection: emptyPersonalProjection(),
      error: 'anonymous_upgrade_required',
    };
  }
  const nativePurchases = await restorePremiumPurchases();
  let firstError: string | undefined;
  let restored = 0;
  let lastProjection: PremiumProjection | undefined;
  for (const purchase of nativePurchases) {
    const result = await settlePurchase(purchase, 'restore', options.userId, groupId);
    if (result.ok) {
      restored += 1;
      lastProjection = result.projection;
    } else if (!firstError && result.error !== 'cancelled') firstError = result.error;
  }

  try {
    const projection = await getPremiumProjection(groupId);
    if (options.userId) {
      if (projection.error === 'subscription_required' && !projection.personalPremiumActive) {
        await persistProjection(options.userId, {
          ...projection,
          personalPremiumActive: false,
        });
      } else {
        await persistProjection(options.userId, projection);
      }
    }
    return { ok: !firstError, restored, projection, error: firstError };
  } catch {
    return {
      ok: false,
      restored,
      projection: lastProjection ?? emptyPersonalProjection(),
      error: firstError ?? 'projection_unavailable',
    };
  }
}

/** Cold-start/foreground recovery for unfinished StoreKit transactions. */
export async function reconcileUnfinishedPremiumPurchases(
  options: { userId?: string | null; groupId?: string | null },
): Promise<{
  attempted: number;
  settled: number;
  failed: number;
}> {
  const nativePurchases = await getUnfinishedPremiumPurchases();
  let settled = 0;
  let failed = 0;
  for (const purchase of nativePurchases) {
    const result = await settlePurchase(purchase, 'recovery', options.userId, options.groupId);
    if (result.ok) settled += 1;
    else failed += 1;
  }
  return { attempted: nativePurchases.length, settled, failed };
}

export async function refreshPremiumProjection(options: {
  groupId?: string | null;
  userId?: string | null;
  syncStoreKitIfMissing?: boolean;
}): Promise<PremiumProjection> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    let projection = await getPremiumProjection(options.groupId);
    if (
      options.syncStoreKitIfMissing
      && projection.error === 'subscription_required'
      && !projection.personalPremiumActive
    ) {
      const unfinished = await getUnfinishedPremiumPurchases({ includeConsumables: false });
      if (unfinished.length > 0) {
        const synced = await syncAppStoreSubscription({
          signedTransaction: unfinished[0].purchaseToken,
        });
        if (synced.ok) {
          projection = await getPremiumProjection(options.groupId);
        }
      }
    }
    if (options.userId) {
      if (projection.error === 'subscription_required' && !projection.personalPremiumActive) {
        const { clearPremiumProjectionCache } = await import('./premiumProjectionCache');
        await clearPremiumProjectionCache(options.userId);
      } else {
        await persistProjection(options.userId, projection);
      }
    }
    return projection;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function ensurePersonalPremiumAccess(options: {
  userId: string;
  groupId?: string | null;
  cacheStale: boolean;
  cachedLive: boolean;
}): Promise<{ allowed: boolean; projection: PremiumProjection; reason?: string }> {
  if (!options.cacheStale && options.cachedLive) {
    const cached = await readPremiumProjectionCache(options.userId);
    if (cached?.isPremium) {
      return { allowed: true, projection: cacheBlobToProjection(cached) };
    }
  }
  const projection = await refreshPremiumProjection({
    groupId: options.groupId,
    userId: options.userId,
    syncStoreKitIfMissing: true,
  });
  if (projection.personalPremiumActive) return { allowed: true, projection };
  return {
    allowed: false,
    projection,
    reason: projection.error ?? 'subscription_required',
  };
}
