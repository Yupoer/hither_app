/**
 * StoreKit 2 / Play subscription adapter.
 *
 * `expo-iap` delivers purchase results through an event listener. This module
 * keeps that listener single-flight and deliberately does not finish a
 * transaction. The caller must first receive a durable server grant and only
 * then call `finishPremiumPurchase`.
 */

import type { ProductSubscription, Purchase } from 'expo-iap';
import { PREMIUM_CATALOG } from '../premiumCatalog';

type IapModule = typeof import('expo-iap');

export type PurchaseResultStatus =
  | 'purchased'
  | 'restored'
  | 'pending'
  | 'cancelled'
  | 'unavailable'
  | 'failed';

export interface StorePurchase {
  status: 'purchased' | 'restored';
  transactionId: string;
  productId: string;
  /** StoreKit 2 JWS on iOS; Play purchase token on Android. Never log it. */
  purchaseToken: string;
  /** Original object required by expo-iap.finishTransaction. */
  purchase: Purchase;
  appAccountToken: string | null;
}
export type PurchaseResult =
  | StorePurchase
  | { status: 'pending'; productId?: string; transactionId?: string }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason?: string }
  | { status: 'failed'; reason?: string };

export type PremiumStoreProduct = Pick<
  ProductSubscription,
  'id' | 'displayName' | 'displayPrice' | 'description' | 'currency' | 'type'
> & {
  introductoryPriceIOS?: string | null;
  introductoryPriceNumberOfPeriodsIOS?: string | null;
  introductoryPricePaymentModeIOS?: string | null;
  introductoryOfferEligibleIOS?: boolean;
  subscriptionGroupIdIOS?: string | null;
  subscriptionPeriodUnitIOS?: string | null;
  subscriptionPeriodNumberIOS?: string | null;
};

/** UI may promise an introductory offer only after StoreKit confirms eligibility. */
export function hasEligibleIntroductoryOffer(
  product: PremiumStoreProduct,
): product is PremiumStoreProduct & { introductoryPriceIOS: string } {
  return product.introductoryOfferEligibleIOS === true
    && typeof product.introductoryPriceIOS === 'string'
    && product.introductoryPriceIOS.trim().length > 0;
}

type Deferred = {
  resolve: (result: PurchaseResult) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

let connectionPromise: Promise<IapModule | null> | null = null;
let updateSubscription: { remove: () => void } | null = null;
let errorSubscription: { remove: () => void } | null = null;
const waiters = new Map<string, Deferred[]>();
const unclaimed = new Map<string, StorePurchase>();

function isIosRuntime(): boolean {
  try {
    const reactNative = require('react-native') as { Platform?: { OS?: string } };
    return reactNative.Platform?.OS === 'ios';
  } catch {
    return false;
  }
}

function introOfferEligibility(
  iap: IapModule,
  groupId: string | null | undefined,
  eligibilityByGroup: Map<string, Promise<boolean>>,
): Promise<boolean> {
  if (!isIosRuntime() || !groupId?.trim()) return Promise.resolve(false);
  const normalizedGroupId = groupId.trim();
  const cached = eligibilityByGroup.get(normalizedGroupId);
  if (cached) return cached;

  const result = Promise.resolve()
    .then(async () => {
      try {
        return (await iap.isEligibleForIntroOfferIOS(normalizedGroupId)) === true;
      } catch {
        // Eligibility is a StoreKit-only promise. A missing native method,
        // unavailable store, or query error must never advertise a trial.
        return false;
      }
    })
    .catch(() => false);
  eligibilityByGroup.set(normalizedGroupId, result);
  return result;
}

function loadIap(): IapModule | null {
  try {
    // Lazy loading keeps Windows/Jest and Expo Go fail-closed when the native
    // module is not linked. A development stub must not fabricate purchases.
    return require('expo-iap') as IapModule;
  } catch {
    return null;
  }
}

function getTransactionId(purchase: Purchase): string | null {
  const transactionId =
    typeof purchase.transactionId === 'string' && purchase.transactionId.length > 0
      ? purchase.transactionId
      : typeof purchase.id === 'string' && purchase.id.length > 0
        ? purchase.id
        : null;
  return transactionId;
}

function mapPurchase(purchase: Purchase, status: 'purchased' | 'restored'): StorePurchase | null {
  const transactionId = getTransactionId(purchase);
  const purchaseToken =
    typeof purchase.purchaseToken === 'string' && purchase.purchaseToken.length > 0
      ? purchase.purchaseToken
      : null;
  if (!transactionId || !purchaseToken || !purchase.productId) return null;

  const appAccountToken =
    'appAccountToken' in purchase
    && typeof purchase.appAccountToken === 'string'
      ? purchase.appAccountToken
      : null;
  return {
    status,
    transactionId,
    productId: purchase.productId,
    purchaseToken,
    purchase,
    appAccountToken,
  };
}

function resolvePurchase(purchase: StorePurchase): void {
  const queue = waiters.get(purchase.productId);
  const deferred = queue?.shift();
  if (queue && queue.length === 0) waiters.delete(purchase.productId);
  if (deferred) {
    clearTimeout(deferred.timer);
    deferred.resolve(purchase);
    return;
  }
  unclaimed.set(purchase.transactionId, purchase);
}

async function ensureConnection(): Promise<IapModule | null> {
  if (connectionPromise) return connectionPromise;
  connectionPromise = Promise.resolve().then(async () => {
    const iap = loadIap();
    if (!iap) return null;
    await iap.initConnection();
    updateSubscription = iap.purchaseUpdatedListener((purchase) => {
      if (purchase.purchaseState === 'pending') return;
      const mapped = mapPurchase(purchase, 'purchased');
      if (mapped) resolvePurchase(mapped);
    }, { dedupeTransactionIOS: true });
    errorSubscription = iap.purchaseErrorListener((error) => {
      const productId = typeof error.productId === 'string' ? error.productId : null;
      if (!productId) return;
      const queue = waiters.get(productId);
      const deferred = queue?.shift();
      if (queue && queue.length === 0) waiters.delete(productId);
      if (!deferred) return;
      clearTimeout(deferred.timer);
      const code = typeof error.code === 'string' ? error.code : '';
      deferred.resolve(
        /cancel|user/i.test(code)
          ? { status: 'cancelled' }
          : { status: 'failed', reason: code || 'store_purchase_failed' },
      );
    });
    return iap;
  }).catch(() => null);
  return connectionPromise;
}

function addWaiter(productId: string, timeoutMs = 120_000): Promise<PurchaseResult> {
  const existing = [...unclaimed.values()].find((purchase) => purchase.productId === productId);
  if (existing) {
    unclaimed.delete(existing.transactionId);
    return Promise.resolve(existing);
  }

  return new Promise<PurchaseResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      const queue = waiters.get(productId);
      if (queue) {
        const index = queue.findIndex((item) => item.timer === timer);
        if (index >= 0) queue.splice(index, 1);
        if (queue.length === 0) waiters.delete(productId);
      }
      resolve({ status: 'failed', reason: 'store_purchase_timeout' });
    }, timeoutMs);
    const queue = waiters.get(productId) ?? [];
    queue.push({ resolve, reject, timer });
    waiters.set(productId, queue);
  });
}

export async function fetchPremiumProducts(): Promise<PremiumStoreProduct[]> {
  if (!PREMIUM_CATALOG.ready) return [];
  const iap = await ensureConnection();
  if (!iap) return [];
  try {
    const products = await iap.fetchProducts({
      skus: PREMIUM_CATALOG.products.map((product) => product.productId),
      type: 'subs',
    });
    const mappedProducts = (products ?? [])
      .filter((product): product is ProductSubscription => product.type === 'subs')
      .map((product) => ({
        id: product.id,
        displayName: product.displayName,
        displayPrice: product.displayPrice,
        description: product.description,
        currency: product.currency,
        type: product.type,
        introductoryPriceIOS:
          'introductoryPriceIOS' in product ? product.introductoryPriceIOS : null,
        introductoryPriceNumberOfPeriodsIOS:
          'introductoryPriceNumberOfPeriodsIOS' in product
            ? product.introductoryPriceNumberOfPeriodsIOS
            : null,
        introductoryPricePaymentModeIOS:
          'introductoryPricePaymentModeIOS' in product
            ? product.introductoryPricePaymentModeIOS
            : null,
        introductoryOfferEligibleIOS: false,
        subscriptionGroupIdIOS:
          'subscriptionGroupIdIOS' in product ? product.subscriptionGroupIdIOS : null,
        subscriptionPeriodUnitIOS:
          'subscriptionPeriodUnitIOS' in product ? product.subscriptionPeriodUnitIOS : null,
        subscriptionPeriodNumberIOS:
          'subscriptionPeriodNumberIOS' in product
            ? product.subscriptionPeriodNumberIOS
            : null,
      }));

    const groupIds = [...new Set(
      mappedProducts
        .map((product) => product.subscriptionGroupIdIOS?.trim() ?? '')
        .filter(Boolean),
    )];
    // Eligibility is a StoreKit account state, not durable product metadata.
    // Deduplicate the monthly/annual query only within this catalog fetch so a
    // later fetch can observe an account that has used or gained an offer.
    const eligibilityByGroup = new Map<string, Promise<boolean>>();
    const eligibility = new Map<string, boolean>();
    await Promise.all(groupIds.map(async (groupId) => {
      eligibility.set(
        groupId,
        await introOfferEligibility(iap, groupId, eligibilityByGroup),
      );
    }));
    return mappedProducts.map((product) => ({
      ...product,
      introductoryOfferEligibleIOS:
        product.subscriptionGroupIdIOS != null
        && eligibility.get(product.subscriptionGroupIdIOS.trim()) === true,
    }));
  } catch {
    return [];
  }
}

export async function requestPremiumSubscription(
  productId: string,
  appAccountToken: string,
): Promise<PurchaseResult> {
  if (!PREMIUM_CATALOG.ready || !PREMIUM_CATALOG.products.some((item) => item.productId === productId)) {
    return { status: 'unavailable', reason: 'subscription_catalog_not_ready' };
  }
  const iap = await ensureConnection();
  if (!iap) return { status: 'unavailable', reason: 'native_iap_not_linked' };

  const pending = addWaiter(productId);
  try {
    await iap.requestPurchase({
      type: 'subs',
      request: {
        apple: { sku: productId, appAccountToken },
        google: { skus: [productId], obfuscatedAccountId: appAccountToken },
      },
    });
    return await pending;
  } catch (error) {
    const queue = waiters.get(productId);
    const deferred = queue?.shift();
    if (queue && queue.length === 0) waiters.delete(productId);
    if (deferred) clearTimeout(deferred.timer);
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'store_purchase_failed',
    };
  }
}

export async function getUnfinishedPremiumPurchases(): Promise<StorePurchase[]> {
  const iap = await ensureConnection();
  if (!iap) return [];
  const purchases: Purchase[] = [];
  try {
    if (typeof iap.getPendingTransactionsIOS === 'function') {
      purchases.push(...(await iap.getPendingTransactionsIOS()));
    }
  } catch {
    // Android and older runtimes do not expose the iOS queue query.
  }
  try {
    purchases.push(
      ...(await iap.getAvailablePurchases({ onlyIncludeActiveItemsIOS: true })),
    );
  } catch {
    // Store unavailable is handled by returning no trusted purchase.
  }

  const byTransaction = new Map<string, StorePurchase>();
  for (const purchase of purchases) {
    if (!PREMIUM_CATALOG.products.some((item) => item.productId === purchase.productId)) continue;
    const mapped = mapPurchase(purchase, 'restored');
    if (mapped) byTransaction.set(mapped.transactionId, mapped);
  }
  for (const purchase of unclaimed.values()) {
    if (PREMIUM_CATALOG.products.some((item) => item.productId === purchase.productId)) {
      byTransaction.set(purchase.transactionId, purchase);
    }
  }
  return [...byTransaction.values()];
}

export async function restorePremiumPurchases(): Promise<StorePurchase[]> {
  if (!PREMIUM_CATALOG.ready) return [];
  const iap = await ensureConnection();
  if (!iap) return [];
  try {
    await iap.restorePurchases();
  } catch {
    // The subsequent available-purchases query remains the source of truth.
  }
  return getUnfinishedPremiumPurchases();
}

/** Finish only after the server confirms a durable ledger/grant write. */
export async function finishPremiumPurchase(purchase: StorePurchase): Promise<void> {
  const iap = await ensureConnection();
  if (!iap) throw new Error('native_iap_not_linked');
  await iap.finishTransaction({ purchase: purchase.purchase, isConsumable: false });
}

/** Compatibility boundary for old callers; no product is guessed or unlocked. */
export async function purchasePro(): Promise<PurchaseResult> {
  return { status: 'unavailable', reason: 'use_premium_subscription_flow' };
}

/** Compatibility restore entry point; callers should use the coordinator. */
export async function restorePurchases(): Promise<PurchaseResult> {
  const [purchase] = await restorePremiumPurchases();
  return purchase ?? { status: 'unavailable', reason: 'no_active_subscription' };
}

/** True when a store event contains the opaque token and stable transaction ID. */
export function isVerifiedPurchase(result: PurchaseResult): result is StorePurchase {
  return (
    (result.status === 'purchased' || result.status === 'restored')
    && result.transactionId.length > 0
    && result.purchaseToken.length > 0
  );
}

export function __resetPurchaseAdapterForTests(): void {
  connectionPromise = null;
  updateSubscription?.remove();
  errorSubscription?.remove();
  updateSubscription = null;
  errorSubscription = null;
  for (const queue of waiters.values()) {
    for (const deferred of queue) {
      clearTimeout(deferred.timer);
      deferred.reject(new Error('purchase_adapter_reset'));
    }
  }
  waiters.clear();
  unclaimed.clear();
}
