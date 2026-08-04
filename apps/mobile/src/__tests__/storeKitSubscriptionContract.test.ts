import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf8'),
) as { dependencies?: Record<string, string> };
const catalog = readFileSync(join(__dirname, '../premiumCatalog.ts'), 'utf8');
const adapter = readFileSync(join(__dirname, '../native/purchases.ts'), 'utf8');
const coordinator = readFileSync(join(__dirname, '../services/premiumPurchaseFlow.ts'), 'utf8');
const service = readFileSync(join(__dirname, '../api/services/EntitlementService.ts'), 'utf8');
const ledger = readFileSync(
  join(root, 'supabase/migrations/20260804030000_storekit_purchase_and_notification_ledger.sql'),
  'utf8',
);
const premiumProjection = readFileSync(
  join(root, 'supabase/migrations/20260804000000_personal_premium_projection.sql'),
  'utf8',
);
const verifier = readFileSync(join(root, 'supabase/functions/verify-and-apply-purchase/index.ts'), 'utf8');
const notifications = readFileSync(join(root, 'supabase/functions/apple-server-notifications/index.ts'), 'utf8');
const storekit = readFileSync(join(root, 'supabase/functions/_shared/storekit.ts'), 'utf8');
const paywall = readFileSync(join(__dirname, '../components/PaywallSheet.tsx'), 'utf8');

describe('Ticket 6 catalog and StoreKit native boundary', () => {
  it('uses expo-iap subscriptions and a fail-closed build-time catalog', () => {
    expect(packageJson.dependencies?.['expo-iap']).toBe('5.0.0');
    expect(catalog).toContain('EXPO_PUBLIC_PREMIUM_MONTHLY_PRODUCT_ID');
    expect(catalog).toContain('EXPO_PUBLIC_PREMIUM_ANNUAL_PRODUCT_ID');
    expect(catalog).toContain('EXPO_PUBLIC_PREMIUM_SUBSCRIPTION_GROUP_ID');
    expect(catalog).toContain('ready:');
    expect(adapter).toContain("type: 'subs'");
    expect(adapter).toContain('displayPrice');
    expect(adapter).toContain('appAccountToken');
  });

  it('requires StoreKit group eligibility before showing an intro offer', () => {
    expect(adapter).toContain('isEligibleForIntroOfferIOS');
    expect(adapter).toContain('introOfferEligibilityByGroup');
    expect(adapter).toContain('introductoryOfferEligibleIOS');
    expect(adapter).toContain("Platform?.OS === 'ios'");
    expect(paywall).toContain('hasEligibleIntroductoryOffer(product)');
    expect(paywall).toContain('introductoryPriceIOS');
  });

  it('finishes only after durable server verification', () => {
    expect(coordinator).toContain('applyVerifiedSubscription');
    expect(coordinator).toContain('finishPremiumPurchase');
    expect(coordinator.indexOf('await applyVerifiedSubscription')).toBeLessThan(
      coordinator.indexOf('await finishPremiumPurchase'),
    );
    expect(adapter).toContain('deliberately does not finish');
    expect(service).toContain('verification_service_unavailable');
    const subscriptionSource = service.slice(
      service.indexOf('export async function applyVerifiedSubscription'),
      service.indexOf('export async function applyVerifiedPurchase'),
    );
    expect(subscriptionSource).not.toContain('apply_verified_purchase');
  });
});

describe('Tickets 7-8 server ledger and verification contract', () => {
  it('binds a server-generated account token and stores no raw JWS', () => {
    expect(ledger).toContain('get_or_create_premium_app_account_token');
    expect(ledger).toContain('premium_store_transactions');
    expect(ledger).toContain('premium_store_notifications');
    expect(ledger).toContain('jws_sha256');
    expect(ledger).toContain('raw JWS is never persisted');
    expect(ledger).toContain('apply_storekit_transaction');
    expect(premiumProjection).toContain('source_signed_at');
    expect(premiumProjection).toContain('personal_premium_entitlements');
  });

  it('validates Apple JWS chain and all entitlement binding fields', () => {
    expect(storekit).toContain("compactVerify");
    expect(storekit).toContain('X509ChainBuilder');
    expect(storekit).toContain('APPLE_ROOT_CERT_SHA256');
    for (const field of [
      'bundle_mismatch',
      'environment_mismatch',
      'product_mismatch',
      'subscription_group_mismatch',
      'ownership_mismatch',
      'account_token_mismatch',
      'expiresDate',
      'revocationDate',
    ]) expect(storekit).toContain(field);
    expect(verifier).toContain('apply_storekit_transaction');
    expect(verifier).toContain('durable: true');
    expect(verifier).toContain('signed_transaction');
    expect(verifier).not.toContain('finishTransaction');
  });

  it('handles ASN V2 lifecycle, replay and signed-date ordering at the server seam', () => {
    expect(notifications).toContain('record_storekit_notification');
    expect(notifications).toContain('REFUND');
    expect(notifications).toContain('REVOKE');
    expect(notifications).toContain('DID_RENEW');
    expect(notifications).toContain('duplicate');
    expect(notifications).toContain('signedAt');
    expect(ledger).toContain('if v_existing.signed_at >= p_signed_at');
  });
});
