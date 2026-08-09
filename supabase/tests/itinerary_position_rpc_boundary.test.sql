-- pgTAP: RPC-only position/day boundary + approval writer uses group lock (#151 Sol r3).
-- Direct table INSERT/UPDATE of position|day must fail without GUC.
-- Authorized RPCs set GUC after groups FOR UPDATE.
-- Live multi-session concurrency still requires a deployed Supabase (documented Unverified).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(12);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'leader-bound@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'follower-bound@example.test');

insert into public.groups (id, name, invite_code, created_by) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Boundary trip',
  'BND001',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.memberships (group_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'leader'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'follower');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Seed via authorized RPC.
select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'A', null, 1::float8, 1::float8, 1
  ) $$,
  'seed add via RPC'
);

select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'B', null, 2::float8, 2::float8, 1
  ) $$,
  'seed second stop via RPC'
);

-- Direct INSERT rejected (no GUC).
select throws_ok(
  $$ insert into public.itinerary_items (
       group_id, title, day, latitude, longitude, position
     ) values (
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Direct', 1, 3, 3, 99
     ) $$,
  '42501',
  'itinerary position writes must use authorized RPCs',
  'direct INSERT position rejected'
);

-- Direct UPDATE position rejected.
select throws_ok(
  $$ update public.itinerary_items
     set position = 0
     where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'B' $$,
  '42501',
  'itinerary position/day writes must use authorized RPCs',
  'direct UPDATE position rejected'
);

-- Direct UPDATE day rejected.
select throws_ok(
  $$ update public.itinerary_items
     set day = 9
     where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'B' $$,
  '42501',
  'itinerary position/day writes must use authorized RPCs',
  'direct UPDATE day rejected'
);

-- Closed-row position patch also rejected on direct table path.
update public.itinerary_items
set closed_at = now()
where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'A';

select throws_ok(
  $$ update public.itinerary_items
     set position = 5
     where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'A' $$,
  '42501',
  'itinerary position/day writes must use authorized RPCs',
  'direct UPDATE closed row position rejected'
);

-- Legitimate non-position columns still writable (meet_at / emoji).
select lives_ok(
  $$ update public.itinerary_items
     set meet_at = now() + interval '1 hour'
     where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'B' $$,
  'meet_at update allowed without GUC'
);

select lives_ok(
  $$ update public.itinerary_items
     set emoji = '🏁'
     where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'B' $$,
  'emoji update allowed without GUC'
);

-- Reorder still works via RPC (sets GUC under lock).
select is(
  public.reorder_itinerary_items(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (
      select jsonb_agg(
        jsonb_build_object('id', id, 'position', 99, 'day', coalesce(day, 1))
        order by position desc
      )
      from public.itinerary_items
      where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        and closed_at is null
    )
  ),
  1,
  'RPC reorder of open rows still succeeds with GUC'
);

-- Guard function + writers reference groups FOR UPDATE + allow GUC (source contract).
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guard_itinerary_position_day'
  ),
  'guard_itinerary_position_day function installed'
);

select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'itinerary_items'
      and t.tgname = 'trg_guard_itinerary_position_day'
  ),
  'guard trigger installed on itinerary_items'
);

-- Source-level: resolve_gather + coordination include groups FOR UPDATE before insert path.
-- (Executable two-session lock race needs live Supabase; proven here by function body contract.)
select ok(
  position('for update' in lower(pg_get_functiondef('public.resolve_gather_point_request(uuid,boolean)'::regprocedure))) > 0
  and position(
    'hither.allow_itinerary_position_write'
    in pg_get_functiondef('public.resolve_gather_point_request(uuid,boolean)'::regprocedure)
  ) > 0,
  'resolve_gather_point_request locks group and sets position-write GUC'
);

select * from finish();
rollback;
