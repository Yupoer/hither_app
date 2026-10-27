begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select no_plan();
select is((select md5(prosrc) from pg_proc where oid='public.get_group_recovery_snapshot(uuid)'::regprocedure),
  'ed39e400b79f9cb8c284ecdd11ea878d', 'legacy function body remains byte-identical to ae797c1');
select is((select proacl::text from pg_proc where oid='public.get_group_recovery_snapshot(uuid)'::regprocedure),
  '{postgres=X/postgres,authenticated=X/postgres}', 'legacy execute ACL remains unchanged');
select is((select jsonb_build_object('security_definer',prosecdef,'volatility',provolatile,
  'configuration',proconfig,'return_type',prorettype::regtype::text)
  from pg_proc where oid='public.get_group_recovery_snapshot(uuid)'::regprocedure),
  '{"security_definer":true,"volatility":"s","configuration":["search_path=\"\""],"return_type":"jsonb"}'::jsonb,
  'legacy execution attributes remain unchanged');
select is(obj_description('public.get_group_recovery_snapshot(uuid)'::regprocedure, 'pg_proc'),
  'Single read snapshot for recovery; callers must merge by realtime_revision/entity_version.',
  'legacy RPC comment remains unchanged');
select is(pg_get_function_identity_arguments('public.get_group_recovery_snapshot(uuid)'::regprocedure),
  'p_group_id uuid', 'legacy signature remains unchanged');
select ok(not has_function_privilege('anon', 'public.get_group_recovery_snapshot(uuid)', 'EXECUTE'),
  'legacy anon execute remains denied');
select ok(has_function_privilege('authenticated', 'public.get_group_recovery_snapshot(uuid)', 'EXECUTE'),
  'legacy authenticated execute remains granted');
select ok(not has_function_privilege('service_role', 'public.get_group_recovery_snapshot(uuid)', 'EXECUTE'),
  'legacy service role execute remains unchanged');

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

reset role;
select throws_ok(
  $$select public.get_group_recovery_snapshot(
    'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )$$,
  '28000',
  null,
  'unauthenticated cannot call get_group_recovery_snapshot'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  (public.get_group_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ? 'schema_version'),
  'member snapshot has schema_version'
);

select ok(
  (public.get_group_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ?& array[
      'group', 'memberships', 'profiles', 'subgroups',
      'itinerary', 'locations', 'entity_versions', 'realtime_revision'
    ]),
  'member snapshot includes all recovery families'
);

select is(
  public.get_group_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    -> 'group' ->> 'id',
  'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'member snapshot group id matches'
);

select set_config('request.jwt.claim.sub', 'b3333333-3333-4333-8333-333333333333', true);

select throws_ok(
  $$select public.get_group_recovery_snapshot(
    'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )$$,
  '42501',
  null,
  'non-member cannot call get_group_recovery_snapshot'
);

select set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);

select ok(
  not extensions.is_member('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'expired anonymous is_member false despite memberships row'
);

select throws_ok(
  $$select public.get_group_recovery_snapshot(
    'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )$$,
  '42501',
  null,
  'expired anonymous cannot call get_group_recovery_snapshot'
);

reset role;
update public.profiles
set anonymous_expires_at = now() + interval '1 hour'
where id = 'b2222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  (public.get_group_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ? 'realtime_revision'),
  'unexpired anonymous member can load recovery snapshot'
);

select is(
  public.get_group_recovery_snapshot('baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->'profiles',
  (select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p
   where p.id in ('b1111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222')),
  'legacy snapshot retains full authoritative rows for self and peer');
select ok(not exists (
  select 1 from jsonb_array_elements(public.get_group_recovery_snapshot(
    'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->'profiles') profile
  where not (profile ?& array['preferences','onboarding','created_at','pro','pro_plan',
    'pro_purchased_at','pro_expires_at','anonymous_expires_at'])
), 'legacy full rows retain private fields and metadata');
select * from finish();
rollback;
