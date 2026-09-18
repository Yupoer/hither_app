-- OTA-05 P1: expired anonymous membership cannot read/mutate shared group data.
-- pgTAP-oriented. Run with a Supabase SQL test harness when available;
-- client contract tests assert the migration DDL/behavior strings.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(17);

-- Registered leader + expired anonymous follower + expired anonymous leader group.
insert into auth.users (id, email, is_anonymous) values
  ('a1111111-1111-4111-8111-111111111111', 'leader@example.test', false),
  ('a2222222-2222-4222-8222-222222222222', 'anon@example.test', true),
  ('a3333333-3333-4333-8333-333333333333', 'anon-leader@example.test', true);

insert into public.profiles (id, nickname) values
  ('a1111111-1111-4111-8111-111111111111', 'Leader'),
  ('a2222222-2222-4222-8222-222222222222', 'Anon'),
  ('a3333333-3333-4333-8333-333333333333', 'AnonLeader');

insert into public.groups (id, name, invite_code, created_by) values
(
  'a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Expiry trip',
  'EXP001',
  'a1111111-1111-4111-8111-111111111111'
),
(
  'a4cccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Anon leader trip',
  'EXP002',
  'a3333333-3333-4333-8333-333333333333'
);

insert into public.memberships (group_id, user_id, role, created_at) values
  (
    'a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a1111111-1111-4111-8111-111111111111',
    'leader',
    now() - interval '20 days'
  ),
  (
    'a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a2222222-2222-4222-8222-222222222222',
    'follower',
    now() - interval '20 days'
  ),
  (
    'a4cccccc-cccc-4ccc-8ccc-cccccccccccc',
    'a3333333-3333-4333-8333-333333333333',
    'leader',
    now() - interval '20 days'
  );

-- Membership setup stamps a fresh anonymous window first; move both fixtures
-- past expiry afterward through the internal write gate.
select public.allow_anonymous_expiry_write();
update public.profiles
set anonymous_expires_at = now() - interval '1 hour'
where id in (
  'a2222222-2222-4222-8222-222222222222',
  'a3333333-3333-4333-8333-333333333333'
);

insert into public.itinerary_items (
  id, group_id, title, latitude, longitude, position
) values (
  'a4bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Stop',
  25.0,
  121.0,
  0
);

-- Open coordination request owned by registered leader (for follower deny tests).
insert into public.coordination_requests (
  id, group_id, created_by, subject, subject_kind,
  options, deadline, policy, default_outcome, status
) values (
  'a4dddddd-dddd-4ddd-8ddd-dddddddddddd',
  'a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'a1111111-1111-4111-8111-111111111111',
  'Meet point',
  'gathering_point',
  '[{"id":"keep","label":"Keep"},{"id":"change","label":"Change"}]'::jsonb,
  now() + interval '1 hour',
  'majority',
  'keep',
  'open'
);

-- Helper semantics
select ok(
  public.anonymous_access_is_active('a1111111-1111-4111-8111-111111111111'),
  'registered user always has active access'
);

select ok(
  not public.anonymous_access_is_active('a2222222-2222-4222-8222-222222222222'),
  'expired anonymous user is not active'
);

-- Leader (registered) still a member
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  extensions.is_member('a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'registered leader is_member true'
);

select is(
  (select count(*)::int from public.groups
    where id = 'a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'registered leader can select group'
);

select is(
  (select count(*)::int from public.itinerary_items
    where group_id = 'a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'registered leader can select itinerary'
);

-- Expired anonymous follower: membership row exists but access denied
select set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222222', true);

select ok(
  not extensions.is_member('a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'expired anonymous is_member false despite memberships row'
);

select is(
  (select count(*)::int from public.groups
    where id = 'a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0,
  'expired anonymous cannot select group via RLS'
);

select is(
  (select count(*)::int from public.memberships
    where group_id = 'a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0,
  'expired anonymous cannot select memberships via RLS'
);

select is(
  (select count(*)::int from public.itinerary_items
    where group_id = 'a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0,
  'expired anonymous cannot select itinerary via RLS'
);

-- Mutations / DEFINER guards
select throws_ok(
  $$select public.set_solo('a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true)$$,
  '42501',
  null,
  'expired anonymous cannot set_solo'
);

select throws_ok(
  $$select public.self_split('a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'X')$$,
  null,
  null,
  'expired anonymous cannot self_split'
);

-- Coordination + location refresh: expired anonymous follower denied
select throws_ok(
  $$select public.request_group_location_refresh('a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,
  '42501',
  null,
  'expired anonymous cannot request_group_location_refresh'
);

select throws_ok(
  $$select public.respond_to_coordination_request(
    'a4dddddd-dddd-4ddd-8ddd-dddddddddddd',
    'keep'
  )$$,
  '42501',
  null,
  'expired anonymous cannot respond_to_coordination_request'
);

-- Expired anonymous leader denied create / cancel / override
select set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', true);

select throws_ok(
  $$select public.create_coordination_request(
    'a4cccccc-cccc-4ccc-8ccc-cccccccccccc',
    null,
    'Meet',
    'gathering_point',
    '[{"id":"keep","label":"Keep"},{"id":"change","label":"Change"}]'::jsonb,
    now() + interval '1 hour',
    'majority',
    'keep'
  )$$,
  '42501',
  null,
  'expired anonymous leader cannot create_coordination_request'
);

-- Seed an open request as service for cancel/override deny paths
reset role;
insert into public.coordination_requests (
  id, group_id, created_by, subject, subject_kind,
  options, deadline, policy, default_outcome, status
) values (
  'a4eeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'a4cccccc-cccc-4ccc-8ccc-cccccccccccc',
  'a3333333-3333-4333-8333-333333333333',
  'Meet point',
  'gathering_point',
  '[{"id":"keep","label":"Keep"},{"id":"change","label":"Change"}]'::jsonb,
  now() + interval '1 hour',
  'majority',
  'keep',
  'open'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$select public.cancel_coordination_request('a4eeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,
  '42501',
  null,
  'expired anonymous leader cannot cancel_coordination_request'
);

select throws_ok(
  $$select public.override_coordination_request(
    'a4eeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'keep'
  )$$,
  '42501',
  null,
  'expired anonymous leader cannot override_coordination_request'
);

-- Just-before expiry still active
reset role;
select public.allow_anonymous_expiry_write();
update public.profiles
set anonymous_expires_at = now() + interval '1 hour'
where id = 'a2222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  extensions.is_member('a4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'unexpired anonymous is_member true'
);

select * from finish();
rollback;
