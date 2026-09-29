-- Transactional integration test; all fixtures and operation receipts are rolled back.
begin;
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

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
do $$
declare
  g uuid := 'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  actor uuid := 'a1111111-1111-4111-8111-111111111111';
  point uuid := 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0001';
  first_session uuid := 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0101';
  next_session uuid := 'aeeeeeee-eeee-4eee-8eee-eeeeeeee0102';
  result jsonb;
  session public.navigation_sessions;
begin
  session := public.start_navigation_session(g, point, first_session);
  assert session.id = first_session, 'start fixture failed';
  result := public.apply_core_operation_v3(gen_random_uuid(), g, actor,
    'active_gathering', g::text, 0, 'end_gathering',
    jsonb_build_object('navigationSessionId', first_session, 'activeDestinationId', point), 1);
  assert result->>'status' = 'accepted', result::text;
  assert (select status = 'cancelled' from public.navigation_sessions where id = first_session), 'session remains active';
  assert (select active_session_id is null from public.navigation_scope_states where group_id = g and scope_key = 'main'), 'scope remains active';
  assert (select active_destination_id is null from public.groups where id = g), 'group remains active';

  result := public.apply_core_operation_v3(gen_random_uuid(), g, actor,
    'active_gathering', g::text, 0, 'end_gathering',
    jsonb_build_object('navigationSessionId', first_session, 'activeDestinationId', point), 2);
  assert result->>'status' = 'accepted', 'repeat end rejected: ' || result::text;

  session := public.start_navigation_session(g, point, next_session);
  assert session.id = next_session, 'second start failed';
  update public.navigation_sessions set started_at = started_at + interval '1 second' where id = next_session returning * into session;
  result := public.apply_core_operation_v3(gen_random_uuid(), g, actor,
    'active_gathering', g::text, 0, 'end_gathering',
    jsonb_build_object('navigationSessionId', first_session, 'activeDestinationId', point), 3);
  assert result->>'status' = 'accepted', result::text;
  assert (select status = 'active' from public.navigation_sessions where id = next_session), 'old end cancelled new session';
  assert (select active_session_id = next_session from public.navigation_scope_states where group_id = g and scope_key = 'main'), 'old end cleared new scope';
  assert (select journey_status = 'going' from public.groups where id = g), 'old end paused current group';

  result := public.apply_core_operation_v3(gen_random_uuid(), g, actor,
    'active_gathering', g::text, 0, 'end_gathering',
    jsonb_build_object('navigationSessionId', gen_random_uuid(), 'activeDestinationId', point), 4);
  assert result->>'status' = 'accepted', 'missing session rejected: ' || result::text;
  result := public.apply_core_operation_v3(gen_random_uuid(), g, actor,
    'active_gathering', g::text, 0, 'end_gathering',
    jsonb_build_object('activeDestinationId', point), 5);
  assert result->>'status' = 'conflict' and result->'conflict'->>'code' = 'dependency_missing', 'unknown identity falsely accepted: ' || result::text;
  assert (select active_session_id = next_session from public.navigation_scope_states where group_id = g and scope_key = 'main'), 'unknown end closed current session';
  result := public.apply_core_operation_v3(gen_random_uuid(), g, actor,
    'active_gathering', g::text, 0, 'end_gathering',
    jsonb_build_object('activeDestinationId', point, 'expectedSessionStartedAt', to_timestamp(((extract(epoch from session.started_at) * 1000)::bigint)::double precision / 1000)), 6);
  assert result->>'status' = 'accepted', 'legacy identity end rejected: ' || result::text;
  assert (select status = 'cancelled' from public.navigation_sessions where id = next_session), 'legacy identity did not close session';
end;
$$;
rollback;
