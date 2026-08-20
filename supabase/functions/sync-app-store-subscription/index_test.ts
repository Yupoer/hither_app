import { createSyncHandler } from './index.ts';

const ACCOUNT_TOKEN = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORIGINAL = '100000000000001';

const envValues: Record<string, string> = {
  APPLE_BUNDLE_ID: 'app.hither.mobile',
  APPLE_STORE_ENVIRONMENT: 'Sandbox',
  PREMIUM_PRODUCT_IDS: 'app.hither.premium.monthly,app.hither.premium.annual',
  PREMIUM_SUBSCRIPTION_GROUP_ID: 'hither-premium',
  APPLE_ROOT_CERT_SHA256: 'test-root',
  APPLE_ISSUER_ID: 'issuer',
  APPLE_KEY_ID: 'keyid',
  APPLE_PRIVATE_KEY: 'not-a-real-p8',
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
  transactionId: ORIGINAL,
  originalTransactionId: ORIGINAL,
  purchaseDate: 1_800_000_000_000,
  expiresDate: 1_800_100_000_000,
  signedDate: 1_800_000_001_000,
};

function request(
  body: Record<string, unknown>,
  kind: 'authenticated' | 'service_role' | 'forged_service' = 'authenticated',
): Request {
  let authorization: string;
  if (kind === 'service_role') {
    authorization = `Bearer ${envValues.SUPABASE_SERVICE_ROLE_KEY}`;
  } else if (kind === 'forged_service') {
    const payload = btoa(JSON.stringify({ role: 'service_role', sub: USER_ID }));
    authorization = `Bearer header.${payload}.sig`;
  } else {
    const payload = btoa(JSON.stringify({ role: 'authenticated', sub: USER_ID }));
    authorization = `Bearer header.${payload}.sig`;
  }
  return new Request('https://example.test/sync-app-store-subscription', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify(body),
  });
}

async function read(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function logsSafe(output: string): boolean {
  return !/BEGIN PRIVATE KEY|signed_transaction|eyJ/.test(output)
    && !output.includes('not-a-real-p8');
}

Deno.test('user JWT + missing ledger JWS applies durably without ASN V2', async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  try {
    const handler = createSyncHandler({
      env: (name) => envValues[name],
      now: () => 1_800_000_010_000,
      verifyJws: () => Promise.resolve({
        ok: true as const,
        header: { alg: 'ES256' },
        payload: transactionPayload as never,
        jwsSha256: 'hash-txn',
      }),
      createUser: () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: USER_ID, is_anonymous: false } }, error: null }),
        },
      }),
      createAdmin: () => ({
        rpc: async (name: string) => {
          if (name === 'apply_storekit_transaction') {
            return {
              data: {
                ok: true,
                durable: true,
                duplicate: false,
                status: 'active',
                entitlementVersion: 1,
                personalPremiumActive: true,
              },
              error: null,
            };
          }
          return { data: { ok: true }, error: null };
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { app_account_token: ACCOUNT_TOKEN }, error: null }),
            }),
          }),
        }),
      }),
    });
    const response = await handler(request({ signed_transaction: 'device-jws' }));
    const result = await read(response);
    if (response.status !== 200 || result.durable !== true) {
      throw new Error(`expected durable compensation, got ${response.status}`);
    }
    if (!logs.every(logsSafe)) throw new Error('compensation logs leaked secrets');
  } finally {
    console.log = originalLog;
  }
});

Deno.test('service_role bound originalTransactionId apply is idempotent', async () => {
  let applyCount = 0;
  const handler = createSyncHandler({
    env: (name) => envValues[name],
    now: () => 1_800_000_010_000,
    verifyJws: () => Promise.resolve({
      ok: true as const,
      header: { alg: 'ES256' },
      payload: transactionPayload as never,
      jwsSha256: 'hash-txn',
    }),
    connectJwt: 'test-connect-jwt',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ lastTransactions: [{ signedTransactionInfo: 'apple-jws' }] }],
      }),
    }),
    createAdmin: () => ({
      rpc: async (name: string) => {
        if (name === 'apply_storekit_transaction') {
          applyCount += 1;
          return {
            data: {
              ok: true,
              durable: true,
              duplicate: applyCount > 1,
              status: 'active',
              entitlementVersion: 1,
              personalPremiumActive: true,
            },
            error: null,
          };
        }
        return { data: { ok: true }, error: null };
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { user_id: USER_ID, app_account_token: ACCOUNT_TOKEN, environment: 'Sandbox' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  });
  const first = await handler(request(
    { originalTransactionId: ORIGINAL, environment: 'Sandbox' },
    'service_role',
  ));
  const second = await handler(request(
    { originalTransactionId: ORIGINAL, environment: 'Sandbox' },
    'service_role',
  ));
  const firstBody = await read(first);
  const secondBody = await read(second);
  if (first.status !== 200 || firstBody.durable !== true) throw new Error('first service_role sync failed');
  if (secondBody.durable !== true || secondBody.duplicate !== true) {
    throw new Error('second apply must be durable duplicate');
  }
});

Deno.test('user JWT cannot sync another user originalTransactionId', async () => {
  const handler = createSyncHandler({
    env: (name) => envValues[name],
    now: () => 1_800_000_010_000,
    createUser: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: USER_ID, is_anonymous: false } }, error: null }),
      },
    }),
    createAdmin: () => ({
      rpc: async () => ({ data: { ok: true }, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              return { data: { app_account_token: ACCOUNT_TOKEN, user_id: OTHER_USER }, error: null };
            },
          }),
        }),
      }),
    }),
  });
  const response = await handler(request({ originalTransactionId: ORIGINAL }));
  const result = await read(response);
  if (response.status !== 422 || result.error !== 'transaction_binding_mismatch') {
    throw new Error(`expected binding mismatch, got ${response.status} ${result.error}`);
  }
});

Deno.test('missing Connect API secrets fail closed without logging P8', async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  try {
    const handler = createSyncHandler({
      env: (name) => (name === 'APPLE_PRIVATE_KEY' || name === 'APPLE_P8' ? undefined : envValues[name]),
      now: () => 1_800_000_010_000,
      createAdmin: () => ({
        rpc: async () => ({ data: { ok: true }, error: null }),
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { user_id: USER_ID, app_account_token: ACCOUNT_TOKEN, environment: 'Sandbox' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    });
    const response = await handler(request(
      { originalTransactionId: ORIGINAL, environment: 'Sandbox' },
      'service_role',
    ));
    const result = await read(response);
    if (response.status !== 503 || result.error !== 'server_configuration_missing') {
      throw new Error(`expected 503 configuration missing, got ${response.status}`);
    }
    if (!logs.every(logsSafe)) throw new Error('missing-secret path leaked P8');
  } finally {
    console.log = originalLog;
  }
});

Deno.test('unbound service_role originalTransactionId stays 503 for later retry', async () => {
  const handler = createSyncHandler({
    env: (name) => envValues[name],
    now: () => 1_800_000_010_000,
    createAdmin: () => ({
      rpc: async () => ({ data: { ok: true }, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }),
  });
  const response = await handler(request(
    { originalTransactionId: ORIGINAL, environment: 'Sandbox' },
    'service_role',
  ));
  const result = await read(response);
  if (response.status !== 503 || result.error !== 'account_not_bound') {
    throw new Error(`expected unbound 503, got ${response.status} ${result.error}`);
  }
});

Deno.test('forged unsigned service_role JWT is rejected with 401', async () => {
  let appleCalls = 0;
  let applyCalls = 0;
  const handler = createSyncHandler({
    env: (name) => envValues[name],
    now: () => 1_800_000_010_000,
    fetchImpl: async () => {
      appleCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      };
    },
    createUser: () => ({
      auth: {
        getUser: async () => ({ data: { user: null }, error: new Error('invalid jwt') }),
      },
    }),
    createAdmin: () => ({
      rpc: async (name: string) => {
        if (name === 'apply_storekit_transaction') applyCalls += 1;
        return { data: { ok: true, durable: true }, error: null };
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { user_id: USER_ID, app_account_token: ACCOUNT_TOKEN, environment: 'Sandbox' },
                error: null,
              }),
            }),
            maybeSingle: async () => ({
              data: { user_id: USER_ID, app_account_token: ACCOUNT_TOKEN, environment: 'Sandbox' },
              error: null,
            }),
          }),
        }),
      }),
    }),
  });
  const response = await handler(request(
    { originalTransactionId: ORIGINAL, environment: 'Sandbox' },
    'forged_service',
  ));
  const result = await read(response);
  if (response.status !== 401 || result.error !== 'not_authenticated') {
    throw new Error(`expected 401 for forged service_role JWT, got ${response.status} ${result.error}`);
  }
  if (appleCalls !== 0 || applyCalls !== 0) {
    throw new Error('forged JWT must not call App Store Server API or apply_storekit_transaction');
  }
});
