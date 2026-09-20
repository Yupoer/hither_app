-- Executable PG17/pgTAP coverage for silent journey sync v3.
-- Run with: supabase test db --local supabase/tests/silent_journey_sync_v3.test.sql
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(63);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'v3-leader@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'v3-follower@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'v3-subleader@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'v3-submember@example.test');

insert into public.groups (id, name, invite_code, created_by) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'v3 journey', 'V3JOURNEY',
  '11111111-1111-4111-8111-111111111111'
);
insert into public.memberships (group_id, user_id, role) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 'leader'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '22222222-2222-4222-8222-222222222222', 'follower');
insert into public.subgroups (id, group_id, name, mode, leader_id) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'v3 subgroup', 'led',
  '33333333-3333-4333-8333-333333333333'
);
insert into public.memberships (group_id, user_id, role, subgroup_id) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '33333333-3333-4333-8333-333333333333', 'leader',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '44444444-4444-4444-8444-444444444444', 'follower',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01');
insert into public.itinerary_items (
  id, group_id, subgroup_id, title, latitude, longitude, position, day, kind
) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null,
   'main one', 25.0478, 121.5170, 0, 1, 'stop'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null,
   'main two', 25.0488, 121.5180, 1, 1, 'stop'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null,
   'main three', 25.0498, 121.5190, 2, 1, 'stop'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0c02', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01', 'sub point', 25.0508, 121.5200, 0, 1, 'stop');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select ok(
  to_regprocedure('public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamp with time zone)') is not null,
  'v3 RPC preserves the v2 argument contract'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'trg_itinerary_coordinates_immutable'),
  'coordinate immutability trigger exists'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'navigation_arrival_events_operation_id_fkey'),
  'arrival event operation FK exists'
);

-- Main start: subgroupId is null and scope is omitted.  The request id is the
-- session id; no server-generated random session may be used.
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'start_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001',
      'subgroupId', null, 'navigationRequestId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101'),
    1, '{}'::uuid[]
  )->>'status'), 'accepted', 'main start accepted');
select is(
  (select id from public.navigation_sessions where request_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101'),
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101'::uuid,
  'start uses navigationRequestId as session id'
);
select ok(
  (select state->>'journeyPhase' from public.core_entity_versions
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and entity_type = 'active_gathering'
     and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') = 'en_route',
   'start returns the active gathering contract'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

-- A completed/cancelled session still accepts a late arrival into its own
-- history, and never rebinds a new active session.
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0301',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true,
      'arrivedAt', '2026-09-20T10:00:00Z'),
    2, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0101'::uuid]
  )->>'status'), 'accepted', 'arrival in active session accepted');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0102',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1,
    'end_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001',
      'navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101'),
    3, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0101'::uuid]
  )->>'status'), 'accepted', 'end binds to the original session');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0103',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 2,
    'start_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001',
      'subgroupId', null, 'navigationRequestId', 'eeeeeeee-eeee-eeee-8eee-eeeeeeee0103'),
    4, '{}'::uuid[]
  )->>'status'), 'accepted', 'new session can replace ended session');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0302',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true,
      'arrivedAt', '2026-09-20T11:00:00Z'),
    5, '{}'::uuid[]
  )->>'status'), 'accepted', 'late arrival on ended session accepted');
select ok(
  (select count(*) from public.navigation_session_history
   where navigation_session_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101'
     and user_id = '22222222-2222-4222-8222-222222222222'
     and arrived_at = '2026-09-20T11:00:00Z') = 1
  and not exists (select 1 from public.destination_arrivals
                  where destination_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'
                    and user_id = '22222222-2222-4222-8222-222222222222'
                    and navigation_session_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101'),
  'late ended-session arrival writes history only'
);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- Complete a main session, then accept an arrival after completion and a
-- leader correction with arrivedAt NULL.  An older event cannot overwrite the
-- later correction projection.
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0104',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 3,
    'start_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002',
      'navigationRequestId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0104'),
    6, '{}'::uuid[]
  )->>'status'), 'accepted', 'second destination start accepted');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0105',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 4,
    'complete_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002',
      'navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0104'),
    7, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0104'::uuid]
  )->>'status'), 'accepted', 'completion closes the session');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0303',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0104',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true,
      'arrivedAt', '2026-09-20T12:00:00Z'),
    8, '{}'::uuid[]
  )->>'status'), 'accepted', 'late completed-session arrival accepted');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0304',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0104',
      'userId', '22222222-2222-4222-8222-222222222222',
      'source', 'leader_correction', 'arrived', true, 'note', 'manual audit'),
    9, '{}'::uuid[]
  )->>'status'), 'accepted', 'leader correction through record_arrival accepted');
select ok(
  (select arrived_at is null and source = 'leader_correction'
   and corrected_by = '11111111-1111-4111-8111-111111111111'::uuid
   from public.destination_arrivals
   where destination_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002'
     and user_id = '22222222-2222-4222-8222-222222222222'),
  'leader correction keeps arrivedAt null and audit actor'
);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0305',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0104',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', false,
      'occurredAt', '2026-01-01T00:00:00Z'),
    10, '{}'::uuid[]
  )->>'status'), 'accepted', 'out-of-order old event is retained');
select ok(
  (select arrived_at is null and source = 'leader_correction'
   from public.destination_arrivals
   where destination_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002'
     and user_id = '22222222-2222-4222-8222-222222222222'),
  'older event cannot overwrite newer correction projection'
);

-- Subgroup scope is independent and inferred from subgroupId alone.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0110',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '33333333-3333-4333-8333-333333333333',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'start_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c02',
      'subgroupId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01',
      'navigationRequestId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0110'),
    11, '{}'::uuid[]
  )->>'status'), 'accepted', 'subgroup start accepts subgroupId without scope');
select ok(
  (select scope_key = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01' and scope_subgroup_id is not null
   from public.navigation_sessions
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0110'),
  'subgroup session has its own scope lane'
);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0111',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'end_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c02',
      'subgroupId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01',
      'navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0110'),
    12, '{}'::uuid[]
  )->>'status'), 'accepted', 'main leader can end an explicitly scoped subgroup session');

-- Provider place ids do not merge independent adds.  Replaying one operation
-- is still idempotent, and coordinates cannot be edited.
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0120',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0, 'add_destination',
    jsonb_build_object('destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0120',
      'title', 'same provider one', 'latitude', 25.1, 'longitude', 121.1,
      'day', 1, 'kind', 'stop', 'providerPlaceId', 'same-provider'),
    13, '{}'::uuid[]
  )->>'status'), 'accepted', 'first same-provider add accepted');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0121',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0, 'add_destination',
    jsonb_build_object('destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0121',
      'title', 'same provider two', 'latitude', 25.2, 'longitude', 121.2,
      'day', 1, 'kind', 'stop', 'providerPlaceId', 'same-provider'),
    14, '{}'::uuid[]
  )->>'status'), 'accepted', 'second same-provider add accepted independently');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0120',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0, 'add_destination',
    jsonb_build_object('destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0120',
      'title', 'same provider one', 'latitude', 25.1, 'longitude', 121.1,
      'day', 1, 'kind', 'stop', 'providerPlaceId', 'same-provider'),
    13, '{}'::uuid[]
  )->>'status'), 'duplicate', 'same operation id is idempotent');
select is(
  (select count(*) from public.itinerary_items where provider_place_id = 'same-provider'),
  2::bigint, 'provider duplicates remain separate rows');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0122',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0, 'edit_destination',
    jsonb_build_object('destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0120',
      'patch', jsonb_build_object('latitude', 26.0)),
    15, '{}'::uuid[]
  )->'conflict'->>'code'), 'validation', 'coordinate edit is rejected');
select is(
  (select latitude from public.itinerary_items
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0120'), 25.1::double precision,
  'coordinate remains unchanged');

-- All remaining core operation types execute through v3.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0130',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'navigation_response', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0130', 0,
    'set_navigation_response',
    jsonb_build_object('sessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101',
      'userId', '22222222-2222-4222-8222-222222222222', 'response', 'acknowledged'),
    16, '{}'::uuid[]
  )->>'status'), 'accepted', 'navigation response operation accepted');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0131',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0131', 0,
    'send_command', jsonb_build_object('type', 'request_help', 'message', 'help',
      'expiresAt', '2099-01-01T00:00:00Z'), 17, '{}'::uuid[]
  )->>'status'), 'accepted', 'follower command accepted');
select ok(
  (select count(*) > 0 from public.core_notification_outbox
   where operation_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0131'
     and sender_id = '22222222-2222-4222-8222-222222222222'
     and expires_at <= created_at + interval '5 minutes'),
  'notification TTL is capped at five minutes');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0132',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0132', 0,
    'send_command', jsonb_build_object('type', 'request_help', 'message', 'late',
      'expiresAt', '2020-01-01T00:00:00Z'), 18, '{}'::uuid[]
  )->>'status'), 'accepted', 'expired command is accepted as a no-op');
select is(
  (select count(*) from public.core_notification_outbox
   where operation_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0132'),
  0::bigint, 'expired command does not enqueue or push');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0133',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0133', 0,
    'send_command', jsonb_build_object('type', 'gather', 'message', 'bad role',
      'expiresAt', '2099-01-01T00:00:00Z'), 23, '{}'::uuid[]
  )->'conflict'->>'code'), 'unauthorized',
  'follower cannot send a fixed leader command');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0134',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0134', 0,
    'send_command', jsonb_build_object('type', 'custom', 'message', 'custom request',
      'expiresAt', '2099-01-01T00:00:00Z'), 24, '{}'::uuid[]
  )->>'status'), 'accepted', 'custom command remains role-compatible');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0135',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0135', 0,
    'send_command', jsonb_build_object('type', 'request_start', 'message', 'please start',
      'expiresAt', '2099-01-01T00:00:00Z'), 25, '{}'::uuid[]
  )->>'status'), 'accepted', 'request_start command accepted');
select ok(
  (select count(*) > 0 and bool_and(target_role = 'leader')
   from public.core_notification_outbox
   where operation_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0135'),
  'request_start targets leaders only');

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0140',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '44444444-4444-4444-8444-444444444444',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0140', 0,
    'submit_gather_point_request',
    jsonb_build_object('requestId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0140',
      'subgroupId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01',
      'items', jsonb_build_array(jsonb_build_object('title', 'requested',
        'latitude', 25.3, 'longitude', 121.3))),
    19, '{}'::uuid[]
  )->>'status'), 'accepted', 'subgroup request submit accepted');
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0141',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '33333333-3333-4333-8333-333333333333',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0140', 0,
    'resolve_gather_point_request',
    jsonb_build_object('requestId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0140', 'approve', true),
    20, '{}'::uuid[]
  )->>'status'), 'accepted', 'subgroup request resolve accepted');
select is(
  (select status from public.gather_point_requests
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0140'),
  'approved', 'resolved request has terminal approved status');

-- A missing start is retryable; after the start succeeds the same arrival id
-- replays without rebase=true.  This also proves a receipt is not duplicated.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0150',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0151',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true),
    21, '{}'::uuid[]
  )->'conflict'->>'code'), 'dependency_missing', 'arrival before missing start remains retryable');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0151',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'start_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003',
      'navigationRequestId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0151'),
    22, '{}'::uuid[]
  )->>'status'), 'accepted', 'missing start can later be created');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0150',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0151',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true),
    21, '{}'::uuid[]
  )->>'status'), 'accepted', 'same arrival operation recovers without rebase flag');
select is(
  (select count(*) from public.navigation_arrival_events
   where operation_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0150'),
  1::bigint, 'recovered arrival has one event');

-- Completing a main session projects only members who actually arrived.  A
-- late arrival, undo, and leader correction update that projection according
-- to the same event ordering used by the session history.
reset role;
delete from public.visited_waypoints
where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  and destination_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'start_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003',
      'navigationRequestId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161'),
    30, '{}'::uuid[]
  )->>'status'), 'accepted', 'history projection session starts');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0162',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161',
      'userId', '11111111-1111-4111-8111-111111111111', 'arrived', true,
      'arrivedAt', '2026-09-20T12:00:00Z'),
    31, '{}'::uuid[]
  )->>'status'), 'accepted', 'one member arrives before completion');
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0163',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'complete_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003',
      'navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161'),
    32, '{}'::uuid[]
  )->>'status'), 'accepted', 'completion does not wait for the second member');
select is(
  (select count(*) from public.visited_waypoints
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and destination_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003'
     and navigation_session_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161'),
  1::bigint, 'completion projects only the member who arrived');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0164',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true,
      'arrivedAt', '2026-09-20T12:01:00Z'),
    33, '{}'::uuid[]
  )->>'status'), 'accepted', 'late completed-session arrival updates history projection');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (select count(*) from public.visited_waypoints
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and destination_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003'
     and navigation_session_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161'),
  2::bigint, 'late arrival adds the second member to visited projection');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0165',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', false),
    34, '{}'::uuid[]
  )->>'status'), 'accepted', 'late undo removes the member projection');
select is(
  (select count(*) from public.visited_waypoints
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and destination_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003'
     and navigation_session_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161'),
  1::bigint, 'late undo leaves only the arrived member');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0166',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161',
      'targetUserId', '22222222-2222-4222-8222-222222222222',
      'source', 'leader_correction', 'arrived', true, 'note', 'history audit'),
    35, '{}'::uuid[]
  )->>'status'), 'accepted', 'leader correction restores the visited projection');
select ok(
  (select arrived_at is null and navigation_session_id =
          'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161'::uuid
   from public.visited_waypoints
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and destination_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003'
     and user_id = '22222222-2222-4222-8222-222222222222'),
  'leader correction keeps visited arrivedAt NULL');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0167',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', false,
      'occurredAt', '2020-01-01T00:00:00Z'),
    36, '{}'::uuid[]
  )->>'status'), 'accepted', 'older undo remains an auditable event');
select ok(
  (select arrived and arrived_at is null and corrected_by =
          '11111111-1111-4111-8111-111111111111'::uuid
   from public.navigation_session_history
   where navigation_session_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0161'
     and user_id = '22222222-2222-4222-8222-222222222222'),
  'older undo cannot overwrite the newer correction history or projection');

-- An unknown legacy wire dependency does not block an independently valid
-- itinerary edit; the target itself remains the authoritative prerequisite.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0170',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0120', 0,
    'edit_destination',
    jsonb_build_object('destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0120',
      'patch', jsonb_build_object('title', 'independent edit')),
    37, array['99999999-9999-4999-8999-999999999999'::uuid]
  )->>'status'), 'accepted', 'unrelated unknown legacy dependency does not block edit');

-- Early malformed-envelope conflicts must be immutable receipts.  A replay
-- with a different actor/payload cannot overwrite the original ledger row.
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0190',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'send_command', jsonb_build_object('occurredAt', 'not-a-time'), 38, '{}'::uuid[]
  )->'conflict'->>'code'), 'validation', 'malformed occurredAt stores a validation receipt');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0190',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'send_command', jsonb_build_object('occurredAt', 'also-invalid', 'type', 'custom'),
    39, '{}'::uuid[]
  )->'conflict'->>'code'), 'operation_identity_mismatch',
  'different actor cannot replay a malformed operation id');
select ok(
  (select actor_id = '11111111-1111-4111-8111-111111111111'::uuid
      and group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
      and status = 'conflict'
      and payload->>'occurredAt' = 'not-a-time'
      and not (payload ? 'type')
   from public.core_operations
   where operation_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0190'),
  'malformed conflict ledger identity and payload remain unchanged');

-- A retryable receipt must be re-evaluated against current authorization and
-- target state. Reusing the same logical operation id may update its receipt
-- code, but never its identity or original payload.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0172',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0121', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0172',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true),
    41, '{}'::uuid[]
  )->'conflict'->>'code'), 'dependency_missing',
  'missing start for an existing target is retryable');
reset role;
delete from public.itinerary_items
where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0121';
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0172',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0121', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0172',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true),
    42, '{}'::uuid[]
  )->'conflict'->>'code'), 'target_deleted',
  'retryable receipt becomes terminal after target deletion');
select ok(
  (select actor_id = '22222222-2222-4222-8222-222222222222'::uuid
      and operation_type = 'record_arrival'
      and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0121'
      and status = 'conflict'
      and terminal_reason = 'target_deleted'
      and payload->>'userId' = '22222222-2222-4222-8222-222222222222'
      and payload->'_conflict'->>'code' = 'target_deleted'
   from public.core_operations
   where operation_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0172'),
  'retry updates only the receipt and preserves operation identity');

-- A missing start is terminal when its destination has already been deleted;
-- it must not remain in the retry queue forever just because no start receipt
-- exists on the server.
reset role;
insert into public.itinerary_items(
  id, group_id, title, latitude, longitude, position, day, kind
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0d01',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'deleted target', 25.1, 121.1, 8, 1, 'stop'
);
delete from public.itinerary_items
where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0d01';
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (public.apply_core_operation_v3(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0171',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0d01', 0,
    'record_arrival',
    jsonb_build_object('navigationSessionId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0171',
      'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true),
    40, '{}'::uuid[]
  )->'conflict'->>'code'), 'target_deleted',
  'missing session for a deleted destination is terminal');

select * from finish();
rollback;
