import { createNotificationHandler, lifecycleStatus } from './index.ts';

const ACCOUNT_TOKEN = '11111111-1111-1111-1111-111111111111';
const TRANSACTION_ID = '100000000000001';

const envValues: Record<string, string> = {
  APPLE_BUNDLE_ID: 'app.hither.mobile',
  APPLE_STORE_ENVIRONMENT: 'Sandbox',
  PREMIUM_PRODUCT_IDS: 'app.hither.premium.monthly,app.hither.premium.annual',
  PREMIUM_SUBSCRIPTION_GROUP_ID: 'hither-premium',
  APPLE_ROOT_CERT_SHA256: 'test-root',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
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

const outerPayload = {
  notificationUUID: 'notification-1',
  notificationType: 'SUBSCRIBED',
  signedDate: 1_800_000_002_000,
  data: {
    environment: 'Sandbox',
    signedTransactionInfo: 'transaction-jws',
  },
};

function request(): Request {
  return new Request('https://example.test/apple-server-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedPayload: 'outer-jws' }),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function testHandler(mode: 'apply-fails' | 'retry' | 'accepted' | 'accept-fails' | 'mismatch') {
  const rpcCalls: string[] = [];
  const admin = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      if (name === 'record_storekit_notification') {
        if (mode === 'mismatch') return { data: { ok: false, error: 'notification_payload_mismatch' }, error: null };
        return {
          data: {
            ok: true,
            duplicate: mode !== 'apply-fails',
            accepted: mode === 'accepted',
          },
          error: null,
        };
      }
      if (name === 'apply_storekit_transaction') {
        if (mode === 'apply-fails') return { data: null, error: new Error('temporary') };
        return { data: { ok: true, durable: true, duplicate: true }, error: null };
      }
      if (name === 'accept_storekit_notification') {
        if (mode === 'accept-fails') return { data: null, error: new Error('temporary') };
        return { data: { ok: true, accepted: true }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { user_id: 'user-1' }, error: null }),
        }),
      }),
    }),
  };

  const handler = createNotificationHandler({
    env: (name) => envValues[name],
    now: () => 1_800_000_010_000,
    verifyJws: (compactJws) => Promise.resolve({
      ok: true as const,
      header: { alg: 'ES256' },
      payload: (compactJws === 'outer-jws' ? outerPayload : transactionPayload) as never,
      jwsSha256: `hash-${compactJws}`,
    }),
    createAdmin: () => admin as never,
  });
  return { handler, rpcCalls };
}

Deno.test('notification apply failure leaves the ledger retryable', async () => {
  const { handler, rpcCalls } = testHandler('apply-fails');
  const response = await handler(request());
  const result = await body(response);
  if (response.status !== 503 || result.error !== 'transaction_persistence_failed') {
    throw new Error(`expected retryable apply failure, got ${response.status}`);
  }
  if (rpcCalls.includes('accept_storekit_notification')) {
    throw new Error('accepted a notification before durable apply');
  }
});

Deno.test('an unaccepted duplicate re-applies durably before acceptance', async () => {
  const { handler, rpcCalls } = testHandler('retry');
  const response = await handler(request());
  const result = await body(response);
  if (response.status !== 200 || result.accepted !== true) {
    throw new Error(`expected accepted retry, got ${response.status}`);
  }
  const applyIndex = rpcCalls.indexOf('apply_storekit_transaction');
  const acceptIndex = rpcCalls.indexOf('accept_storekit_notification');
  if (applyIndex < 0 || acceptIndex <= applyIndex) throw new Error('acceptance order was not durable-first');
});

Deno.test('an accepted duplicate does not apply a second grant', async () => {
  const { handler, rpcCalls } = testHandler('accepted');
  const response = await handler(request());
  const result = await body(response);
  if (response.status !== 200 || result.accepted !== true) throw new Error('accepted replay was not acknowledged');
  if (rpcCalls.includes('apply_storekit_transaction')) throw new Error('replayed a durable grant');
});

Deno.test('immutable notification payload mismatch fails closed', async () => {
  const { handler, rpcCalls } = testHandler('mismatch');
  const response = await handler(request());
  const result = await body(response);
  if (response.status !== 422 || result.error !== 'notification_payload_mismatch') {
    throw new Error('payload mismatch was not rejected');
  }
  if (rpcCalls.includes('apply_storekit_transaction')) throw new Error('mismatch reached transaction apply');
});

Deno.test('durable apply followed by acceptance failure remains retryable', async () => {
  const { handler, rpcCalls } = testHandler('accept-fails');
  const response = await handler(request());
  const result = await body(response);
  if (response.status !== 503 || result.error !== 'notification_acceptance_failed') {
    throw new Error('acceptance failure was not retryable');
  }
  if (!rpcCalls.includes('apply_storekit_transaction')) throw new Error('durable apply was skipped');
});

Deno.test('ASN V2 maps retry, grace, expire, refund and auto-renew off', () => {
  if (lifecycleStatus('DID_FAIL_TO_RENEW', 'active') !== 'billing_retry') {
    throw new Error('DID_FAIL_TO_RENEW should store billing_retry');
  }
  if (lifecycleStatus('GRACE_PERIOD', 'active') !== 'grace_period') {
    throw new Error('GRACE_PERIOD should store grace_period');
  }
  if (lifecycleStatus('EXPIRED', 'active') !== 'expired') {
    throw new Error('EXPIRED should store expired');
  }
  if (lifecycleStatus('REFUND', 'active') !== 'refunded') {
    throw new Error('REFUND should close immediately');
  }
  if (lifecycleStatus('REVOKE', 'active') !== 'revoked') {
    throw new Error('REVOKE should close immediately');
  }
  if (lifecycleStatus('DID_CHANGE_RENEWAL_STATUS', 'active') !== 'active') {
    throw new Error('auto-renew OFF stays entitled until expiry');
  }
  if (lifecycleStatus('UNKNOWN_TYPE', 'expired') !== 'expired') {
    throw new Error('unknown types must stay transaction-derived');
  }
});

Deno.test('unbound appAccountToken returns 503 without accepting', async () => {
  const rpcCalls: string[] = [];
  const handler = createNotificationHandler({
    env: (name) => envValues[name],
    now: () => 1_800_000_010_000,
    verifyJws: (compactJws) => Promise.resolve({
      ok: true as const,
      header: { alg: 'ES256' },
      payload: (compactJws === 'outer-jws' ? outerPayload : transactionPayload) as never,
      jwsSha256: `hash-${compactJws}`,
    }),
    createAdmin: () => ({
      rpc: async (name: string) => {
        rpcCalls.push(name);
        if (name === 'record_storekit_notification') {
          return { data: { ok: true, duplicate: false, accepted: false }, error: null };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }) as never,
  });
  const response = await handler(request());
  const result = await body(response);
  if (response.status !== 503 || result.error !== 'account_not_bound') {
    throw new Error(`expected unbound 503, got ${response.status} ${result.error}`);
  }
  if (rpcCalls.includes('accept_storekit_notification')) {
    throw new Error('unbound token marked the notification accepted');
  }
});

Deno.test('Production notifications verify on a Sandbox-configured deployed function', async () => {
  const productionOuter = {
    ...outerPayload,
    data: { ...outerPayload.data, environment: 'Production' },
  };
  const productionTxn = { ...transactionPayload, environment: 'Production' };
  const handler = createNotificationHandler({
    env: (name) => envValues[name],
    now: () => 1_800_000_010_000,
    verifyJws: (compactJws) => Promise.resolve({
      ok: true as const,
      header: { alg: 'ES256' },
      payload: (compactJws === 'outer-jws' ? productionOuter : productionTxn) as never,
      jwsSha256: `hash-${compactJws}`,
    }),
    createAdmin: () => ({
      rpc: async (name: string) => {
        if (name === 'record_storekit_notification') {
          return { data: { ok: true, duplicate: false, accepted: false }, error: null };
        }
        if (name === 'apply_storekit_transaction') {
          return { data: { ok: true, durable: true, duplicate: false }, error: null };
        }
        if (name === 'accept_storekit_notification') {
          return { data: { ok: true, accepted: true }, error: null };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { user_id: 'user-1' }, error: null }),
          }),
        }),
      }),
    }) as never,
  });
  const response = await handler(request());
  if (response.status !== 200) {
    throw new Error(`dual-env notification rejected: ${response.status}`);
  }
});
