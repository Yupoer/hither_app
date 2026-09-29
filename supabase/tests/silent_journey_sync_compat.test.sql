-- Real SQL coverage for the legacy navigation RPC wrappers installed by v3.
-- They keep their old signatures but are restricted to the main scope.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(15);

insert into auth.users(id, email) values
 ('a1111111-1111-4111-8111-111111111111', 'compat-leader@example.test'),
 ('a3333333-3333-4333-8333-333333333333', 'compat-subleader@example.test');
insert into public.groups(id, name, invite_code, created_by) values
 ('aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'compat journey', 'COMPATV3',
  'a1111111-1111-4111-8111-111111111111');
insert into public.memberships(group_id, user_id, role) values
 ('aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'a1111111-1111-4111-8111-111111111111', 'leader');
insert into public.subgroups(id, group_id, name, mode, leader_id) values (
 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c01',
 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'compat small team', 'led',
 'a3333333-3333-4333-8333-333333333333');
insert into public.memberships(group_id, user_id, role, subgroup_id) values (
 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'a3333333-3333-4333-8333-333333333333',
 'leader', 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c01');
insert into public.itinerary_items(id, group_id, subgroup_id, title, latitude,
 longitude, position, day, kind) values
 ('aeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  null, 'main one', 25, 121, 0, 1, 'stop'),
 ('aeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  null, 'main two', 25.1, 121.1, 1, 1, 'stop'),
 ('aeeeeeee-eeee-4eee-8eee-eeeeeeee0c02', 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c01', 'small team point', 25.2, 121.2, 0, 1, 'stop');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);

select ok(
  (public.start_navigation_session(
    'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'aeeeeeee-eeee-4eee-8eee-eeeeeeee0001',
    'aeeeeeee-eeee-4eee-8eee-eeeeeeee0101'
  )).id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0101'::uuid,
  'legacy start keeps request id as session id');
select ok(
  (public.start_navigation_session(
    'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'aeeeeeee-eeee-4eee-8eee-eeeeeeee0001',
    'aeeeeeee-eeee-4eee-8eee-eeeeeeee0101'
  )).id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0101'::uuid,
  'legacy start replay is idempotent');

select set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', true);
select is(
  (public.apply_core_operation_v3(
    'aeeeeeee-eeee-4eee-8eee-eeeeeeee0110',
    'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'a3333333-3333-4333-8333-333333333333',
    'active_gathering', 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'start_gathering',
    jsonb_build_object('activeDestinationId', 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c02',
      'subgroupId', 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c01',
      'navigationRequestId', 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0110'),
    1, '{}'::uuid[]
  )->>'status'), 'accepted', 'subgroup session is independently active');

select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
select ok(
  (public.start_navigation_session_switch(
    'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'aeeeeeee-eeee-4eee-8eee-eeeeeeee0002',
    'aeeeeeee-eeee-4eee-8eee-eeeeeeee0102'
  )).id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0102'::uuid,
  'legacy switch starts only the main-team lane');
select ok(
  exists (select 1 from public.navigation_sessions
          where group_id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
            and scope_key = 'main' and status = 'active'
            and destination_id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0002')
  and exists (select 1 from public.navigation_sessions
              where group_id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
                and scope_key = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c01'
                and status = 'active'),
  'main switch did not cancel subgroup session');

-- The previous assertion intentionally uses the exact subgroup request id,
-- while the scope key query is checked separately below for readability.
select ok(
  exists (select 1 from public.navigation_sessions
          where id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0110'
            and scope_subgroup_id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c01'
            and status = 'active'),
  'subgroup session retains its own active status');

select is(
  (public.apply_core_operation_v2(
    'aeeeeeee-eeee-4eee-8eee-eeeeeeee0103',
    'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'a1111111-1111-4111-8111-111111111111',
    'active_gathering', 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'end_gathering',
    jsonb_build_object('activeDestinationId', 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0002'),
    3, '{}'::uuid[]
  )->>'status'), 'accepted', 'v2 end accepts original main session');
select ok(
  (select status = 'cancelled' from public.navigation_sessions
   where id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0102')
  and (select status = 'active' from public.navigation_sessions
       where id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0110'),
  'v2 end leaves subgroup session active');
select is(
  (public.apply_core_operation_v2(
    'aeeeeeee-eeee-4eee-8eee-eeeeeeee0103',
    'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'a1111111-1111-4111-8111-111111111111',
    'active_gathering', 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'end_gathering',
    jsonb_build_object('activeDestinationId', 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0002'),
    3, '{}'::uuid[]
  )->>'status'), 'duplicate', 'v2 replay keeps one operation receipt');
select set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', true);
select is(
  (public.apply_core_operation_v2(
    'aeeeeeee-eeee-4eee-8eee-eeeeeeee0111',
    'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'a3333333-3333-4333-8333-333333333333',
    'active_gathering', 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'end_gathering',
    jsonb_build_object('activeDestinationId', 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c02',
      'subgroupId', 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c01'),
    2, '{}'::uuid[]
  )->>'status'), 'accepted', 'v2 end infers subgroup session from old payload');
select ok(
  (select status = 'cancelled' from public.navigation_sessions
   where id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0110'),
  'subgroup v2 end closes only its own session');
delete from public.memberships
where group_id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  and user_id = 'a3333333-3333-4333-8333-333333333333';
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
select ok(
  not exists (select 1 from public.subgroups
             where id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c01'),
  'empty subgroup is removed');
select ok(
  not exists (select 1 from public.itinerary_items
             where id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c02'),
  'empty subgroup destinations are removed');
select ok(
  exists (select 1 from public.subgroup_cleanup_audit
          where group_id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
            and subgroup_id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0c01'
            and reason = 'empty_subgroup'),
  'empty subgroup leaves a minimal audit record');
select is(
  (select status from public.core_operations
   where operation_id = 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0110'),
  'conflict', 'subgroup operations are terminal after cleanup');

select * from finish();
rollback;
