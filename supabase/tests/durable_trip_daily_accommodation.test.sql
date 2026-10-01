-- Run with supabase test db --local; no fixtures or receipts survive rollback.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(1);

insert into auth.users(id, email, is_anonymous) values
 ('b1111111-1111-4111-8111-111111111111', 'durable-trip-leader@example.test', false),
 ('b2222222-2222-4222-8222-222222222222', 'durable-trip-member@example.test', false),
 ('b3333333-3333-4333-8333-333333333333', 'durable-trip-newcomer@example.test', false);
insert into public.groups(id, name, invite_code, created_by) values
 ('beeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Durable trip', 'DURSTAY1', 'b1111111-1111-4111-8111-111111111111');
insert into public.memberships(group_id, user_id, role) values
 ('beeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'b1111111-1111-4111-8111-111111111111', 'leader'),
 ('beeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'b2222222-2222-4222-8222-222222222222', 'follower');
insert into public.itinerary_items(id, group_id, title, latitude, longitude, position, day, kind, stay_anchor) values
 ('beeeeeee-eeee-4eee-8eee-eeeeeeee0001', 'beeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Hotel', 25, 121, 0, 1, 'accommodation', true),
 ('beeeeeee-eeee-4eee-8eee-eeeeeeee0002', 'beeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Gathering', 25, 121, 1, 1, 'stop', false);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
select lives_ok($test$
do $assertions$
declare
  g uuid := 'beeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  leader uuid := 'b1111111-1111-4111-8111-111111111111';
  member uuid := 'b2222222-2222-4222-8222-222222222222';
  point uuid := 'beeeeeee-eeee-4eee-8eee-eeeeeeee0002';
  session_id uuid := 'beeeeeee-eeee-4eee-8eee-eeeeeeee0101';
  trip_op uuid := gen_random_uuid();
  stay_op uuid := gen_random_uuid();
  clear_op uuid := gen_random_uuid();
  auto_op uuid := gen_random_uuid();
  payload jsonb;
  result jsonb;
  version integer;
  nav public.navigation_sessions;
begin
  result := public.apply_core_operation_v3(trip_op, g, leader, 'itinerary', g::text, 0,
    'set_trip_details', '{"tripDays":4,"departureDate":"2026-10-01"}', 1);
  assert result->>'status' = 'accepted', result::text;
  assert (select trip_days = 4 and departure_date = '2026-10-01'::date from public.groups where id = g), 'trip was not saved';
  assert result->'entity'->'group'->>'tripDays' = '4', 'authoritative trip absent';
  version := (result->>'entity_version')::integer;
  result := public.apply_core_operation_v3(trip_op, g, leader, 'itinerary', g::text, 0,
    'set_trip_details', '{"tripDays":4,"departureDate":"2026-10-01"}', 1);
  assert result->>'status' = 'duplicate' and (result->>'entity_version')::integer = version, 'trip UUID replay was not idempotent';

  payload := '{"stayDate":"2026-10-01","day":1,"daily":{"id":"beeeeeee-eeee-4eee-8eee-eeeeeeee0301","title":"Hotel","coordinates":{"latitude":25,"longitude":121},"sourceDestinationId":"beeeeeee-eeee-4eee-8eee-eeeeeeee0001"}}';
  result := public.apply_core_operation_v3(stay_op, g, leader, 'itinerary', g::text, 0,
    'set_daily_accommodation', payload, 2, array[trip_op]);
  assert result->>'status' = 'accepted', result::text;
  assert jsonb_array_length(result->'entity'->'dailyAccommodations') = 1, 'authoritative stays absent';
  assert (select not accommodation_auto_add from public.groups where id = g), 'boundary auto-add not disabled';
  assert (select count(*) = 2 from public.itinerary_items where group_id = g), 'unexpected auto-added cards';
  result := public.apply_core_operation_v3(stay_op, g, leader, 'itinerary', g::text, 0,
    'set_daily_accommodation', payload, 2, array[trip_op]);
  assert result->>'status' = 'duplicate', result::text;
  assert (select count(*) = 1 from public.daily_accommodations where group_id = g), 'duplicate stay created';

  result := public.apply_core_operation_v3(gen_random_uuid(), g, leader, 'itinerary', g::text, 0,
    'set_daily_accommodation', jsonb_set(payload, '{daily,coordinates,latitude}', '91'), 3);
  assert result->>'status' = 'conflict' and result->'conflict'->>'code' = 'validation', 'invalid coordinates accepted';
  assert (select latitude = 25 from public.daily_accommodations where group_id = g), 'invalid stay partially applied';
  result := public.apply_core_operation_v3(gen_random_uuid(), g, leader, 'itinerary', g::text, 0,
    'set_trip_details', '{"tripDays":0,"departureDate":"2026-10-01"}', 4);
  assert result->>'status' = 'conflict' and result->'conflict'->>'code' = 'validation', 'invalid trip accepted';

  perform set_config('request.jwt.claim.sub', member::text, true);
  result := public.apply_core_operation_v3(gen_random_uuid(), g, member, 'itinerary', g::text, 0,
    'set_trip_details', '{"tripDays":7,"departureDate":"2026-11-01"}', 1);
  assert result->>'status' = 'conflict' and result->'conflict'->>'code' = 'unauthorized', 'follower edited trip';
  result := public.apply_core_operation_v3(gen_random_uuid(), g, member, 'itinerary', g::text, 0,
    'clear_daily_accommodation', '{"stayDate":"2026-10-01","day":1}', 2);
  assert result->>'status' = 'conflict' and result->'conflict'->>'code' = 'unauthorized', 'follower cleared stay';
  result := public.apply_core_operation_v3(gen_random_uuid(), g, leader, 'itinerary', g::text, 0,
    'set_daily_accommodation', payload, 3);
  assert result->>'status' = 'conflict' and result->'conflict'->>'code' = 'account_changed', 'actor spoof accepted';
  perform set_config('request.jwt.claim.sub', leader::text, true);

  result := public.apply_core_operation_v3(clear_op, g, leader, 'itinerary', g::text, 0,
    'clear_daily_accommodation', '{"stayDate":"2026-10-01","day":1}', 5, array[stay_op]);
  assert result->>'status' = 'accepted', result::text;
  assert jsonb_array_length(result->'entity'->'dailyAccommodations') = 0, 'clear receipt still contains stay';
  assert (select count(*) = 0 from public.daily_accommodations where group_id = g), 'clear left stay';
  assert (select not stay_anchor from public.itinerary_items where id = 'beeeeeee-eeee-4eee-8eee-eeeeeeee0001'), 'clear did not release anchor';
  assert (select count(*) = 2 from public.itinerary_items where group_id = g), 'clear deleted independent cards';
  result := public.apply_core_operation_v3(clear_op, g, leader, 'itinerary', g::text, 0,
    'clear_daily_accommodation', '{"stayDate":"2026-10-01","day":1}', 5, array[stay_op]);
  assert result->>'status' = 'duplicate', 'clear UUID replay not idempotent';

  nav := public.start_navigation_session(g, point, session_id);
  perform set_config('request.jwt.claim.sub', 'b3333333-3333-4333-8333-333333333333', true);
  perform public.join_group('DURSTAY1');
  assert not exists (select 1 from public.navigation_member_states where navigation_session_id = session_id
    and user_id = 'b3333333-3333-4333-8333-333333333333'), 'mid-session newcomer unexpectedly in original roster';
  result := public.apply_core_operation_v3(gen_random_uuid(), g, 'b3333333-3333-4333-8333-333333333333',
    'active_gathering', point::text, 0, 'record_arrival', jsonb_build_object('userId', 'b3333333-3333-4333-8333-333333333333',
      'navigationSessionId', session_id, 'arrived', true, 'arrivedAt', now(), 'occurredAt', now()), 1);
  assert result->>'status' = 'conflict' and result->'conflict'->>'code' = 'not_session_member', 'newcomer arrival should remain session-bound';
  perform set_config('request.jwt.claim.sub', leader::text, true);
  payload := jsonb_build_object('destinationId', point, 'sessionId', session_id, 'reason', 'all_arrived');
  begin
    result := public.apply_core_operation_v3(auto_op, g, leader, 'itinerary', g::text, 0,
      'complete_destination', payload, 6);
    raise exception 'automatic completion accepted missing arrivals';
  exception when serialization_failure then null;
  end;
  assert (select status = 'active' from public.navigation_sessions where id = session_id), 'incomplete roster closed session';
  assert (select closed_at is null from public.itinerary_items where id = point), 'incomplete roster closed point';
  assert not exists(select 1 from public.navigation_session_history where navigation_session_id = session_id), 'incomplete roster created history';

  result := public.apply_core_operation_v3(gen_random_uuid(), g, leader, 'active_gathering', point::text, 0,
    'record_arrival', jsonb_build_object('userId', leader, 'navigationSessionId', session_id,
      'arrived', true, 'arrivedAt', now(), 'occurredAt', now()), 7);
  assert result->>'status' = 'accepted', result::text;
  perform set_config('request.jwt.claim.sub', member::text, true);
  result := public.apply_core_operation_v3(gen_random_uuid(), g, member, 'active_gathering', point::text, 0,
    'record_arrival', jsonb_build_object('userId', member, 'navigationSessionId', session_id,
      'arrived', true, 'arrivedAt', now(), 'occurredAt', now()), 3);
  assert result->>'status' = 'accepted', result::text;
  perform set_config('request.jwt.claim.sub', leader::text, true);
  result := public.apply_core_operation_v3(auto_op, g, leader, 'itinerary', g::text, 0,
    'complete_destination', payload, 6);
  assert result->>'status' = 'accepted', result::text;
  assert (select status = 'completed' from public.navigation_sessions where id = session_id), 'mid-session newcomer blocked original roster completion';
  result := public.apply_core_operation_v3(auto_op, g, leader, 'itinerary', g::text, 0,
    'complete_destination', payload, 6);
  assert result->>'status' = 'duplicate', 'completion UUID replay not idempotent';

  nav := public.start_navigation_session(g, 'beeeeeee-eeee-4eee-8eee-eeeeeeee0001', gen_random_uuid());
  result := public.apply_core_operation_v3(gen_random_uuid(), g, leader, 'itinerary', g::text, 0,
    'complete_destination', jsonb_build_object('destinationId', nav.destination_id,
      'sessionId', nav.id, 'reason', 'forced'), 8);
  assert result->>'status' = 'accepted', 'explicit force completion rejected: ' || result::text;
  assert (select status = 'completed' from public.navigation_sessions where id = nav.id), 'force did not close incomplete roster';
end;
$assertions$;
$test$, 'durable trip/stay receipts preserve authorization, atomicity, idempotence and all-arrived completion');

select * from finish();
rollback;
