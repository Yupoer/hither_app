/**
 * OTA-08 entitlement contract tests: Free Plan limits, Small Trip Pass
 * boundaries, and client mapping of server results. Reuses service/RPC
 * mock patterns from client.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FREE_LIMITS,
  SMALL_TRIP_PASS,
  isEntitlementActive,
  isLifetimeProfilePremium,
  effectiveIsPro,
  isSmallTripEligible,
  isWithinFreeMemberLimit,
  wouldExceedMemberLimit,
  isWithinFreeDestinationLimit,
  wouldExceedDestinationLimit,
  normalizeEntitlementError,
  mapTripEntitlementRow,
} from '../entitlements';
import {
  getTripEntitlement,
  applyVerifiedPurchase,
  restoreEntitlements,
  redeemPromoCode,
  setProStatus,
} from '../api/services/EntitlementService';
import { joinGroup } from '../api/services/GroupService';
import { addDestination } from '../api/services/DestinationService';
import { isVerifiedPurchase, purchasePro, restorePurchases } from '../native/purchases';
import { supabase } from '../api/supabase';

jest.mock('../api/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), auth: { getSession: jest.fn() } },
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'test-device-id') }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const mockedAuth = supabase.auth as unknown as { getSession: jest.Mock };
const mockedFrom = supabase.from as unknown as jest.Mock;
const mockedRpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Reset Edge Function stub so RPC-only tests are not polluted.
  delete (supabase as { functions?: unknown }).functions;
  mockedAuth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'uid' } } },
    error: null,
  });
});

const migration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260725000100_paid_entitlement.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');

describe('FREE_LIMITS / Small Trip Pass constants', () => {
  it('Free Plan includes Leader in the 5-person total', () => {
    expect(FREE_LIMITS.groupMembers).toBe(5);
    expect(FREE_LIMITS.destinationsPerItinerary).toBe(5);
  });

  it('Small Trip Pass is 2–5 people, 7 days, trip-scoped product', () => {
    expect(SMALL_TRIP_PASS.minMembers).toBe(2);
    expect(SMALL_TRIP_PASS.maxMembers).toBe(5);
    expect(SMALL_TRIP_PASS.durationDays).toBe(7);
    expect(SMALL_TRIP_PASS.planCode).toBe('small_trip_pass');
  });
});

describe('member-count boundaries (Leader included)', () => {
  it.each([
    [4, true, false],
    [5, true, true],
    [6, false, true],
  ])(
    'total=%i → withinFree=%s wouldExceedOnJoin=%s',
    (total, within, wouldExceed) => {
      expect(isWithinFreeMemberLimit(total)).toBe(within);
      expect(wouldExceedMemberLimit(total)).toBe(wouldExceed);
    },
  );
});

describe('itinerary-point boundaries', () => {
  it.each([
    [5, true, true],
    [6, false, true],
    [4, true, false],
  ])(
    'points=%i → withinFree=%s wouldExceedOnAdd=%s',
    (points, within, wouldExceed) => {
      expect(isWithinFreeDestinationLimit(points)).toBe(within);
      expect(wouldExceedDestinationLimit(points)).toBe(wouldExceed);
    },
  );
});

describe('isEntitlementActive (cache must not grant when server says no)', () => {
  it('grants when server isPremium is true', () => {
    expect(
      isEntitlementActive({
        isPremium: true,
        status: 'active',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).toBe(true);
  });

  it.each(['expired', 'revoked', 'refunded', 'invalid', 'none'] as const)(
    'denies status=%s when isPremium is false',
    (status) => {
      expect(
        isEntitlementActive({
          isPremium: false,
          status,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ).toBe(false);
    },
  );

  it('trusts server isPremium even when status is none/expired (leader lifetime)', () => {
    // get_trip_entitlement may return is_premium true with a historical row status.
    expect(
      isEntitlementActive({
        isPremium: true,
        status: 'none',
        expiresAt: null,
      }),
    ).toBe(true);
    expect(
      isEntitlementActive({
        isPremium: true,
        status: 'expired',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).toBe(true);
  });
});

describe('lifetime vs trip-scoped profile denorm (no cross-trip leak)', () => {
  it('only null-expiry profiles.pro counts as lifetime', () => {
    expect(isLifetimeProfilePremium(true, null)).toBe(true);
    expect(isLifetimeProfilePremium(true, undefined)).toBe(true);
    expect(isLifetimeProfilePremium(true, '')).toBe(true);
    expect(isLifetimeProfilePremium(true, '2026-08-01T00:00:00Z')).toBe(false);
    expect(isLifetimeProfilePremium(false, null)).toBe(false);
  });

  it('effectiveIsPro prefers trip snapshot over expiring profile denorm', () => {
    const tripActive = mapTripEntitlementRow({
      ok: true,
      is_premium: true,
      status: 'active',
      plan_code: 'small_trip_pass',
      expires_at: '2026-08-01T00:00:00Z',
    });
    expect(
      effectiveIsPro({
        trip: tripActive,
        profilePro: false,
        proExpiresAt: null,
        nowMs: Date.parse('2026-07-26T00:00:00Z'),
      }),
    ).toBe(true);

    const tripNone = mapTripEntitlementRow({
      ok: true,
      is_premium: false,
      status: 'none',
      plan_code: 'free',
    });
    // Expiring denorm must NOT light Premium on another trip.
    expect(
      effectiveIsPro({
        trip: tripNone,
        profilePro: true,
        proExpiresAt: '2026-08-01T00:00:00Z',
        nowMs: Date.parse('2026-07-26T00:00:00Z'),
      }),
    ).toBe(false);

    // Server is_premium false + expired status → Free (even if profile denorm is set).
    const tripExpired = mapTripEntitlementRow({
      ok: true,
      is_premium: false,
      status: 'expired',
      plan_code: 'small_trip_pass',
      expires_at: '2026-07-01T00:00:00Z',
    });
    expect(
      effectiveIsPro({
        trip: tripExpired,
        profilePro: true,
        proExpiresAt: '2026-08-01T00:00:00Z',
      }),
    ).toBe(false);
  });

  it('effectiveIsPro trusts is_premium true with status none|expired (leader lifetime)', () => {
    expect(
      effectiveIsPro({
        trip: mapTripEntitlementRow({
          ok: true,
          is_premium: true,
          status: 'none',
          plan_code: 'lifetime_premium',
        }),
        profilePro: false,
        proExpiresAt: null,
      }),
    ).toBe(true);
    expect(
      effectiveIsPro({
        trip: mapTripEntitlementRow({
          ok: true,
          is_premium: true,
          status: 'expired',
          plan_code: 'small_trip_pass',
          expires_at: '2026-07-01T00:00:00Z',
        }),
        profilePro: false,
        proExpiresAt: null,
      }),
    ).toBe(true);
  });

  it('without trip, only lifetime grants isPro', () => {
    expect(
      effectiveIsPro({ trip: null, profilePro: true, proExpiresAt: null }),
    ).toBe(true);
    expect(
      effectiveIsPro({
        trip: null,
        profilePro: true,
        proExpiresAt: '2026-08-01T00:00:00Z',
      }),
    ).toBe(false);
  });
});

describe('Small Trip eligibility is 2–5 members', () => {
  it.each([
    [1, false, false],
    [2, false, true],
    [5, false, true],
    [6, false, false],
    [3, true, false],
  ])('members=%i alreadyPremium=%s → eligible=%s', (n, premium, eligible) => {
    expect(isSmallTripEligible(n, premium)).toBe(eligible);
  });
});

describe('normalizeEntitlementError', () => {
  it.each([
    ['expired', 'expired'],
    ['Promo code has expired', 'expired'],
    ['revoked', 'revoked'],
    ['refunded', 'refunded'],
    ['invalid', 'invalid'],
    ['Invalid promo code', 'invalid'],
    ['duplicate', 'duplicate'],
    ['already_used', 'already_used'],
    ['not_applicable', 'not_applicable'],
    ['member_limit', 'member_limit'],
    ['itinerary_point_limit', 'itinerary_point_limit'],
    ['P0004', 'itinerary_point_limit'],
  ])('maps %s → %s', (raw, expected) => {
    expect(normalizeEntitlementError(raw)).toBe(expected);
  });

  it('does not map bare "itinerary" to point limit', () => {
    expect(normalizeEntitlementError('failed to load itinerary')).toBe('unknown');
  });
});

describe('mapTripEntitlementRow', () => {
  it('maps server free snapshot', () => {
    const ent = mapTripEntitlementRow({
      ok: true,
      is_premium: false,
      status: 'none',
      plan_code: 'free',
      member_count: 3,
      member_limit: 5,
      destination_limit: 5,
      trip_applicable: true,
      small_trip_eligible: true,
    });
    expect(ent.isPremium).toBe(false);
    expect(ent.memberLimit).toBe(5);
    expect(ent.smallTripEligible).toBe(true);
  });

  it('maps active small trip pass', () => {
    const ent = mapTripEntitlementRow({
      ok: true,
      is_premium: true,
      status: 'active',
      plan_code: 'small_trip_pass',
      started_at: '2026-07-25T00:00:00Z',
      expires_at: '2026-08-01T00:00:00Z',
      destination_limit: null,
    });
    expect(ent.isPremium).toBe(true);
    expect(ent.destinationLimit).toBeNull();
    expect(isEntitlementActive(ent, Date.parse('2026-07-26T00:00:00Z'))).toBe(true);
  });
});

describe('EntitlementService RPCs', () => {
  it('getTripEntitlement maps server payload', async () => {
    mockedRpc.mockResolvedValue({
      data: {
        ok: true,
        is_premium: true,
        status: 'active',
        plan_code: 'small_trip_pass',
        expires_at: '2026-08-01T00:00:00Z',
        member_count: 4,
        member_limit: 5,
      },
      error: null,
    });
    const ent = await getTripEntitlement('g1');
    expect(mockedRpc).toHaveBeenCalledWith('get_trip_entitlement', { p_group_id: 'g1' });
    expect(ent.isPremium).toBe(true);
    expect(ent.planCode).toBe('small_trip_pass');
  });

  it('applyVerifiedPurchase returns distinguishable duplicate', async () => {
    mockedRpc.mockResolvedValue({
      data: { ok: false, error: 'duplicate', status: 'active', entitlement_id: 'e1' },
      error: null,
    });
    const result = await applyVerifiedPurchase({
      groupId: 'g1',
      transactionId: 'txn-1',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('duplicate');
  });

  it('applyVerifiedPurchase succeeds for verified outcome (service verifier mock)', async () => {
    mockedRpc.mockResolvedValue({
      data: {
        ok: true,
        status: 'active',
        plan_code: 'small_trip_pass',
        entitlement_id: 'e1',
        started_at: '2026-07-25T00:00:00Z',
        expires_at: '2026-08-01T00:00:00Z',
        is_premium: true,
      },
      error: null,
    });
    const result = await applyVerifiedPurchase({
      groupId: 'g1',
      transactionId: 'txn-ok',
      productId: 'small_trip_pass',
    });
    expect(result.ok).toBe(true);
    expect(result.isPremium).toBe(true);
    expect(mockedRpc).toHaveBeenCalledWith('apply_verified_purchase', {
      p_group_id: 'g1',
      p_transaction_id: 'txn-ok',
      p_product_id: 'small_trip_pass',
    });
  });

  it('applyVerifiedPurchase does not unlock when RPC is forbidden to authenticated', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for function apply_verified_purchase' },
    });
    const result = await applyVerifiedPurchase({
      groupId: 'g1',
      transactionId: 'fake-txn',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('verification_service_required');
  });

  it('maps Edge Function JSON body even when invoke reports error (non-2xx)', async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: { ok: false, error: 'duplicate', status: 'active', entitlement_id: 'e1' },
      error: { message: 'Edge Function returned a non-2xx status code' },
    });
    (supabase as unknown as { functions?: { invoke: jest.Mock } }).functions = { invoke };

    const result = await applyVerifiedPurchase({
      groupId: 'g1',
      transactionId: 'txn-dup',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('duplicate');
    // Must not fall through to user-JWT RPC (would misreport as verification_service_required).
    expect(mockedRpc).not.toHaveBeenCalled();
  });

  it('falls through to RPC only when Edge Function returns no body', async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'Failed to send a request to the Edge Function' },
    });
    (supabase as unknown as { functions?: { invoke: jest.Mock } }).functions = { invoke };
    mockedRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for function apply_verified_purchase' },
    });

    const result = await applyVerifiedPurchase({
      groupId: 'g1',
      transactionId: 'txn-missing-fn',
    });
    expect(mockedRpc).toHaveBeenCalled();
    expect(result.error).toBe('verification_service_required');
  });

  it('restoreEntitlements returns server-valid premium', async () => {
    mockedRpc.mockResolvedValue({
      data: {
        ok: true,
        is_premium: true,
        user_pro: true,
        plan_code: 'lifetime_premium',
        expires_at: null,
        trip: null,
      },
      error: null,
    });
    const restored = await restoreEntitlements('g1');
    expect(restored.isPremium).toBe(true);
    expect(restored.userPro).toBe(true);
    expect(mockedRpc).toHaveBeenCalledWith('restore_entitlements', { p_group_id: 'g1' });
  });

  it('redeemPromoCode maps already_used / expired / invalid', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: { success: false, error: 'already_used', code: 'already_used' },
      error: null,
    });
    await expect(redeemPromoCode('USED')).rejects.toMatchObject({ code: 'already_used' });

    mockedRpc.mockResolvedValueOnce({
      data: { success: false, error: 'expired', code: 'expired' },
      error: null,
    });
    await expect(redeemPromoCode('OLD')).rejects.toMatchObject({ code: 'expired' });

    mockedRpc.mockResolvedValueOnce({
      data: { success: false, error: 'invalid', code: 'invalid' },
      error: null,
    });
    await expect(redeemPromoCode('NOPE')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('redeemPromoCode success writes same entitlement model (no Early Access state)', async () => {
    mockedRpc.mockResolvedValue({
      data: {
        success: true,
        plan_name: 'Lifetime Premium',
        plan_code: 'lifetime_premium',
        status: 'active',
        expires_at: null,
      },
      error: null,
    });
    const result = await redeemPromoCode('PROMO2026', 'g1');
    expect(result.plan_name).toBe('Lifetime Premium');
    expect(result.plan_code).toBe('lifetime_premium');
    expect(mockedRpc).toHaveBeenCalledWith('redeem_promo_code', {
      p_code: 'PROMO2026',
      p_group_id: 'g1',
    });
  });

  it('setProStatus refuses direct client Pro writes', async () => {
    await expect(setProStatus('uid')).rejects.toThrow(/entitlement_write_forbidden/);
  });
});

describe('joinGroup member_limit', () => {
  it('surfaces server member_limit when 6th person joins', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0003', message: 'member_limit' },
    });
    await expect(joinGroup('ABC234')).rejects.toMatchObject({ code: 'member_limit' });
  });
});

describe('addDestination itinerary_point_limit', () => {
  it('surfaces server itinerary_point_limit at 6th free point', async () => {
    // Existing 5 rows → insert blocked by server (we simulate the error).
    const existing = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`,
      position: i,
      day: 1,
    }));
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: self,
      eq: self,
      is: self,
      order: jest.fn().mockResolvedValue({ data: existing, error: null }),
      insert: jest.fn().mockResolvedValue({
        error: { code: 'P0004', message: 'itinerary_point_limit' },
      }),
      update: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }),
    });
    mockedFrom.mockReturnValue(chain);

    await expect(
      addDestination('g1', {
        title: '6th',
        coordinates: { latitude: 0, longitude: 0 },
      }),
    ).rejects.toMatchObject({ code: 'itinerary_point_limit' });
  });
});

describe('native purchases stub (BUILD-02 boundary)', () => {
  it('does not unlock premium without verified outcome', async () => {
    const purchased = await purchasePro();
    const restored = await restorePurchases();
    expect(purchased.status).toBe('unavailable');
    expect(restored.status).toBe('unavailable');
    expect(isVerifiedPurchase(purchased)).toBe(false);
    expect(isVerifiedPurchase(restored)).toBe(false);
  });
});

describe('paid entitlement migration contract', () => {
  it('creates trip_entitlements and promo_redemptions with RLS', () => {
    expect(migration).toContain('create table if not exists public.trip_entitlements');
    expect(migration).toContain('create table if not exists public.promo_redemptions');
    expect(migration).toContain('enable row level security');
  });

  it('enforces Free Plan member and itinerary limits on the server', () => {
    expect(migration).toContain("raise exception 'member_limit'");
    expect(migration).toContain("errcode = 'P0003'");
    expect(migration).toContain("raise exception 'itinerary_point_limit'");
    expect(migration).toContain("errcode = 'P0004'");
    expect(migration).toContain('v_count >= 5');
  });

  it('preserves OTA-05 anonymous expiry and leader registration gates in join_group', () => {
    expect(migration).toContain("errcode = 'P0401'");
    expect(migration).toContain("errcode = 'P0406'");
    expect(migration).toContain('ensure_anonymous_expiry');
    expect(migration).toContain('is_auth_user_anonymous');
  });

  it('binds Small Trip Pass to a trip for 7 days', () => {
    expect(migration).toContain("'small_trip_pass'");
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain('trip_entitlements_one_active_pass_per_group');
  });

  it('keeps Small Trip Pass trip-scoped (no profiles.pro fallback for expiring denorm)', () => {
    expect(migration).toContain('profile_has_lifetime_premium');
    expect(migration).toContain('p.pro_expires_at is null');
    // Purchase/promo small-trip paths must not write profiles.pro.
    expect(migration).toContain('Do NOT write profiles.pro for trip-scoped passes');
    expect(migration).toContain('Trip-scoped only: do not write profiles.pro');
    // group_has_active_premium uses lifetime helper, not bare pro=true.
    expect(migration).toContain('return public.profile_has_lifetime_premium(v_leader)');
  });

  it('aligns get_trip_entitlement status with is_premium when group is premium', () => {
    expect(migration).toContain("case when v_effective then 'active' else 'none' end");
    expect(migration).toContain('when v_effective then \'active\'');
    expect(migration).toContain('leader_lifetime');
  });

  it('requires 2–5 members for Small Trip Pass grant', () => {
    expect(migration).toContain('v_count < 2 or v_count > 5');
    expect(migration).toContain('v_member_count between 2 and 5');
  });

  it('serializes join and itinerary inserts with FOR UPDATE', () => {
    expect(migration).toMatch(/perform 1 from public\.groups where id = g\.id for update/i);
    expect(migration).toMatch(/perform 1 from public\.groups where id = new\.group_id for update/i);
  });

  it('marks mutating helpers VOLATILE and pure premium check without STABLE side effects', () => {
    expect(migration).toMatch(
      /create or replace function public\.group_has_active_premium[\s\S]*?\nvolatile/i,
    );
    expect(migration).toMatch(
      /create or replace function public\.expire_stale_entitlements[\s\S]*?\nvolatile/i,
    );
    // group_has_active_premium must not call expire_stale (no side effects in read path).
    const premiumFn = migration.slice(
      migration.indexOf('create or replace function public.group_has_active_premium'),
      migration.indexOf('create or replace function public.group_member_count'),
    );
    expect(premiumFn).not.toContain('expire_stale_entitlements');
  });

  it('gates apply_verified_purchase to service_role only', () => {
    expect(migration).toContain(
      'revoke all on function public.apply_verified_purchase(uuid, text, text) from public, anon, authenticated',
    );
    expect(migration).toContain(
      'grant execute on function public.apply_verified_purchase(uuid, text, text) to service_role',
    );
  });

  it('revokes global expiry sweep from authenticated clients', () => {
    expect(migration).toContain(
      'revoke all on function public.expire_stale_entitlements(uuid) from public, anon, authenticated',
    );
  });

  it('validates product_id allow-list', () => {
    expect(migration).toContain("when 'small_trip_pass' then 'small_trip_pass'");
    expect(migration).toContain('unknown product_id');
  });

  it('defines apply_verified_purchase only once', () => {
    const matches = migration.match(/create or replace function public\.apply_verified_purchase/g);
    expect(matches).toHaveLength(1);
  });

  it('exposes distinguishable RPCs for purchase, restore, redeem, revoke', () => {
    for (const rpc of [
      'get_trip_entitlement',
      'apply_verified_purchase',
      'restore_entitlements',
      'revoke_trip_entitlement',
      'redeem_promo_code',
    ]) {
      expect(migration).toContain(`create or replace function public.${rpc}`);
    }
    expect(migration).toContain('grant execute on function public.get_trip_entitlement(uuid) to authenticated');
    expect(migration).toContain('grant execute on function public.restore_entitlements(uuid) to authenticated');
    expect(migration).toContain('grant execute on function public.revoke_trip_entitlement(uuid, text) to authenticated');
    for (const code of ['expired', 'revoked', 'refunded', 'invalid', 'duplicate', 'already_used', 'not_applicable']) {
      expect(migration).toContain(`'${code}'`);
    }
  });

  it('revoke/refund path sets terminal statuses on trip_entitlements', () => {
    expect(migration).toContain("when p_reason = 'refunded' then 'refunded'");
    expect(migration).toContain("when p_reason = 'invalid' then 'invalid'");
    expect(migration).toContain("else 'revoked'");
  });

  it('blocks direct client profiles.pro self-grant', () => {
    expect(migration).toContain('prevent_client_pro_self_grant');
    expect(migration).toContain('entitlement_write_forbidden');
    expect(migration).toContain('allow_entitlement_profile_write');
  });
});

describe('Paywall contract (no direct Pro write)', () => {
  const paywall = readFileSync(
    join(__dirname, '../components/PaywallSheet.tsx'),
    'utf8',
  );

  it('consumes verified purchase outcomes and server restore only', () => {
    expect(paywall).toContain('applyVerifiedPurchase');
    expect(paywall).toContain('restoreEntitlements');
    expect(paywall).toContain('isVerifiedPurchase');
    expect(paywall).not.toContain('setProStatus(');
    expect(paywall).toContain('SMALL_TRIP_PASS');
    expect(paywall).toContain('FREE_LIMITS');
  });

  it('restore success uses server result, not stale isPro', () => {
    expect(paywall).toContain('restored.isPremium');
    expect(paywall).toContain('restored.userPro');
    expect(paywall).toContain('tripAfter?.isPremium');
    expect(paywall).not.toMatch(/restored\.isPremium\s*\|\|\s*isPro/);
  });
});

describe('Session hydrate contract (no profile-Pro trust for trip passes)', () => {
  const session = readFileSync(
    join(__dirname, '../state/SessionContext.tsx'),
    'utf8',
  );

  it('uses effectiveIsPro / trip.isPremium rather than bare profiles.pro', () => {
    expect(session).toContain('effectiveIsPro');
    expect(session).toContain('trip.isPremium');
    expect(session).not.toMatch(/setIsPro\(\!\!row\?\.pro\)/);
  });

  it('leaveGroup uses isLifetimeProfilePremium(user.pro, proExpiresAt)', () => {
    expect(session).toContain('isLifetimeProfilePremium');
    expect(session).toContain('user?.pro');
    expect(session).not.toMatch(/proPlan \|\| user\?\.proPurchasedAt/);
  });
});

describe('EntitlementService BUILD-02 purchase handoff', () => {
  const serviceSrc = readFileSync(
    join(__dirname, '../api/services/EntitlementService.ts'),
    'utf8',
  );

  it('documents Edge Function path and verification_service_required', () => {
    expect(serviceSrc).toContain('verify-and-apply-purchase');
    expect(serviceSrc).toContain('verification_service_required');
    expect(serviceSrc).toContain('service_role');
  });
});
