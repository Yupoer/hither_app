-- pgTAP: import_itinerary_batch auth, cross-group subgroup rejection, rollback (#151 Sol P1).
-- Run when a local/CI Supabase with migrations applied is available.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(15);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'leader-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'follower-a@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'leader-b@example.test');

insert into public.groups (id, name, invite_code, created_by) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Group A', 'IMPA01', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Group B', 'IMPA02', '33333333-3333-4333-8333-333333333333'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Group C', 'IMPA03', '11111111-1111-4111-8111-111111111111');

insert into public.memberships (group_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'leader'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'follower'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '33333333-3333-4333-8333-333333333333', 'leader'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', 'leader');

insert into public.subgroups (id, group_id, name, mode) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B-sub', 'led');

-- 1) Anon / no jwt cannot call.
reset role;
select throws_ok(
  $$ select public.import_itinerary_batch(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    null,
    1,
    '[{"title":"X","latitude":1,"longitude":2}]'::jsonb
  ) $$,
  '42501',
  'authentication required',
  'anon/unauth rejected'
);

-- 2) Follower rejected.
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$ select public.import_itinerary_batch(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    null,
    1,
    '[{"title":"X","latitude":1,"longitude":2}]'::jsonb
  ) $$,
  '42501',
  'scope leader membership required',
  'non-leader rejected'
);

-- 3) Leader success.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  public.import_itinerary_batch(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    null,
    1,
    '[{"title":"Stop A","latitude":25.0,"longitude":121.0},{"title":"Stop B","latitude":25.1,"longitude":121.1}]'::jsonb
  ),
  2,
  'leader batch inserts 2'
);

select is(
  (select count(*)::int from public.itinerary_items where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  2,
  'two rows present after success'
);

-- 4) Cross-group subgroup injection rejected.
select throws_ok(
  $$ select public.import_itinerary_batch(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    1,
    '[{"title":"Inject","latitude":1,"longitude":2}]'::jsonb
  ) $$,
  '22023',
  'subgroup does not belong to group',
  'cross-group subgroup rejected'
);

select is(
  (select count(*)::int from public.itinerary_items where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  2,
  'rejection leaves prior rows intact'
);

-- 5) A real insert-time failure rolls back earlier rows and position shifts.
reset role;
create or replace function pg_temp.fail_import_item()
returns trigger
language plpgsql
as $$
begin
  if new.title = 'Persist Fail' then
    raise exception 'injected persistence failure' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger test_fail_import_item
  before insert on public.itinerary_items
  for each row execute function pg_temp.fail_import_item();
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$ select public.import_itinerary_batch(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    null,
    1,
    '[{"title":"Good","latitude":1,"longitude":2},{"title":"Persist Fail","latitude":1,"longitude":2}]'::jsonb
  ) $$,
  '23514',
  'injected persistence failure',
  'second insert failure aborts batch'
);

select results_eq(
  $$ select title, position
     from public.itinerary_items
     where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     order by position $$,
  $$ values ('Stop A'::text, 0), ('Stop B'::text, 1) $$,
  'insert failure restores rows and positions'
);

-- 6) Free usage is account-wide, survives failed batches, and rejects the
-- sixth imported point instead of resetting when the sheet is opened again.
select is(
  public.get_kml_import_quota(),
  3,
  'failed batch does not consume the remaining account quota'
);

select is(
  public.import_itinerary_batch(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    null,
    1,
    '[{"title":"Stop C","latitude":25.2,"longitude":121.2},{"title":"Stop D","latitude":25.3,"longitude":121.3},{"title":"Stop E","latitude":25.4,"longitude":121.4}]'::jsonb
  ),
  3,
  'second batch consumes the rest of the account quota'
);

select is(public.get_kml_import_quota(), 0, 'account quota reaches zero');

select throws_ok(
  $$ select public.import_itinerary_batch(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    null,
    1,
    '[{"title":"Stop F","latitude":25.5,"longitude":121.5}]'::jsonb
  ) $$,
  'P0004',
  'kml import quota exceeded',
  'sixth free import is rejected'
);

select is(
  (select count(*)::int from public.itinerary_items where group_id in (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  )),
  5,
  'quota rejection leaves all imported rows intact'
);

-- 7) add_itinerary_item also rejects cross-group subgroup.
select throws_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Bad sub',
    null,
    1::float8,
    2::float8,
    1
  ) $$,
  '22023',
  'subgroup does not belong to group',
  'add_itinerary_item rejects foreign subgroup'
);

-- 8) Serialized add succeeds for leader.
select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    null,
    'Stop C',
    null,
    25.2::float8,
    121.2::float8,
    1
  ) $$,
  'leader add_itinerary_item ok'
);

select * from finish();
rollback;
