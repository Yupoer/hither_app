-- Ticket 04 / review-01: recovery snapshot authorization + shape (pgTAP).
-- SECURITY DEFINER must use expiry-aware extensions.is_member.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(8);

insert into auth.users (id, email, is_anonymous) values
  ('b1111111-1111-4111-8111-111111111111', 'snap-leader@example.test', false),
  ('b2222222-2222-4222-8222-222222222222', 'snap-anon@example.test', true),
  ('b3333333-3333-4333-8333-333333333333', 'snap-outsider@example.test', false);

insert into public.profiles (id, nickname, anonymous_expires_at) values
  ('b1111111-1111-4111-8111-111111111111', 'SnapLeader', null),
  (
    'b2222222-2222-4222-8222-222222222222',
    'SnapAnon',
    now() - interval '1 hour'
  ),
  ('b3333333-3333-4333-8333-333333333333', 'SnapOutsider', null);

insert into public.groups (id, name, invite_code, created_by) values (
  'bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Snapshot trip',
  'SNP001',
  'b1111111-1111-4111-8111-111111111111'
);

insert into public.memberships (group_id, user_id, role, created_at) values
  (
    'bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b1111111-1111-4111-8111-111111111111',
    'leader',
    now() - interval '20 days'
  ),
  (
    'bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b2222222-2222-4222-8222-222222222222',
    'follower',
    now() - interval '20 days'
  );

insert into public.itinerary_items (
  id, group_id, title, latitude, longitude, position
) values (
  'bgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Stop',
  25.0,
  121.0,
  0
);

-- Unauthenticated denied
reset role;
select throws_ok(
  $$select public.get_group_recovery_snapshot(
    'bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )$$,
  '28000',
  null,
  'unauthenticated cannot call get_group_recovery_snapshot'
);

-- Registered member can read full shape
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  (public.get_group_recovery_snapshot('bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ? 'schema_version'),
  'member snapshot has schema_version'
);

select ok(
  (public.get_group_recovery_snapshot('bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ?& array[
      'group', 'memberships', 'profiles', 'subgroups',
      'itinerary', 'locations', 'entity_versions', 'realtime_revision'
    ]),
  'member snapshot includes all recovery families'
);

select is(
  public.get_group_recovery_snapshot('bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    -> 'group' ->> 'id',
  'bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'member snapshot group id matches'
);

-- Non-member denied
select set_config('request.jwt.claim.sub', 'b3333333-3333-4333-8333-333333333333', true);

select throws_ok(
  $$select public.get_group_recovery_snapshot(
    'bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )$$,
  '42501',
  null,
  'non-member cannot call get_group_recovery_snapshot'
);

-- Expired anonymous with membership row still denied (P1)
select set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);

select ok(
  not extensions.is_member('bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'expired anonymous is_member false despite memberships row'
);

select throws_ok(
  $$select public.get_group_recovery_snapshot(
    'bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )$$,
  '42501',
  null,
  'expired anonymous cannot call get_group_recovery_snapshot'
);

-- Unexpired anonymous member allowed
reset role;
update public.profiles
set anonymous_expires_at = now() + interval '1 hour'
where id = 'b2222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  (public.get_group_recovery_snapshot('bgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ? 'realtime_revision'),
  'unexpired anonymous member can load recovery snapshot'
);

select * from finish();
rollback;
