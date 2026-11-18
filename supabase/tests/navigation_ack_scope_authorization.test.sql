begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(19);

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'ack-leader@example.test'),
  ('a2222222-2222-4222-8222-222222222222', 'ack-lane-member@example.test'),
  ('a3333333-3333-4333-8333-333333333333', 'ack-lane-peer@example.test'),
  ('a4444444-4444-4444-8444-444444444444', 'ack-sibling@example.test');

insert into public.groups (id, name, invite_code, created_by) values (
  'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ACK authorization',
  'ACK001',
  'a1111111-1111-4111-8111-111111111111'
);

insert into public.subgroups (id, group_id, name, mode, leader_id) values
  (
    'a0bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Lane one',
    'led',
    'a2222222-2222-4222-8222-222222222222'
  ),
  (
    'a0bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Lane two',
    'led',
    'a4444444-4444-4444-8444-444444444444'
  );

insert into public.memberships (group_id, user_id, role, subgroup_id) values
  (
    'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a1111111-1111-4111-8111-111111111111',
    'leader',
    null
  ),
  (
    'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a2222222-2222-4222-8222-222222222222',
    'follower',
    'a0bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ),
  (
    'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a3333333-3333-4333-8333-333333333333',
    'follower',
    'a0bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ),
  (
    'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a4444444-4444-4444-8444-444444444444',
    'leader',
    'a0bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  );

insert into public.itinerary_items (
  id, group_id, title, latitude, longitude, position, day, subgroup_id
) values (
  'a0cccccc-cccc-4ccc-8ccc-cccccccccccc',
  'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Lane one stop',
  25.0478,
  121.517,
  0,
  1,
  'a0bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
);

insert into public.navigation_sessions (
  id, group_id, destination_id, destination_name,
  destination_latitude, destination_longitude, started_by, request_id,
  expires_at, scope_subgroup_id, scope_key
) values (
  'a0dddddd-dddd-4ddd-8ddd-dddddddddddd',
  'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'a0cccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Lane one stop',
  25.0478,
  121.517,
  'a2222222-2222-4222-8222-222222222222',
  'a0eeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  now() + interval '1 hour',
  'a0bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'a0bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
);

delete from public.navigation_member_states
where navigation_session_id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd'
  and user_id not in (
    'a2222222-2222-4222-8222-222222222222',
    'a3333333-3333-4333-8333-333333333333'
  );

select ok(
  not has_table_privilege('authenticated', 'public.navigation_member_states', 'INSERT'),
  'authenticated cannot create navigation roster rows directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.navigation_member_states', 'UPDATE')
  and not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.navigation_member_states'::regclass
      and attnum > 0 and not attisdropped
      and attname not in ('local_status', 'detail', 'updated_at')
      and has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')
  ),
  'terminal cleanup cannot change roster identity, telemetry or acknowledgment and arrival history'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a4444444-4444-4444-8444-444444444444',
  true
);

select throws_ok(
  $$insert into public.navigation_member_states (navigation_session_id, user_id)
    values (
      'a0dddddd-dddd-4ddd-8ddd-dddddddddddd',
      'a4444444-4444-4444-8444-444444444444'
    )$$,
  '42501',
  null,
  'a sibling lane member cannot add itself to the projected roster'
);
select throws_ok(
  $$select public.ack_navigation_session(
    'a0dddddd-dddd-4ddd-8ddd-dddddddddddd',
    'arrived',
    '{"source":"sibling"}'::jsonb
  )$$,
  'P0002',
  'navigation session not found',
  'a sibling lane member cannot acknowledge another lane session'
);
select is(
  (
    select count(*)
    from public.navigation_member_states
    where navigation_session_id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd'
      and user_id = 'a4444444-4444-4444-8444-444444444444'
  ),
  0::bigint,
  'a rejected sibling acknowledgment creates no member state'
);
select is(
  (
    select count(*)
    from public.destination_arrivals
    where destination_id = 'a0cccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  0::bigint,
  'a rejected sibling acknowledgment creates no arrival'
);
with changed as (
  update public.navigation_member_states
  set local_status = 'arrived'
  where navigation_session_id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd'
    and user_id = 'a2222222-2222-4222-8222-222222222222'
  returning 1
)
select is(
  (select count(*) from changed),
  0::bigint,
  'a sibling lane leader cannot rewrite another lane roster'
);

select set_config(
  'request.jwt.claim.sub',
  'a2222222-2222-4222-8222-222222222222',
  true
);
with changed as (
  update public.navigation_member_states
  set local_status = 'offline'
  where navigation_session_id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd'
    and user_id = 'a2222222-2222-4222-8222-222222222222'
  returning 1
)
select is(
  (select count(*) from changed),
  0::bigint,
  'a projected member cannot bypass the acknowledgment RPC with a direct update'
);
select lives_ok(
  $$select public.ack_navigation_session(
    'a0dddddd-dddd-4ddd-8ddd-dddddddddddd',
    'tracking_active',
    '{"source":"foreground"}'::jsonb
  )$$,
  'a projected same-lane member can acknowledge an active session'
);
select is(
  (
    select local_status
    from public.navigation_member_states
    where navigation_session_id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd'
      and user_id = 'a2222222-2222-4222-8222-222222222222'
  ),
  'tracking_active',
  'a legitimate acknowledgment updates the projected member state'
);
select lives_ok(
  $$select public.ack_navigation_session(
    'a0dddddd-dddd-4ddd-8ddd-dddddddddddd',
    'arrived',
    '{"source":"foreground"}'::jsonb
  )$$,
  'a projected same-lane member can record an active arrival'
);
select is(
  (
    select count(*)
    from public.destination_arrivals
    where destination_id = 'a0cccccc-cccc-4ccc-8ccc-cccccccccccc'
      and user_id = 'a2222222-2222-4222-8222-222222222222'
  ),
  1::bigint,
  'a legitimate active arrival keeps its durable arrival effect'
);

reset role;
update public.navigation_sessions
set status = 'cancelled', ended_at = now()
where id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a2222222-2222-4222-8222-222222222222',
  true
);
select throws_ok(
  $$select public.ack_navigation_session(
    'a0dddddd-dddd-4ddd-8ddd-dddddddddddd',
    'offline',
    '{}'::jsonb
  )$$,
  'P0002',
  'navigation session not found',
  'a cancelled session rejects current member acknowledgments'
);
with changed as (
  update public.navigation_member_states
  set local_status = 'offline'
  where navigation_session_id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd'
    and user_id = 'a2222222-2222-4222-8222-222222222222'
  returning 1
)
select is(
  (select count(*) from changed),
  0::bigint,
  'a cancelled session state cannot be rewritten directly'
);

reset role;
update public.memberships
set role = 'leader'
where group_id = 'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = 'a2222222-2222-4222-8222-222222222222';
set local role authenticated;
with changed as (
  update public.navigation_member_states
  set local_status = 'missed'
  where navigation_session_id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd'
  returning user_id
)
select is(
  (select array_agg(user_id) from changed),
  array['a3333333-3333-4333-8333-333333333333'::uuid],
  'terminal cleanup marks only the scoped member without an arrival as missed'
);

reset role;
update public.navigation_sessions
set status = 'active', ended_at = null, expires_at = now() - interval '1 minute'
where id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a2222222-2222-4222-8222-222222222222',
  true
);
select throws_ok(
  $$select public.ack_navigation_session(
    'a0dddddd-dddd-4ddd-8ddd-dddddddddddd',
    'offline',
    '{}'::jsonb
  )$$,
  'P0002',
  'navigation session not found',
  'an elapsed active session rejects current member acknowledgments'
);

reset role;
update public.navigation_sessions
set expires_at = now() + interval '1 hour'
where id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd';
update public.memberships
set subgroup_id = 'a0bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
where group_id = 'a0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = 'a2222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a2222222-2222-4222-8222-222222222222',
  true
);
select throws_ok(
  $$select public.ack_navigation_session(
    'a0dddddd-dddd-4ddd-8ddd-dddddddddddd',
    'offline',
    '{}'::jsonb
  )$$,
  'P0002',
  'navigation session not found',
  'a projected member that moved lanes cannot acknowledge the old lane'
);
select is(
  (
    select local_status
    from public.navigation_member_states
    where navigation_session_id = 'a0dddddd-dddd-4ddd-8ddd-dddddddddddd'
      and user_id = 'a2222222-2222-4222-8222-222222222222'
  ),
  'arrived',
  'rejected terminal expiry and scope paths preserve the last valid state'
);
select is(
  (
    select count(*)
    from public.destination_arrivals
    where destination_id = 'a0cccccc-cccc-4ccc-8ccc-cccccccccccc'
      and user_id = 'a2222222-2222-4222-8222-222222222222'
  ),
  1::bigint,
  'rejected terminal expiry and scope paths add no arrival effects'
);

select * from finish();
rollback;
