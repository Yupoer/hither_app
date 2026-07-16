begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_table('public', 'navigation_sessions', 'navigation_sessions exists');
select has_table('public', 'navigation_member_states', 'navigation_member_states exists');

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'leader@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'follower@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'outsider@example.test');

insert into public.groups (id, name, invite_code, created_by) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Test trip',
  'NAVTST',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.memberships (group_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'leader'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'follower');

insert into public.itinerary_items (
  id, group_id, title, latitude, longitude, position
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Station',
  25.0478,
  121.517,
  0
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

create temporary table test_session as
select (public.start_navigation_session(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
)).id;

select is(
  (select count(*) from public.navigation_sessions
    where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1::bigint,
  'leader creates one session'
);

select is(
  (public.start_navigation_session(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  )).id,
  (select id from test_session),
  'same request id returns the existing session'
);

select is(
  (select count(*) from public.navigation_member_states
    where navigation_session_id = (select id from test_session)),
  2::bigint,
  'session seeds every group member state'
);

select throws_ok(
  $$ select public.start_navigation_session(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  ) $$,
  '55000',
  'active navigation session exists',
  'a group cannot have two active sessions'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select lives_ok(
  format(
    'select public.ack_navigation_session(%L, %L, %L::jsonb)',
    (select id from test_session),
    'tracking_active',
    '{"source":"realtime"}'
  ),
  'member can acknowledge its own state'
);

select is(
  (select local_status from public.navigation_member_states
    where navigation_session_id = (select id from test_session)
      and user_id = '22222222-2222-4222-8222-222222222222'),
  'tracking_active',
  'ack updates only the current member state'
);

insert into public.member_privacy_settings (user_id, sharing_enabled)
values ('22222222-2222-4222-8222-222222222222', false);

select is(
  public.ingest_location_batch(jsonb_build_array(jsonb_build_object(
    'id', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'groupId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'navigationSessionId', (select id from test_session),
    'capturedAt', 1000,
    'coords', jsonb_build_object('latitude', 25.04, 'longitude', 121.5, 'accuracy', 10),
    'trackingMode', 'teamNavigation', 'source', 'background_task', 'sequence', 1
  )))->'rejected'->0->>'reason',
  'sharing_disabled',
  'privacy setting rejects location ingestion'
);

update public.member_privacy_settings set sharing_enabled = true
where user_id = '22222222-2222-4222-8222-222222222222';

select is(
  jsonb_array_length(public.ingest_location_batch(jsonb_build_array(jsonb_build_object(
    'id', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'groupId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'navigationSessionId', (select id from test_session),
    'capturedAt', 2000,
    'coords', jsonb_build_object('latitude', 25.04, 'longitude', 121.5, 'accuracy', 10),
    'trackingMode', 'teamNavigation', 'source', 'background_task', 'sequence', 1
  )))->'acceptedIds'),
  1,
  'enabled sharing accepts a location event'
);

select lives_ok(
  format(
    'select public.ingest_location_batch(%L::jsonb)',
    jsonb_build_array(jsonb_build_object(
      'id', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'groupId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'navigationSessionId', (select id from test_session),
      'capturedAt', 2000,
      'coords', jsonb_build_object('latitude', 25.04, 'longitude', 121.5, 'accuracy', 10),
      'trackingMode', 'teamNavigation', 'source', 'background_task', 'sequence', 1
    ))
  ),
  'duplicate location event does not raise'
);

select is(
  (select count(*) from public.location_upload_events
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  1::bigint,
  'duplicate location event id is idempotent'
);

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);

select is(
  (select count(*) from public.navigation_sessions),
  0::bigint,
  'outsider cannot read the group session'
);

select throws_ok(
  $$ select public.start_navigation_session(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    gen_random_uuid()
  ) $$,
  'P0002',
  'group not found',
  'outsider cannot start a session'
);

select * from finish();
rollback;
