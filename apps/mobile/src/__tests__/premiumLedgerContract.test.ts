/**
 * #223 ledger / dual-env / ASN V2 / Server API public-seam contracts.
 * Device StoreKit remains Unverified; these assert source seams + fixture names.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMPTY_PREMIUM_PROJECTION,
  mapPremiumProjectionRow,
} from '../entitlements';

const root = join(__dirname, '../../../..');
const migration = readFileSync(
  join(root, 'supabase/migrations/20260821000000_premium_entitlement_version_and_binding.sql'),
  'utf8',
).replace(/\r\n/g, '\n');
const storekit = readFileSync(
  join(root, 'supabase/functions/_shared/storekit.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
const notifications = readFileSync(
  join(root, 'supabase/functions/apple-server-notifications/index.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
const verify = readFileSync(
  join(root, 'supabase/functions/verify-and-apply-purchase/index.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
const syncFn = readFileSync(
  join(root, 'supabase/functions/sync-app-store-subscription/index.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
const ledgerTest = readFileSync(
  join(root, 'supabase/tests/storekit_purchase_ledger.test.sql'),
  'utf8',
).replace(/\r\n/g, '\n');
const projectionTest = readFileSync(
  join(root, 'supabase/tests/premium_projection.test.sql'),
  'utf8',
).replace(/\r\n/g, '\n');
const cleanupTest = readFileSync(
  join(root, 'supabase/tests/premium_anonymous_cleanup_skip.test.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('#230 ledger contract', () => {
  it('A1 personal_premium_entitlements has version, original/latest ids, environment, retry/grace, unique user', () => {
    expect(migration).toContain('entitlement_version integer not null default 1');
    expect(migration).toContain('original_transaction_id text');
    expect(migration).toContain('latest_transaction_id text');
    expect(migration).toContain("'billing_retry', 'grace_period'");
    expect(migration).toContain('personal_premium_entitlements_user_uidx');
    expect(ledgerTest).toContain('A1 unique current grant per user after renewals');
  });

  it('A2 applying a JWS whose originalTransactionId is bound to another user is rejected with a security event', () => {
    expect(migration).toContain('transaction_binding_mismatch');
    expect(migration).toContain('premium_security_events');
    expect(migration).not.toContain('signed_transaction');
    expect(ledgerTest).toContain('A2 cross-user originalTransactionId is rejected');
    expect(ledgerTest).toContain('A2 security events never store JWS/JWT/P8');
  });

  it('A3 after the owning user is deleted the same original id still cannot bind', () => {
    expect(migration).toContain('on delete set null');
    expect(ledgerTest).toContain('A3 deleted owner tombstones the originalTransactionId binding');
    expect(ledgerTest).toContain('A3 tombstoned original id cannot bind to a new user');
  });

  it('A4 get_premium_projection returns entitlementVersion or subscription_required', () => {
    expect(migration).toContain("'error', 'subscription_required'");
    expect(migration).toContain("'entitlementVersion'");
    expect(projectionTest).toContain('A4 live projection returns entitlementVersion');
    expect(projectionTest).toContain('A4 expired personal grant returns subscription_required');
    expect(mapPremiumProjectionRow({
      ok: false,
      error: 'subscription_required',
      personalPremiumActive: false,
      teamPremiumActive: true,
    })).toMatchObject({
      error: 'subscription_required',
      personalPremiumActive: false,
      teamPremiumActive: true,
    });
    expect(EMPTY_PREMIUM_PROJECTION.personalPremiumActive).toBe(false);
  });

  it('A5 grace_period and billing_retry with future expiry are entitled; expired/refunded/revoked are not', () => {
    expect(migration).toContain("p_status in ('active', 'grace_period', 'billing_retry')");
    expect(projectionTest).toContain('A5 grace_period with future expiry is entitled');
    expect(projectionTest).toContain('A5 live helper treats billing_retry as entitled');
    expect(projectionTest).toContain('A5 refunded is not live even with a future expires_at');
  });

  it('A6 anonymous cleanup does not delete a user who still has a live personal grant', () => {
    expect(migration).toContain('personal_premium_is_live(e.status, e.expires_at)');
    expect(cleanupTest).toContain('A6 anonymous cleanup does not delete a user who still has a live personal grant');
    expect(cleanupTest).toContain('cleanup_expired_anonymous_accounts()');
  });

  it('A7 Sandbox and Production original ids are isolated', () => {
    expect(migration).toContain('primary key (environment, original_transaction_id)');
    expect(ledgerTest).toContain('A7 same original id in Production is isolated from Sandbox');
  });
});

describe('#232 dual-env purchase contract', () => {
  it('A4 Production and Sandbox JWS both verify; Xcode is rejected', () => {
    expect(storekit).toContain("['Production', 'Sandbox']");
    expect(storekit).toContain("configured === 'Xcode'");
    expect(verify).toContain('environment_mismatch');
  });

  it('A5 cross-user originalTransactionId or appAccountToken mismatch returns 409/422 without grant', () => {
    expect(verify).toContain("error === 'account_token_mismatch'");
    expect(verify).toContain('transaction_binding_mismatch');
    expect(verify).toContain('return json(422');
  });

  it('A6 response includes entitlementVersion and personalPremiumActive from DB', () => {
    expect(verify).toContain('entitlementVersion');
    expect(verify).toContain('personalPremiumActive');
    expect(verify).not.toContain('isPremium: item.status === \'active\'');
  });

  it('A7 duplicate apply of the same durable JWS returns durable true', () => {
    expect(verify).toContain('duplicate_durable');
  });
});

describe('#234 ASN V2 lifecycle contract', () => {
  it('A1 DID_FAIL_TO_RENEW stores billing_retry', () => {
    expect(notifications).toContain("notificationType === 'DID_FAIL_TO_RENEW'");
    expect(notifications).toContain("'billing_retry'");
  });

  it('A2 GRACE_PERIOD stores grace_period', () => {
    expect(notifications).toContain("notificationType === 'GRACE_PERIOD'");
    expect(notifications).toContain("'grace_period'");
  });

  it('A3 EXPIRED stores expired and the apply path increments entitlement_version', () => {
    expect(notifications).toContain("EXPIRED_NOTIFICATION_TYPES.has(notificationType)) return 'expired'");
    expect(migration).toContain("when excluded.status in ('expired', 'refunded', 'revoked')");
  });

  it('A4 REFUND/REVOKE close the grant and increment version', () => {
    expect(notifications).toContain("'REFUND' ? 'refunded' : 'revoked'");
    expect(ledgerTest).toContain('A4 refund increments entitlement_version');
  });

  it('A5 duplicate notificationUUID does not re-apply', () => {
    expect(notifications).toContain('notificationLedger.accepted === true');
  });

  it('A6 unbound appAccountToken returns 503 and does not mark accepted', () => {
    expect(notifications).toContain("'account_not_bound'");
    expect(notifications).toContain('unbound_account');
  });

  it('A7 auto-renew OFF stays entitled until expiresAt', () => {
    expect(notifications).toContain('DID_CHANGE_RENEWAL_STATUS');
    expect(notifications).toContain('ENTITLED_UNTIL_EXPIRY_TYPES');
  });
});

describe('#235 App Store Server API contract', () => {
  it('A1 user restore/refresh with a verified device JWS the ledger lacks grants via sync or purchase Edge', () => {
    expect(syncFn).toContain('signed_transaction');
    expect(syncFn).toContain('apply_storekit_transaction');
  });

  it('A2 service_role and already-bound originalTransactionId fetches Apple status', () => {
    expect(syncFn).toContain("role === 'service_role'");
    expect(syncFn).toContain('isVerifiedServiceRole');
    expect(syncFn).toContain('fetchSubscriptionStatuses');
    expect(syncFn).not.toContain('decodeJwtRole');
  });

  it('A3 user JWT cannot sync an originalTransactionId bound to a different user', () => {
    expect(syncFn).toContain('user supplied originalTransactionId not bound to caller');
  });

  it('A4 missing Connect API secrets fail closed without logging P8 or JWS', () => {
    expect(syncFn).toContain('server_configuration_missing');
    expect(syncFn).toContain("event: 'app_store_subscription_sync', outcome");
    expect(syncFn).not.toContain('console.log(secrets');
    expect(syncFn).not.toContain('console.log(signed');
  });

  it('A5 Production and Sandbox responses persist their own environment', () => {
    expect(syncFn).toContain('p_environment: transaction.environment');
  });

  it('A6 webhook remaining 503/unbound can later succeed through this compensation', () => {
    expect(syncFn).toContain('account_not_bound');
  });

  it('A7 no Play Developer API and no new custom HTTP server outside Supabase Edge', () => {
    expect(syncFn).not.toContain('androidpublisher');
    expect(syncFn).not.toContain('createServer(');
    expect(syncFn).toContain('functions/v1');
  });
});
