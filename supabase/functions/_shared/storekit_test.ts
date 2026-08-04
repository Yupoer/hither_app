import {
  storeKitConfigFromEnv,
  validateStoreKitTransaction,
} from './storekit.ts';

const config = {
  bundleId: 'app.hither.mobile',
  environment: 'Sandbox' as const,
  productIds: ['app.hither.premium.monthly', 'app.hither.premium.annual'],
  subscriptionGroupId: 'hither-premium',
  appAccountToken: '11111111-1111-1111-1111-111111111111',
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    bundleId: config.bundleId,
    environment: config.environment,
    productId: config.productIds[0],
    subscriptionGroupIdentifier: config.subscriptionGroupId,
    type: 'Auto-Renewable Subscription',
    inAppOwnershipType: 'PURCHASED',
    appAccountToken: config.appAccountToken,
    transactionId: '100000000000001',
    originalTransactionId: '100000000000001',
    purchaseDate: 1_800_000_000_000,
    signedDate: 1_800_000_001_000,
    expiresDate: 1_800_100_000_000,
    ...overrides,
  };
}

Deno.test('StoreKit transaction validation accepts a bound active purchase', () => {
  const result = validateStoreKitTransaction(payload(), config, 1_800_000_010_000, 'hash');
  if (!result.ok) throw new Error(result.error);
  if (result.transaction.status !== 'active') throw new Error('expected active');
  if (result.transaction.appAccountToken !== config.appAccountToken) {
    throw new Error('account token was not preserved');
  }
});

Deno.test('StoreKit validation rejects forged binding fields', () => {
  for (const [field, value] of [
    ['bundleId', 'other.bundle'],
    ['environment', 'Production'],
    ['productId', 'other.product'],
    ['subscriptionGroupIdentifier', 'other.group'],
    ['inAppOwnershipType', 'FAMILY_SHARED'],
    ['appAccountToken', '22222222-2222-2222-2222-222222222222'],
  ] as const) {
    const result = validateStoreKitTransaction(payload({ [field]: value }), config);
    if (result.ok) throw new Error(`accepted forged ${field}`);
  }
});

Deno.test('StoreKit validation fails closed when subscription type or expiry is missing', () => {
  for (const [field, overrides] of [
    ['type', { type: undefined }],
    ['expiresDate', { expiresDate: undefined }],
    ['invalid expiry date', { expiresDate: Number.MAX_SAFE_INTEGER }],
    ['expiry before purchase', { expiresDate: 1_799_000_000_000 }],
  ] as const) {
    const result = validateStoreKitTransaction(payload(overrides), config, 1_800_000_010_000);
    if (result.ok) throw new Error(`accepted ${field}`);
    if (!['transaction_date_invalid', 'transaction_expiry_invalid'].includes(result.error)) {
      throw new Error(`unexpected ${field} error: ${result.error}`);
    }
  }
});

Deno.test('validated StoreKit subscriptions always carry a non-null expiry', () => {
  const result = validateStoreKitTransaction(payload(), config, 1_800_000_010_000);
  if (!result.ok) throw new Error(result.error);
  if (!result.transaction.expiresAt) throw new Error('expiry was nullable');
  if (result.transaction.expiresAt <= result.transaction.purchaseDate) {
    throw new Error('expiry did not follow purchase date');
  }
});

Deno.test('StoreKit validation maps expiry and revocation to terminal states', () => {
  const expired = validateStoreKitTransaction(
    payload({ expiresDate: 1_700_000_000_000 }),
    config,
    1_800_000_010_000,
  );
  if (!expired.ok || expired.transaction.status !== 'expired') throw new Error('expected expired');

  const revoked = validateStoreKitTransaction(
    payload({ revocationDate: 1_800_000_002_000 }),
    config,
  );
  if (!revoked.ok || revoked.transaction.status !== 'revoked') throw new Error('expected revoked');
});

Deno.test('server configuration fails closed without root pin or exact two products', () => {
  const missing = storeKitConfigFromEnv(() => undefined);
  if (missing !== null) throw new Error('missing configuration was accepted');
  const configured = storeKitConfigFromEnv((name) => ({
    APPLE_BUNDLE_ID: 'app.hither.mobile',
    APPLE_STORE_ENVIRONMENT: 'Sandbox',
    PREMIUM_PRODUCT_IDS: 'monthly,annual',
    PREMIUM_SUBSCRIPTION_GROUP_ID: 'hither-premium',
    APPLE_ROOT_CERT_SHA256: 'abc',
  }[name]));
  if (!configured) throw new Error('complete configuration was rejected');
});
