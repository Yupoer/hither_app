/**
 * The only client-side source of Premium subscription product identifiers.
 *
 * Product IDs and the App Store subscription group are injected at build time.
 * An incomplete catalog is deliberately unusable: StoreKit must never be
 * presented with a guessed product or a local trial flag.
 */

export const PREMIUM_CATALOG_VERSION = 'premium-subscriptions-v1';

export type PremiumPlan = 'monthly' | 'annual';

export type PremiumProductConfig = {
  plan: PremiumPlan;
  productId: string;
};

export type PremiumCatalog = {
  version: string;
  subscriptionGroupId: string | null;
  products: readonly PremiumProductConfig[];
  ready: boolean;
  reason?: 'missing_product_id' | 'missing_subscription_group' | 'duplicate_product_id';
};

function env(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

const monthlyProductId = env('EXPO_PUBLIC_PREMIUM_MONTHLY_PRODUCT_ID');
const annualProductId = env('EXPO_PUBLIC_PREMIUM_ANNUAL_PRODUCT_ID');
const subscriptionGroupId = env('EXPO_PUBLIC_PREMIUM_SUBSCRIPTION_GROUP_ID');

const products: readonly PremiumProductConfig[] = [
  { plan: 'monthly', productId: monthlyProductId },
  { plan: 'annual', productId: annualProductId },
].filter((item): item is PremiumProductConfig => item.productId.length > 0);

const hasDuplicateProductId =
  new Set(products.map((item) => item.productId)).size !== products.length;

export const PREMIUM_CATALOG: PremiumCatalog = {
  version: PREMIUM_CATALOG_VERSION,
  subscriptionGroupId: subscriptionGroupId || null,
  products,
  ready:
    monthlyProductId.length > 0
    && annualProductId.length > 0
    && subscriptionGroupId.length > 0
    && !hasDuplicateProductId,
  ...(monthlyProductId.length === 0 || annualProductId.length === 0
    ? { reason: 'missing_product_id' as const }
    : subscriptionGroupId.length === 0
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

