-- #199 / #200: any authenticated caller may permanently delete self.
-- Fixtures must be valid hexadecimal UUIDs (pg rejects prefixed ids with 22P02).
-- pgTAP: run via `supabase test db --local supabase/tests/delete_account.test.sql`

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(12);

insert into auth.users (id, email, is_anonymous) values
  ('a1111111-1111-4111-8111-111111111111', 'del-registered@example.test', false),
  ('a2222222-2222-4222-8222-222222222222', 'del-stay@example.test', false),
  ('a3333333-3333-4333-8333-333333333333', 'del-empty@example.test', false),
  ('a4444444-4444-4444-8444-444444444444', 'del-anon@example.test', true);

insert into public.profiles (id, nickname) values
  ('a1111111-1111-4111-8111-111111111111', 'Registered'),
  ('a2222222-2222-4222-8222-222222222222', 'Stay'),
  ('a3333333-3333-4333-8333-333333333333', 'EmptyOnly'),
  ('a4444444-4444-4444-8444-444444444444', 'Anon');

insert into public.groups (id, name, invite_code, created_by) values
(
  'a6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Stay trip',
  'DEL001',
  'a1111111-1111-4111-8111-111111111111'
),
(
  'a6bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Empty trip',
  'DEL002',
  'a3333333-3333-4333-8333-333333333333'
);

insert into public.memberships (group_id, user_id, role, created_at) values
  (
    'a6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a1111111-1111-4111-8111-111111111111',
    'leader',
    now() - interval '2 days'
  ),
  (
    'a6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a2222222-2222-4222-8222-222222222222',
    'follower',
    now() - interval '2 days'
  ),
  (
    'a6bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'a3333333-3333-4333-8333-333333333333',
    'leader',
    now() - interval '2 days'
  );

insert into public.commands (group_id, sender_id, type, message) values
(
  'a6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'a1111111-1111-4111-8111-111111111111',
  'gather',
  'meet here'
);

insert into public.itinerary_items (
  id, group_id, title, latitude, longitude, position
) values (
  'a7bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'a6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Station',
  25.0478,
  121.517,
  0
);

insert into public.navigation_sessions (
  id,
  group_id,
  destination_id,
  destination_name,
  destination_latitude,
  destination_longitude,
  started_by,
  request_id,
  status
) values (
  'a8cccccc-cccc-4ccc-8ccc-cccccccccccc',
  'a6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'a7bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Station',
  25.0478,
  121.517,
  'a1111111-1111-4111-8111-111111111111',
  'a9dddddd-dddd-4ddd-8ddd-dddddddddddd',
  'active'
);

insert into public.daily_accommodations (
  group_id, stay_date, title, latitude, longitude, created_by
) values (
  'a6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '2026-08-17',
  'Hotel',
  25.04,
  121.51,
  'a1111111-1111-4111-8111-111111111111'
);

update auth.users
  set is_anonymous = true
  where id = 'a4444444-4444-4444-8444-444444444444';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);

select lives_ok(
  $$select public.delete_anonymous_account()$$,
  'registered caller can permanently delete self'
);

-- Assertions need table owners; authenticated cannot SELECT auth.users.
reset role;

select is(
  (select count(*)::int from auth.users where id = 'a1111111-1111-4111-8111-111111111111'),
  0,
  'registered auth.users row is gone'
);

select is(
  (select count(*)::int from public.memberships
    where user_id = 'a1111111-1111-4111-8111-111111111111'),
  0,
  'deleted user memberships are gone'
);

select is(
  (select count(*)::int from public.commands
    where sender_id = 'a1111111-1111-4111-8111-111111111111'),
  0,
  'deleted user commands are gone'
);

select is(
  (select count(*)::int from public.navigation_sessions
    where started_by = 'a1111111-1111-4111-8111-111111111111'),
  0,
  'RESTRICT navigation_sessions started_by does not block self-delete'
);

select ok(
  exists(select 1 from public.groups where id = 'a6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'group with remaining members survives'
);

select is(
  (select created_by from public.groups where id = 'a6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  null,
  'remaining group created_by is nulled'
);

select is(
  (select created_by from public.daily_accommodations
    where group_id = 'a6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  null,
  'daily_accommodations created_by is nulled'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}',
  true
);

select lives_ok(
  $$select public.delete_anonymous_account()$$,
  'sole member can delete self'
);

reset role;

select ok(
  not exists(select 1 from public.groups where id = 'a6bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'empty-only group is removed by existing trigger'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a4444444-4444-4444-8444-444444444444', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"a4444444-4444-4444-8444-444444444444","role":"authenticated","is_anonymous":true}',
  true
);

select lives_ok(
  $$select public.delete_anonymous_account()$$,
  'anonymous caller still permanently deletes self'
);

reset role;

select is(
  (select count(*)::int from auth.users where id = 'a4444444-4444-4444-8444-444444444444'),
  0,
  'anonymous auth.users row is gone'
);

select * from finish();
rollback;
