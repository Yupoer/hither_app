import { createPurchaseHandler } from './index.ts';

const ACCOUNT_TOKEN = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'user-1';
const TRANSACTION_ID = '100000000000001';

const envValues: Record<string, string> = {
  APPLE_BUNDLE_ID: 'app.hither.mobile',
  APPLE_STORE_ENVIRONMENT: 'Sandbox',
  PREMIUM_PRODUCT_IDS: 'app.hither.premium.monthly,app.hither.premium.annual',
  PREMIUM_SUBSCRIPTION_GROUP_ID: 'hither-premium',
  APPLE_ROOT_CERT_SHA256: 'test-root',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

const transactionPayload = {
  bundleId: 'app.hither.mobile',
  environment: 'Sandbox',
  productId: 'app.hither.premium.monthly',
  subscriptionGroupIdentifier: 'hither-premium',
  type: 'Auto-Renewable Subscription',
  inAppOwnershipType: 'PURCHASED',
  appAccountToken: ACCOUNT_TOKEN,
  transactionId: TRANSACTION_ID,
  originalTransactionId: TRANSACTION_ID,
  purchaseDate: 1_800_000_000_000,
  expiresDate: 1_800_100_000_000,
  signedDate: 1_800_000_001_000,
};

function request(overrides: Record<string, unknown> = {}): Request {
  return new Request('https://example.test/verify-and-apply-purchase', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer user-jwt',
    },
    body: JSON.stringify({
      signed_transaction: 'txn-jws',
      transaction_id: TRANSACTION_ID,
      product_id: 'app.hither.premium.monthly',
      ...overrides,
    }),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function handlerFor(options: {
  anonymous?: boolean;
  apply?: Record<string, unknown> | null;
  applyError?: unknown;
  environment?: string;
}) {
  const payload = { ...transactionPayload, environment: options.environment ?? 'Sandbox' };
  return createPurchaseHandler({
    env: (name) => envValues[name],
    now: () => 1_800_000_010_000,
    verifyJws: () => Promise.resolve({
      ok: true as const,
      header: { alg: 'ES256' },
      payload: payload as never,
      jwsSha256: 'hash-txn',
    }),
    createUser: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: USER_ID, is_anonymous: options.anonymous === true } },
          error: null,
        }),
      },
    }),
    createAdmin: () => ({
      rpc: async () => ({
        data: options.apply ?? {
          ok: true,
          durable: true,
          duplicate: false,
          status: 'active',
          entitlementVersion: 1,
          personalPremiumActive: true,
        },
        error: options.applyError ?? null,
      }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { app_account_token: ACCOUNT_TOKEN },
              error: null,
            }),
          }),
        }),
      }),
    }),
  });
}

Deno.test('durable purchase returns DB entitlementVersion not client flags', async () => {
  const response = await handlerFor({})(request({ isPremium: true, plan: 'forged' }));
  const result = await body(response);
  if (response.status !== 200 || result.durable !== true) {
    throw new Error(`expected durable grant, got ${response.status}`);
  }
  if (result.entitlementVersion !== 1 || result.personalPremiumActive !== true) {
    throw new Error('projection fields must come from the ledger');
  }
});

Deno.test('duplicate apply stays durable without a second grant', async () => {
  const response = await handlerFor({
    apply: {
      ok: true,
      durable: true,
      duplicate: true,
      status: 'active',
      entitlementVersion: 1,
      personalPremiumActive: true,
    },
  })(request());
  const result = await body(response);
  if (result.durable !== true || result.duplicate !== true) {
    throw new Error('duplicate apply must remain durable');
  }
});

Deno.test('anonymous callers cannot verify a purchase', async () => {
  const response = await handlerFor({ anonymous: true })(request());
  const result = await body(response);
  if (response.status !== 403 || result.error !== 'anonymous_upgrade_required') {
    throw new Error(`anonymous must fail closed, got ${response.status}`);
  }
});

Deno.test('cross-user originalTransactionId returns 422 and does not look durable', async () => {
  const response = await handlerFor({
    apply: { ok: false, error: 'transaction_binding_mismatch' },
  })(request());
  const result = await body(response);
  if (response.status !== 422 || result.ok !== false || result.durable === true) {
    throw new Error('binding mismatch must not grant');
  }
});

Deno.test('Production JWS verifies on a Sandbox-configured deployed function', async () => {
  const response = await handlerFor({ environment: 'Production' })(request());
  if (response.status !== 200) {
    throw new Error(`dual-env purchase rejected: ${response.status}`);
  }
});

Deno.test('Xcode JWS is rejected on deployed functions', async () => {
  const response = await handlerFor({ environment: 'Xcode' })(request());
  const result = await body(response);
  if (response.status !== 422 || result.error !== 'environment_mismatch') {
    throw new Error(`Xcode must be rejected, got ${response.status} ${result.error}`);
  }
});
