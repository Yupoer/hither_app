-- #168 / #166 Sol P1: kick_group_member is expiry-aware via extensions.is_member.
-- Fixtures must be valid hexadecimal UUIDs (pg rejects k*/kg* prefixes with 22P02).
-- pgTAP: run via `supabase test db --local supabase/tests/kick_group_member.test.sql`

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(8);

insert into auth.users (id, email, is_anonymous) values
  ('e1111111-1111-4111-8111-111111111111', 'kick-leader@example.test', false),
  ('e2222222-2222-4222-8222-222222222222', 'kick-follower@example.test', false),
  ('e3333333-3333-4333-8333-333333333333', 'kick-anon-leader@example.test', true),
  ('e4444444-4444-4444-8444-444444444444', 'kick-other-leader@example.test', false),
  ('e5555555-5555-4555-8555-555555555555', 'kick-other-follower@example.test', false),
  ('e6666666-6666-4666-8666-666666666666', 'kick-second-leader@example.test', false);

insert into public.profiles (id, nickname, anonymous_expires_at) values
  ('e1111111-1111-4111-8111-111111111111', 'Leader', null),
  ('e2222222-2222-4222-8222-222222222222', 'Follower', null),
  (
    'e3333333-3333-4333-8333-333333333333',
    'AnonLeader',
    now() - interval '1 hour'
  ),
  ('e4444444-4444-4444-8444-444444444444', 'OtherLeader', null),
  ('e5555555-5555-4555-8555-555555555555', 'OtherFollower', null),
  ('e6666666-6666-4666-8666-666666666666', 'SecondLeader', null);

insert into public.groups (id, name, invite_code, created_by) values
(
  'e6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Kick trip',
  'KCK001',
  'e1111111-1111-4111-8111-111111111111'
),
(
  'e6bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Anon leader trip',
  'KCK002',
  'e3333333-3333-4333-8333-333333333333'
),
(
  'e6cccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Other trip',
  'KCK003',
  'e4444444-4444-4444-8444-444444444444'
);

insert into public.memberships (group_id, user_id, role, created_at) values
  (
    'e6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'e1111111-1111-4111-8111-111111111111',
    'leader',
    now() - interval '2 days'
  ),
  (
    'e6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'e2222222-2222-4222-8222-222222222222',
    'follower',
    now() - interval '2 days'
  ),
  (
    'e6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'e6666666-6666-4666-8666-666666666666',
    'leader',
    now() - interval '2 days'
  ),
  (
    'e6bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'e3333333-3333-4333-8333-333333333333',
    'leader',
    now() - interval '20 days'
  ),
  (
    'e6bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'e2222222-2222-4222-8222-222222222222',
    'follower',
    now() - interval '2 days'
  ),
  (
    'e6cccccc-cccc-4ccc-8ccc-cccccccccccc',
    'e4444444-4444-4444-8444-444444444444',
    'leader',
    now() - interval '2 days'
  ),
  (
    'e6cccccc-cccc-4ccc-8ccc-cccccccccccc',
    'e5555555-5555-4555-8555-555555555555',
    'follower',
    now() - interval '2 days'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Active registered leader kicks follower + rotates invite.
select lives_ok(
  $$select public.kick_group_member(
    'e6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'e2222222-2222-4222-8222-222222222222'
  )$$,
  'authenticated leader can kick follower'
);

select is(
  (select count(*)::int from public.memberships
    where group_id = 'e6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = 'e2222222-2222-4222-8222-222222222222'),
  0,
  'kicked follower membership removed'
);

select isnt(
  (select invite_code from public.groups where id = 'e6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'KCK001',
  'invite code rotated after kick'
);

-- Self kick denied
select throws_ok(
  $$select public.kick_group_member(
    'e6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'e1111111-1111-4111-8111-111111111111'
  )$$,
  '22023',
  null,
  'cannot kick self'
);

-- Leader cannot kick another leader (target-role gate)
select throws_ok(
  $$select public.kick_group_member(
    'e6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'e6666666-6666-4666-8666-666666666666'
  )$$,
  '22023',
  null,
  'cannot kick leader'
);

-- Follower cannot kick (role check after is_member)
select set_config('request.jwt.claim.sub', 'e5555555-5555-4555-8555-555555555555', true);
select throws_ok(
  $$select public.kick_group_member(
    'e6cccccc-cccc-4ccc-8ccc-cccccccccccc',
    'e4444444-4444-4444-8444-444444444444'
  )$$,
  '42501',
  null,
  'follower cannot kick leader target'
);

-- Cross-group leader denied
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$select public.kick_group_member(
    'e6cccccc-cccc-4ccc-8ccc-cccccccccccc',
    'e5555555-5555-4555-8555-555555555555'
  )$$,
  '42501',
  null,
  'cross-group leader denied'
);

-- Expired anonymous leader denied via is_member (memberships row still present)
select set_config('request.jwt.claim.sub', 'e3333333-3333-4333-8333-333333333333', true);
select throws_ok(
  $$select public.kick_group_member(
    'e6bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'e2222222-2222-4222-8222-222222222222'
  )$$,
  '42501',
  null,
  'expired anonymous leader cannot kick'
);

select * from finish();
rollback;
