import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMPTY_PREMIUM_PROJECTION,
  mapPremiumProjectionRow,
} from '../entitlements';
import { getPremiumProjection } from '../api/services/EntitlementService';
import { supabase } from '../api/supabase';

jest.mock('../api/supabase', () => ({
  supabase: { rpc: jest.fn(), auth: { getSession: jest.fn() } },
}));

const mockedRpc = supabase.rpc as unknown as jest.Mock;
const mockedAuth = supabase.auth as unknown as { getSession: jest.Mock };
const migration = readFileSync(
  join(__dirname, '../../../../supabase/migrations/20260804000000_personal_premium_projection.sql'),
  'utf8',
).replace(/\r\n/g, '\n');
const legacyPurchaseMigration = readFileSync(
  join(__dirname, '../../../../supabase/migrations/20260804040000_disable_legacy_trip_pass_purchases.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
});

describe('PremiumProjection', () => {
  it('has a fixed fail-closed empty shape', () => {
    expect(mapPremiumProjectionRow(null)).toEqual(EMPTY_PREMIUM_PROJECTION);
    expect(mapPremiumProjectionRow({
      personal_premium_active: true,
      team_premium_active: true,
      status: 'active',
      product_id: 'premium.monthly',
      expires_at: '2026-09-01T00:00:00Z',
      source_version: 'v2',
    })).toEqual({
      personalPremiumActive: true,
      teamPremiumActive: true,
      status: 'active',
      productId: 'premium.monthly',
      expiresAt: '2026-09-01T00:00:00Z',
      sourceVersion: 'v2',
    });
  });

  it('reads the account-owned projection for a group', async () => {
    mockedRpc.mockResolvedValue({
      data: {
        personalPremiumActive: true,
        teamPremiumActive: false,
        status: 'active',
        productId: 'premium.yearly',
        expiresAt: null,
        sourceVersion: 'ledger-7',
      },
      error: null,
    });
    await expect(getPremiumProjection('group-1')).resolves.toMatchObject({
      personalPremiumActive: true,
      teamPremiumActive: false,
      productId: 'premium.yearly',
    });
    expect(mockedRpc).toHaveBeenCalledWith('get_premium_projection', { p_group_id: 'group-1' });
  });
});

describe('Ticket 5 migration contract', () => {
  it('defines account ownership, server projection and restricted mutation seam', () => {
    expect(migration).toContain('create table if not exists public.personal_premium_entitlements');
    expect(migration).toContain('create table if not exists public.premium_team_projections');
    expect(migration).toContain('create or replace function public.get_premium_projection');
    expect(migration).toContain('create or replace function public.apply_personal_premium_projection');
    expect(migration).toContain('grant execute on function public.apply_personal_premium_projection');
    expect(migration).toContain('to service_role');
    expect(migration).toContain('trg_recompute_premium_membership');
    expect(migration).toContain('trg_recompute_premium_entitlement');
    expect(migration).toContain('external_key text unique');
    expect(migration).toContain('team_premium_active');
  });

  it('does not transfer a personal grant to the leader', () => {
    expect(migration).toContain('Account-owned Premium grants; never transfer ownership to a group leader.');
    expect(migration).not.toContain('update public.personal_premium_entitlements set user_id');
  });

  it('does not treat a historical trip pass as team subscription Premium', () => {
    const teamProjection = migration.slice(
      migration.indexOf('create or replace function public.recompute_team_premium_projection'),
      migration.indexOf('revoke all on function public.recompute_team_premium_projection'),
    );
    expect(teamProjection).not.toContain('trip_entitlements');
    expect(teamProjection).toContain('group_has_active_subscription_premium');
    const subscriptionProjection = migration.slice(
      migration.indexOf('create function public.group_has_active_subscription_premium'),
      migration.indexOf('create or replace function public.group_has_active_premium'),
    );
    expect(subscriptionProjection).not.toContain('trip_entitlements');
    expect(subscriptionProjection).toContain('personal_premium_entitlements');
    expect(subscriptionProjection).toContain("e.source = 'app_store'");
    expect(subscriptionProjection).toContain('e.expires_at > now()');
    expect(migration).not.toContain('profile_has_lifetime_premium');
    expect(migration).not.toContain('legacy-profile-v1');
    expect(migration).not.toContain('legacy-premium-compat-v1');
  });

  it.each([
    ['legacy profile only', false, false],
    ['trip pass only', false, false],
    ['active StoreKit entitlement', true, true],
    ['expired StoreKit entitlement', true, false],
  ])('projection source matrix keeps %s outside new Premium', (_case, hasStoreKit, active) => {
    const projection = migration.slice(
      migration.indexOf('create or replace function public.get_premium_projection'),
    );
    if (hasStoreKit) expect(projection).toContain("e.source = 'app_store'");
    expect(projection).toContain('v_expires_at > now()');
    if (!active) expect(projection).not.toContain('v_expires_at is null');
  });

  it('rejects non-StoreKit writes and null expiry at the server projection seam', () => {
    const apply = migration.slice(
      migration.indexOf('create or replace function public.apply_personal_premium_projection'),
      migration.indexOf('revoke all on function public.apply_personal_premium_projection'),
    );
    expect(apply).toContain("p_source), ''), 'app_store') <> 'app_store'");
    expect(apply).toContain('p_expires_at is null');
  });

  it('keeps the historical trip-pass read path but disables new purchase writes', () => {
    expect(legacyPurchaseMigration).toContain('legacy_trip_pass_disabled');
    expect(legacyPurchaseMigration).not.toContain('insert into public.trip_entitlements');
    expect(legacyPurchaseMigration).toContain('grant execute on function public.apply_verified_purchase');
  });
});
