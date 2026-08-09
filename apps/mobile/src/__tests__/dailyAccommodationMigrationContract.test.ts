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
    expect(migration).toContain('using (exists');
    expect(migration).toContain('with check (exists');
    expect(migration).toContain(
      'grant select, insert, update, delete on public.daily_accommodations to authenticated',
    );
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

  it('adds itinerary kind and auto-add switch', () => {
    expect(migration).toContain("kind in ('stop', 'accommodation')");
    expect(migration).toContain('accommodation_auto_add boolean not null default true');
  });

  it('provides atomic auto-add RPC with leader auth and revoked default execute', () => {
    expect(migration).toContain('set_daily_accommodation_with_auto_add');
    expect(migration).toContain('security definer');
    expect(migration).toContain("raise exception 'not_leader'");
    expect(migration).toContain('revoke all on function public.set_daily_accommodation_with_auto_add');
    expect(migration).toContain('grant execute on function public.set_daily_accommodation_with_auto_add');
  });
});
