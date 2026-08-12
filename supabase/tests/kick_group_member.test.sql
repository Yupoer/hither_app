-- #168 / #166 Sol P1: kick_group_member is expiry-aware via extensions.is_member.
-- pgTAP-oriented. Run with a Supabase SQL test harness when available.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(7);

insert into auth.users (id, email, is_anonymous) values
  ('k1111111-1111-4111-8111-111111111111', 'kick-leader@example.test', false),
  ('k2222222-2222-4222-8222-222222222222', 'kick-follower@example.test', false),
  ('k3333333-3333-4333-8333-333333333333', 'kick-anon-leader@example.test', true),
  ('k4444444-4444-4444-8444-444444444444', 'kick-other-leader@example.test', false),
  ('k5555555-5555-4555-8555-555555555555', 'kick-other-follower@example.test', false);

insert into public.profiles (id, display_name, anonymous_expires_at) values
  ('k1111111-1111-4111-8111-111111111111', 'Leader', null),
  ('k2222222-2222-4222-8222-222222222222', 'Follower', null),
  (
    'k3333333-3333-4333-8333-333333333333',
    'AnonLeader',
    now() - interval '1 hour'
  ),
  ('k4444444-4444-4444-8444-444444444444', 'OtherLeader', null),
  ('k5555555-5555-4555-8555-555555555555', 'OtherFollower', null);

insert into public.groups (id, name, invite_code, created_by) values
(
  'kgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Kick trip',
  'KCK001',
  'k1111111-1111-4111-8111-111111111111'
),
(
  'kgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Anon leader trip',
  'KCK002',
  'k3333333-3333-4333-8333-333333333333'
),
(
  'kgcccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Other trip',
  'KCK003',
  'k4444444-4444-4444-8444-444444444444'
);

insert into public.memberships (group_id, user_id, role, created_at) values
  (
    'kgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'k1111111-1111-4111-8111-111111111111',
    'leader',
    now() - interval '2 days'
  ),
  (
    'kgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'k2222222-2222-4222-8222-222222222222',
    'follower',
    now() - interval '2 days'
  ),
  (
    'kgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'k3333333-3333-4333-8333-333333333333',
    'leader',
    now() - interval '20 days'
  ),
  (
    'kgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'k2222222-2222-4222-8222-222222222222',
    'follower',
    now() - interval '2 days'
  ),
  (
    'kgcccccc-cccc-4ccc-8ccc-cccccccccccc',
    'k4444444-4444-4444-8444-444444444444',
    'leader',
    now() - interval '2 days'
  ),
  (
    'kgcccccc-cccc-4ccc-8ccc-cccccccccccc',
    'k5555555-5555-4555-8555-555555555555',
    'follower',
    now() - interval '2 days'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', 'k1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Active registered leader kicks follower + rotates invite.
select lives_ok(
  $$select public.kick_group_member(
    'kgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'k2222222-2222-4222-8222-222222222222'
  )$$,
  'authenticated leader can kick follower'
);

select is(
  (select count(*)::int from public.memberships
    where group_id = 'kgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = 'k2222222-2222-4222-8222-222222222222'),
  0,
  'kicked follower membership removed'
);

select isnt(
  (select invite_code from public.groups where id = 'kgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'KCK001',
  'invite code rotated after kick'
);

-- Self kick denied
select throws_ok(
  $$select public.kick_group_member(
    'kgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'k1111111-1111-4111-8111-111111111111'
  )$$,
  '22023',
  null,
  'cannot kick self'
);

-- Follower cannot kick (role check after is_member)
select set_config('request.jwt.claim.sub', 'k5555555-5555-4555-8555-555555555555', true);
select throws_ok(
  $$select public.kick_group_member(
    'kgcccccc-cccc-4ccc-8ccc-cccccccccccc',
    'k4444444-4444-4444-8444-444444444444'
  )$$,
  '42501',
  null,
  'follower cannot kick leader target'
);

-- Cross-group leader denied
select set_config('request.jwt.claim.sub', 'k1111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$select public.kick_group_member(
    'kgcccccc-cccc-4ccc-8ccc-cccccccccccc',
    'k5555555-5555-4555-8555-555555555555'
  )$$,
  '42501',
  null,
  'cross-group leader denied'
);

-- Expired anonymous leader denied via is_member (memberships row still present)
select set_config('request.jwt.claim.sub', 'k3333333-3333-4333-8333-333333333333', true);
select throws_ok(
  $$select public.kick_group_member(
    'kgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'k2222222-2222-4222-8222-222222222222'
  )$$,
  '42501',
  null,
  'expired anonymous leader cannot kick'
);

select * from finish();
rollback;
