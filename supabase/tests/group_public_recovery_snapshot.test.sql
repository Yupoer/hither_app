begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select no_plan();
select has_function('public', 'get_group_public_recovery_snapshot', array['uuid'],
  'public recovery endpoint exists independently of the legacy endpoint');
select ok(not has_function_privilege('anon', 'public.get_group_public_recovery_snapshot(uuid)', 'EXECUTE'),
  'anon cannot execute public recovery');
select ok(has_function_privilege('authenticated', 'public.get_group_public_recovery_snapshot(uuid)', 'EXECUTE'),
  'authenticated can request public recovery subject to membership');
select ok(not has_function_privilege('service_role', 'public.get_group_public_recovery_snapshot(uuid)', 'EXECUTE'),
  'service role has no additional public recovery execute grant');
select is((select jsonb_build_object('security_definer',prosecdef,'volatility',provolatile,
  'configuration',proconfig,'return_type',prorettype::regtype::text)
  from pg_proc where oid='public.get_group_public_recovery_snapshot(uuid)'::regprocedure),
  '{"security_definer":true,"volatility":"s","configuration":["search_path=\"\""],"return_type":"jsonb"}'::jsonb,
  'public recovery retains guarded definer execution and empty search path');

insert into auth.users (id, email, is_anonymous) values
  ('b1111111-1111-4111-8111-111111111111', 'snap-leader@example.test', false),
  ('b2222222-2222-4222-8222-222222222222', 'snap-anon@example.test', true),
  ('b3333333-3333-4333-8333-333333333333', 'snap-outsider@example.test', false);

insert into public.profiles (id, nickname, preferences, onboarding) values
  ('b1111111-1111-4111-8111-111111111111', 'SnapLeader', '{"private":"leader"}', '{"private":"leader"}'),
  ('b2222222-2222-4222-8222-222222222222', 'SnapAnon', '{"private":"peer"}', '{"private":"peer"}'),
  ('b3333333-3333-4333-8333-333333333333', 'SnapOutsider', '{}', '{}');

insert into public.groups (id, name, invite_code, created_by) values (
  'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Snapshot trip',
  'SNP001',
  'b1111111-1111-4111-8111-111111111111'
);

insert into public.memberships (group_id, user_id, role, created_at) values
  (
    'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b1111111-1111-4111-8111-111111111111',
    'leader',
    now() - interval '20 days'
  ),
  (
    'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b2222222-2222-4222-8222-222222222222',
    'follower',
    now() - interval '20 days'
  );

select public.allow_anonymous_expiry_write();
update public.profiles
set anonymous_expires_at = now() - interval '1 hour'
where id = 'b2222222-2222-4222-8222-222222222222';

insert into public.itinerary_items (
  id, group_id, title, latitude, longitude, position
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Stop',
  25.0,
  121.0,
  0
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.get_group_public_recovery_snapshot(
    'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )$$,
  '28000',
  null,
  'unauthenticated cannot call get_group_public_recovery_snapshot'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  (public.get_group_public_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ? 'schema_version'),
  'member snapshot has schema_version'
);

select ok(
  (public.get_group_public_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ?& array[
      'group', 'memberships', 'profiles', 'subgroups',
      'itinerary', 'locations', 'entity_versions', 'realtime_revision'
    ]),
  'member snapshot includes all recovery families'
);

select is(
  public.get_group_public_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    -> 'group' ->> 'id',
  'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'member snapshot group id matches'
);

select is((public.get_group_public_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'schema_version'),
  'group-recovery-v1', 'public recovery retains the existing layout version');

select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.get_group_public_recovery_snapshot(
      'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )->'profiles') profile
    where (select array_agg(key order by key collate "C") from jsonb_object_keys(profile) key)
      is distinct from array['avatar', 'avatar_color', 'id', 'nickname']::text[]
  ),
  'every recovery profile contains exactly the public fields, including self'
);

select set_config('request.jwt.claim.sub', 'b3333333-3333-4333-8333-333333333333', true);

select throws_ok(
  $$select public.get_group_public_recovery_snapshot(
    'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )$$,
  '42501',
  null,
  'non-member cannot call get_group_public_recovery_snapshot'
);

select set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);

select ok(
  not extensions.is_member('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'expired anonymous is_member false despite memberships row'
);

select throws_ok(
  $$select public.get_group_public_recovery_snapshot(
    'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )$$,
  '42501',
  null,
  'expired anonymous cannot call get_group_public_recovery_snapshot'
);

reset role;
update public.profiles
set anonymous_expires_at = now() + interval '1 hour'
where id = 'b2222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  (public.get_group_public_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ? 'realtime_revision'),
  'unexpired anonymous member can load recovery snapshot'
);

select is(
  public.get_group_public_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') - 'profiles',
  public.get_group_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') - 'profiles',
  'public recovery preserves every non-profile response value');
select * from finish();
rollback;
