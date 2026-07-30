/**
 * Token store service + migration contracts (client never writes wallet/ledger).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createRewardSession,
  getStoreSnapshot,
  mapStoreSnapshot,
  redeemStoreProduct,
  updateRewardSessionStatus,
} from '../api/services/StoreService';
import {
  ADMOB_REWARDED_UNITS,
  STORE_SSV_CALLBACK_URL,
} from '../store/types';
import {
  FREE_LIMITS,
  countOpenDestinations,
  remainingDestinationSlots,
  shouldBlockNewDestination,
} from '../entitlements';
import { supabase } from '../api/supabase';

jest.mock('../api/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), auth: { getSession: jest.fn() } },
}));

const mockedAuth = supabase.auth as unknown as { getSession: jest.Mock };
const mockedRpc = supabase.rpc as unknown as jest.Mock;

const migrationsDir = join(__dirname, '../../../../supabase/migrations');
const storeMigration = readFileSync(
  join(migrationsDir, '20260730120000_rewarded_ads_token_store.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'uid' } } },
    error: null,
  });
});

describe('FREE_LIMITS restored', () => {
  it('caps open gathering points at 5', () => {
    expect(FREE_LIMITS.destinationsPerItinerary).toBe(5);
    expect(FREE_LIMITS.kmlImportPoints).toBe(5);
  });
});

describe('open destination pre-check helpers', () => {
  it('counts only unfinished points', () => {
    expect(
      countOpenDestinations([
        { closedAt: null },
        { closedAt: '2026-01-01' },
        {},
      ]),
    ).toBe(2);
  });

  it('allows add when open < 5, credits, or Pro', () => {
    expect(shouldBlockNewDestination({ isPro: false, openCount: 4 })).toBe(false);
    expect(shouldBlockNewDestination({ isPro: false, openCount: 5, extraCredits: 1 })).toBe(false);
    expect(shouldBlockNewDestination({ isPro: true, openCount: 50 })).toBe(false);
    expect(shouldBlockNewDestination({ isPro: false, openCount: 5, extraCredits: 0 })).toBe(true);
  });

  it('computes remaining slots with credits', () => {
    expect(remainingDestinationSlots({ isPro: false, openCount: 5, extraCredits: 3 })).toBe(3);
    expect(remainingDestinationSlots({ isPro: false, openCount: 3, extraCredits: 0 })).toBe(2);
  });
});

describe('store migration security', () => {
  it('creates wallet ledger sessions catalog credits user entitlements', () => {
    expect(storeMigration).toContain('create table if not exists public.token_wallets');
    expect(storeMigration).toContain('create table if not exists public.token_ledger');
    expect(storeMigration).toContain('create table if not exists public.reward_sessions');
    expect(storeMigration).toContain('create table if not exists public.store_product_catalog');
    expect(storeMigration).toContain('create table if not exists public.trip_extra_point_credits');
    expect(storeMigration).toContain('create table if not exists public.user_entitlements');
  });

  it('seeds six catalog products with fixed prices', () => {
    expect(storeMigration).toContain("'team_premium_1d'");
    expect(storeMigration).toContain("'team_premium_3d'");
    expect(storeMigration).toContain("'team_premium_7d'");
    expect(storeMigration).toContain("'team_extra_points_3'");
    expect(storeMigration).toContain("'team_extra_points_10'");
    expect(storeMigration).toContain("'personal_live_activity_lifetime'");
    expect(storeMigration).toMatch(/team_premium_1d[\s\S]*?5/);
    expect(storeMigration).toMatch(/team_premium_3d[\s\S]*?12/);
    expect(storeMigration).toMatch(/team_premium_7d[\s\S]*?25/);
    expect(storeMigration).toMatch(/team_extra_points_3[\s\S]*?4/);
    expect(storeMigration).toMatch(/team_extra_points_10[\s\S]*?12/);
    expect(storeMigration).toMatch(/personal_live_activity_lifetime[\s\S]*?10/);
  });

  it('blocks client writes via select-only policies and no insert policies', () => {
    expect(storeMigration).toContain('"token_wallets: select own"');
    expect(storeMigration).toContain('"token_ledger: select own"');
    expect(storeMigration).toContain('No client write policies');
    expect(storeMigration).not.toMatch(/token_wallets for insert/i);
    expect(storeMigration).not.toMatch(/token_ledger for insert/i);
  });

  it('uses opaque session ref and allow-listed ad units', () => {
    expect(storeMigration).toContain('ca-app-pub-8135109277557342/7899053731');
    expect(storeMigration).toContain('ca-app-pub-8135109277557342/7100977386');
    expect(storeMigration).toContain('hither_token');
    expect(storeMigration).toContain('reward_sessions_one_active_per_user');
    expect(storeMigration).toContain('create_reward_session');
    expect(storeMigration).toContain('credit_rewarded_ad_transaction');
    expect(storeMigration).toContain('grant execute on function public.credit_rewarded_ad_transaction');
    expect(storeMigration).toContain('to service_role');
  });

  it('restores open-point Free limit with credit consumption', () => {
    expect(storeMigration).toContain('closed_at is null');
    expect(storeMigration).toContain('trip_extra_point_credits');
    expect(storeMigration).toContain("raise exception 'itinerary_point_limit'");
    // Temporary unlimited override migration still exists historically but is superseded.
    const names = readdirSync(migrationsDir);
    expect(names.some((n) => n.includes('temporary_unlimited'))).toBe(true);
    expect(storeMigration).toContain('create or replace function public.enforce_itinerary_point_limit');
  });

  it('token day-pass source and stacking', () => {
    expect(storeMigration).toContain('token_redemption');
    expect(storeMigration).toContain('stacked');
    expect(storeMigration).toContain('redeem_store_product');
  });

  it('exposes update_reward_session_status for fail/verifying lifecycle', () => {
    expect(storeMigration).toContain('update_reward_session_status');
    expect(storeMigration).toContain("'failed'");
    expect(storeMigration).toContain("'verifying'");
  });

  it('treats active and verifying as unfinished for unique index, create, and expiry', () => {
    expect(storeMigration).toContain('reward_sessions_one_unfinished_per_user');
    expect(storeMigration).toMatch(
      /reward_sessions_one_unfinished_per_user[\s\S]*status in \('active', 'verifying'\)/,
    );
    expect(storeMigration).toMatch(
      /expire_stale_reward_sessions[\s\S]*status in \('active', 'verifying'\)/,
    );
    expect(storeMigration).toMatch(
      /create_reward_session[\s\S]*status in \('active', 'verifying'\)/,
    );
  });

  it('maps grants by fixed product codes not effect_json kinds alone', () => {
    expect(storeMigration).toContain("when 'team_premium_1d'");
    expect(storeMigration).toContain("when 'personal_live_activity_lifetime'");
    expect(storeMigration).toContain('Fixed product-code allow-list');
  });

  it('keeps personal live activity effective without membership', () => {
    expect(storeMigration).toContain(
      'Personal lifetime always counts; team Premium only when member',
    );
    expect(storeMigration).toContain('v_live_effective := v_live_personal');
  });

  it('catches concurrent create_reward_session unique_violation', () => {
    expect(storeMigration).toContain('when unique_violation then');
    expect(storeMigration).toContain("'session_active'");
  });

  it('uses conditional wallet debit instead of mapping all check_violation to insufficient', () => {
    expect(storeMigration).toContain('and balance >= v_product.price_tokens');
    expect(storeMigration).toContain("when check_violation then");
    expect(storeMigration).toMatch(
      /when check_violation then[\s\S]*'invalid'/,
    );
  });
});

describe('AdMob constants', () => {
  it('matches approved production units and callback URL', () => {
    expect(ADMOB_REWARDED_UNITS.ios).toBe('ca-app-pub-8135109277557342/7899053731');
    expect(ADMOB_REWARDED_UNITS.android).toBe('ca-app-pub-8135109277557342/7100977386');
    expect(STORE_SSV_CALLBACK_URL).toContain('admob-reward-callback');
    expect(STORE_SSV_CALLBACK_URL).toContain('htqrucnjafhhvxdqslbv');
  });
});

describe('mapStoreSnapshot', () => {
  it('maps anonymous registration gate', () => {
    const snap = mapStoreSnapshot({
      ok: true,
      anonymous: true,
      registration_required: true,
      balance: 0,
      catalog: [],
      can_create_reward_session: false,
      can_redeem: false,
      live_activity_personal: false,
      live_activity_effective: false,
    });
    expect(snap.anonymous).toBe(true);
    expect(snap.canCreateRewardSession).toBe(false);
    expect(snap.canRedeem).toBe(false);
  });

  it('maps catalog and credits', () => {
    const snap = mapStoreSnapshot({
      ok: true,
      balance: 7,
      catalog: [
        {
          code: 'team_premium_1d',
          display_name: 'Premium 一日卡',
          scope: 'team',
          price_tokens: 5,
          effect_json: { kind: 'team_premium_days', days: 1 },
          sort_order: 10,
          active: true,
        },
      ],
      can_create_reward_session: true,
      can_redeem: true,
      extra_point_credits: 3,
      live_activity_personal: true,
      live_activity_effective: true,
    });
    expect(snap.balance).toBe(7);
    expect(snap.catalog[0]?.priceTokens).toBe(5);
    expect(snap.extraPointCredits).toBe(3);
    expect(snap.liveActivityEffective).toBe(true);
  });
});

describe('StoreService RPCs', () => {
  it('getStoreSnapshot calls get_store_snapshot', async () => {
    mockedRpc.mockResolvedValue({
      data: { ok: true, balance: 1, catalog: [], can_create_reward_session: true, can_redeem: true },
      error: null,
    });
    const snap = await getStoreSnapshot('g1');
    expect(mockedRpc).toHaveBeenCalledWith('get_store_snapshot', { p_group_id: 'g1' });
    expect(snap.balance).toBe(1);
  });

  it('createRewardSession rejects anonymous path from server error', async () => {
    mockedRpc.mockResolvedValue({
      data: { ok: false, error: 'registration_required' },
      error: null,
    });
    const res = await createRewardSession('ios');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('registration_required');
  });

  it('redeemStoreProduct maps insufficient balance', async () => {
    mockedRpc.mockResolvedValue({
      data: {
        ok: false,
        error: 'insufficient_balance',
        shortfall: 3,
        price: 5,
        balance: 2,
      },
      error: null,
    });
    const res = await redeemStoreProduct('team_premium_1d', 'g1');
    expect(res.ok).toBe(false);
    expect(res.shortfall).toBe(3);
  });

  it('redeemStoreProduct success returns stacked entitlement fields', async () => {
    mockedRpc.mockResolvedValue({
      data: {
        ok: true,
        product_code: 'team_premium_3d',
        balance: 0,
        stacked: true,
        source: 'token_redemption',
        expires_at: '2099-01-01T00:00:00Z',
      },
      error: null,
    });
    const res = await redeemStoreProduct('team_premium_3d', 'g1');
    expect(res.ok).toBe(true);
    expect(res.stacked).toBe(true);
    expect(res.source).toBe('token_redemption');
  });

  it('updateRewardSessionStatus calls RPC', async () => {
    mockedRpc.mockResolvedValue({
      data: { ok: true, status: 'failed' },
      error: null,
    });
    const res = await updateRewardSessionStatus('abc', 'failed');
    expect(mockedRpc).toHaveBeenCalledWith('update_reward_session_status', {
      p_session_ref: 'abc',
      p_status: 'failed',
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe('failed');
  });
});
