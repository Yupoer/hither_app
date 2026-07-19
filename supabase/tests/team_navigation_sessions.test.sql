begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(37);

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
), (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Next station',
  25.0488,
  121.518,
  1
), (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Third station',
  25.0498,
  121.519,
  2
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

select is(
  (public.start_navigation_session(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  )).id,
  (select id from test_session),
  'same active destination returns the active session'
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

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  format(
    'select public.ack_navigation_session(%L, %L, %L::jsonb)',
    (select id from test_session),
    'arrived',
    '{"source":"foreground"}'
  ),
  'leader arrival ACK is accepted'
);
select is(
  (select local_status from public.navigation_member_states
    where navigation_session_id = (select id from test_session)
      and user_id = '11111111-1111-4111-8111-111111111111'),
  'arrived',
  'arrived member remains arrived when session later closes'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

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

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
create temporary table switched_session as
select (public.start_navigation_session(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
)).id;

select is(
  (select status from public.navigation_sessions where id = (select id from test_session)),
  'completed',
  'switching destination completes the previous session atomically'
);
select is(
  (select closed_at is not null from public.itinerary_items
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  true,
  'switching destination closes the previous itinerary item'
);
select is(
  (select position from public.itinerary_items
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'switching destination does not reorder the previous item'
);
select is(
  (select position from public.itinerary_items
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  1,
  'switching destination preserves the next item position'
);
select is(
  (select local_status from public.navigation_member_states
    where navigation_session_id = (select id from test_session)
      and user_id = '22222222-2222-4222-8222-222222222222'),
  'missed',
  'members without arrival become missed on switch'
);
select is(
  (select local_status from public.navigation_member_states
    where navigation_session_id = (select id from test_session)
      and user_id = '11111111-1111-4111-8111-111111111111'),
  'arrived',
  'arrived members are not rewritten as missed on switch'
);
select is(
  (select count(*) from public.navigation_sessions
    where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status = 'active'),
  1::bigint,
  'a group has one active session after a switch'
);
select is(
  (select destination_id from public.navigation_sessions where id = (select id from switched_session)),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
  'switch creates the requested next session'
);

select is(
  (public.complete_navigation_session(
    (select id from switched_session), 1
  )).status,
  'completed',
  'completing navigation closes the current session'
);
select is(
  (select closed_at is not null from public.itinerary_items
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  true,
  'completing navigation closes the destination'
);

create temporary table cancelled_session as
select (public.start_navigation_session(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  'ffffffff-ffff-4fff-8fff-ffffffffffff'
)).id;
select is(
  (public.cancel_navigation_session(
    (select id from cancelled_session), 1
  )).status,
  'cancelled',
  'cancelling navigation stops the session'
);
select is(
  (select closed_at is null from public.itinerary_items
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'),
  true,
  'cancelling navigation does not close the destination'
);

select is(
  (public.complete_navigation_session(
    (select id from switched_session), 1
  )).status,
  'completed',
  'replaying complete returns the already-completed session'
);

select is(
  (select version from public.navigation_sessions
   where id = (select id from switched_session)),
  2,
  'replaying complete does not increment the terminal version'
);

select is(
  (public.cancel_navigation_session(
    (select id from cancelled_session), 1
  )).status,
  'cancelled',
  'replaying cancel returns the already-cancelled session'
);

select is(
  (select version from public.navigation_sessions
   where id = (select id from cancelled_session)),
  2,
  'replaying cancel does not increment the terminal version'
);

select throws_ok(
  format(
    'select public.complete_navigation_session(%L, 1)',
    (select id from cancelled_session)
  ),
  'P0001',
  'navigation session is already cancelled',
  'complete does not claim success for a cancelled session'
);

-- bbb3 is still open after cancel (cancel does not close the stop); do not
-- reuse bbbb...bbbb / bbb2 which were closed by switch/complete.
create temporary table active_stale_session as
select (public.start_navigation_session(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  '99999999-9999-4999-8999-999999999999'
)).id;

select throws_ok(
  format(
    'select public.cancel_navigation_session(%L, 0)',
    (select id from active_stale_session)
  ),
  '40001',
  'active navigation session version mismatch',
  'a genuinely stale active version still raises 40001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$ select public.set_destination_arrival_at(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    true,
    null
  ) $$,
  'a missed member can be corrected after the stop is closed'
);
select is(
  (select local_status from public.navigation_member_states
    where navigation_session_id = (select id from test_session)
      and user_id = '22222222-2222-4222-8222-222222222222'),
  'arrived',
  'correction changes missed to arrived'
);
select is(
  (select closed_at is not null from public.itinerary_items
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  true,
  'correcting a missed member does not reopen the stop'
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
