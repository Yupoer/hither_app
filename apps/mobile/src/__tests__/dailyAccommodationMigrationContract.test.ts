import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260810000000_daily_accommodations_favorites.sql',
  ),
  'utf8',
);

describe('daily accommodations + favorites migration contract (#159 #160)', () => {
  it('creates daily_accommodations with group/date uniqueness and grants+RLS', () => {
    expect(migration).toContain('create table if not exists public.daily_accommodations');
    expect(migration).toContain('unique (group_id, stay_date)');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('daily_accommodations: select if member');
    expect(migration).toContain('daily_accommodations: insert if leader');
    expect(migration).toContain('daily_accommodations: update if leader');
    expect(migration).toContain('daily_accommodations: delete if leader');
    expect(migration).toContain('and exists (');
    expect(migration).toContain('with check (');
    expect(migration).toContain(
      'grant select, insert, update, delete on public.daily_accommodations to authenticated',
    );
  });

  it('requires expiry-aware is_member before leader role on writes (expired anonymous denial)', () => {
    // Write policies and definer RPC must gate through extensions.is_member.
    expect(migration).toMatch(
      /daily_accommodations: insert if leader[\s\S]*extensions\.is_member\(group_id\)[\s\S]*role = 'leader'/,
    );
    expect(migration).toMatch(
      /daily_accommodations: update if leader[\s\S]*extensions\.is_member\(group_id\)[\s\S]*role = 'leader'/,
    );
    expect(migration).toMatch(
      /daily_accommodations: delete if leader[\s\S]*extensions\.is_member\(group_id\)[\s\S]*role = 'leader'/,
    );
    expect(migration).toContain('if not extensions.is_member(p_group_id)');
    expect(migration).toContain("raise exception 'not_leader'");
    // Expired anonymous leaders retain memberships.role=leader but fail is_member.
    expect(migration).toMatch(/Expired anonymous leaders fail is_member/i);
  });

  it('serializes none→some auto-add under group lock and rolls back on insert failure', () => {
    expect(migration).toContain('for update');
    expect(migration).toContain('stay_anchor');
    expect(migration).toContain('(not v_previous_exists) and v_auto_add');
    // Two card inserts; any failure aborts the plpgsql function transaction.
    expect(migration.match(/kind, stay_anchor/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain('first_card_id');
    expect(migration).toContain('last_card_id');
  });

  it('creates account_favorite_places with owner RLS and uniqueness', () => {
    expect(migration).toContain('create table if not exists public.account_favorite_places');
    expect(migration).toContain('unique (user_id, title_norm, lat_norm, lng_norm)');
    expect(migration).toContain('idx_account_favorite_places_user_id');
    expect(migration).toContain('(select auth.uid()) = user_id');
    expect(migration).toContain(
      'grant select, insert, update, delete on public.account_favorite_places to authenticated',
    );
  });

  it('adds itinerary kind, stay_anchor, and auto-add switch', () => {
    expect(migration).toContain("kind in ('stop', 'accommodation')");
    expect(migration).toContain('accommodation_auto_add boolean not null default true');
    expect(migration).toContain('stay_anchor boolean not null default false');
  });

  it('keeps privileged DEFINER bodies in non-exposed extensions schema with INVOKER public wrappers', () => {
    expect(migration).toContain(
      'function extensions.set_daily_accommodation_with_auto_add',
    );
    expect(migration).toContain(
      'function extensions.clear_daily_accommodation_with_downgrade',
    );
    expect(migration).toMatch(
      /create or replace function public\.set_daily_accommodation_with_auto_add[\s\S]*security invoker/i,
    );
    expect(migration).toMatch(
      /create or replace function public\.clear_daily_accommodation_with_downgrade[\s\S]*security invoker/i,
    );
    // DEFINER only on extensions bodies (public wrappers are INVOKER).
    expect(migration).toMatch(
      /function extensions\.set_daily_accommodation_with_auto_add[\s\S]*security definer/i,
    );
    expect(migration).toMatch(
      /function extensions\.clear_daily_accommodation_with_downgrade[\s\S]*security definer/i,
    );
    expect(migration).toContain(
      'revoke all on function public.set_daily_accommodation_with_auto_add',
    );
    expect(migration).toContain(
      'grant execute on function public.set_daily_accommodation_with_auto_add',
    );
    expect(migration).toContain(
      'grant execute on function public.clear_daily_accommodation_with_downgrade',
    );
  });

  it('atomic clear + stay_anchor downgrade under group lock', () => {
    expect(migration).toContain('clear_daily_accommodation_with_downgrade');
    expect(migration).toContain('delete from public.daily_accommodations');
    expect(migration).toMatch(
      /clear_daily_accommodation_with_downgrade[\s\S]*for update[\s\S]*set stay_anchor = false/i,
    );
  });

  it('downgrades stay_anchor on some→some path', () => {
    expect(migration).toContain('if v_previous_exists then');
    expect(migration).toContain('set stay_anchor = false');
  });
});
