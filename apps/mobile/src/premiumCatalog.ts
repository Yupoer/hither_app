/**
 * The only client-side source of Premium product identifiers.
 *
 * Product IDs are public App Store identifiers (not secrets). Env vars may
 * override the defaults; an empty env falls back to the shipped catalog so
 * StoreKit PayKit can open. Prices themselves are never hardcoded — StoreKit
 * supplies displayPrice and intro eligibility.
 */

export const PREMIUM_CATALOG_VERSION = 'premium-subscriptions-v2';

export type PremiumPlan = 'monthly' | 'annual' | 'trip';

export type PremiumProductConfig = {
  plan: PremiumPlan;
  productId: string;
  storeType: 'subs' | 'in-app';
};

export type PremiumCatalog = {
  version: string;
  subscriptionGroupId: string | null;
  products: readonly PremiumProductConfig[];
  ready: boolean;
  reason?: 'missing_product_id' | 'missing_subscription_group' | 'duplicate_product_id';
};

function env(name: string, fallback: string): string {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
}

/** Public App Store product IDs — previous Hither catalog. */
const DEFAULT_MONTHLY = 'app.hither.premium.monthly';
const DEFAULT_ANNUAL = 'app.hither.premium.annual';
const DEFAULT_TRIP = 'hither.small_trip_pass';
const DEFAULT_GROUP = 'hither-premium';

const monthlyProductId = env('EXPO_PUBLIC_PREMIUM_MONTHLY_PRODUCT_ID', DEFAULT_MONTHLY);
const annualProductId = env('EXPO_PUBLIC_PREMIUM_ANNUAL_PRODUCT_ID', DEFAULT_ANNUAL);
const tripProductId = env('EXPO_PUBLIC_PREMIUM_TRIP_PRODUCT_ID', DEFAULT_TRIP);
const subscriptionGroupId = env('EXPO_PUBLIC_PREMIUM_SUBSCRIPTION_GROUP_ID', DEFAULT_GROUP);

const products: readonly PremiumProductConfig[] = [
  { plan: 'monthly', productId: monthlyProductId, storeType: 'subs' },
  { plan: 'annual', productId: annualProductId, storeType: 'subs' },
  { plan: 'trip', productId: tripProductId, storeType: 'in-app' },
].filter((item): item is PremiumProductConfig => item.productId.length > 0);

const hasDuplicateProductId =
  new Set(products.map((item) => item.productId)).size !== products.length;

const monthlyReady = monthlyProductId.length > 0;
const annualReady = annualProductId.length > 0;
const groupReady = subscriptionGroupId.length > 0;

export const PREMIUM_CATALOG: PremiumCatalog = {
  version: PREMIUM_CATALOG_VERSION,
  subscriptionGroupId: subscriptionGroupId || null,
  products,
  ready: monthlyReady && annualReady && groupReady && !hasDuplicateProductId,
  ...(!monthlyReady || !annualReady
    ? { reason: 'missing_product_id' as const }
    : !groupReady
      ? { reason: 'missing_subscription_group' as const }
      : hasDuplicateProductId
        ? { reason: 'duplicate_product_id' as const }
        : {}),
};

export function premiumProductForPlan(plan: PremiumPlan): PremiumProductConfig | null {
  return PREMIUM_CATALOG.products.find((product) => product.plan === plan) ?? null;
}

export function premiumPlanForProduct(productId: string): PremiumPlan | null {
  return PREMIUM_CATALOG.products.find((product) => product.productId === productId)?.plan ?? null;
}
