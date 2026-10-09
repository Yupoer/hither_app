-- Exercise the public v3 bridge, not just the lower-level reorder RPC.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(1);

insert into auth.users(id, email, is_anonymous) values
 ('b2981111-1111-4111-8111-111111111111', 'reorder-omission@example.test', false);
insert into public.groups(id, name, invite_code, created_by) values
 ('b2982222-2222-4222-8222-222222222222', 'Reorder omission', 'REORD298', 'b2981111-1111-4111-8111-111111111111');
insert into public.memberships(group_id, user_id, role) values
 ('b2982222-2222-4222-8222-222222222222', 'b2981111-1111-4111-8111-111111111111', 'leader');
insert into public.itinerary_items(id, group_id, title, latitude, longitude, position, day, kind, meet_at, stay_anchor) values
 ('b2983333-3333-4333-8333-333333333331', 'b2982222-2222-4222-8222-222222222222', 'First', 25, 121, 0, 1, 'stop', '2026-10-09T12:00:00Z', true),
 ('b2983333-3333-4333-8333-333333333332', 'b2982222-2222-4222-8222-222222222222', 'New first', 25, 121, 1, 1, 'stop', '2026-10-09T13:00:00Z', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2981111-1111-4111-8111-111111111111', true);
select lives_ok($test$
do $assertions$
declare
  g uuid := 'b2982222-2222-4222-8222-222222222222';
  actor uuid := 'b2981111-1111-4111-8111-111111111111';
  first_id uuid := 'b2983333-3333-4333-8333-333333333331';
  second_id uuid := 'b2983333-3333-4333-8333-333333333332';
  op uuid := gen_random_uuid();
  payload jsonb;
  result jsonb;
begin
  payload := jsonb_build_object('updates', jsonb_build_array(
    jsonb_build_object('id', second_id, 'day', 1, 'position', 0),
    jsonb_build_object('id', first_id, 'day', 1, 'position', 1)));
  result := public.apply_core_operation_v3(op, g, actor, 'itinerary', g::text, 0, 'reorder_destinations', payload, 1);
  assert result->>'status' = 'accepted', result::text;
  assert (select position = 0 and meet_at = '2026-10-09T13:00:00Z'::timestamptz and stay_anchor
    from public.itinerary_items where id = second_id), 'promotion lost omitted meetAt or stayAnchor';
  assert (select position = 1 and meet_at = '2026-10-09T12:00:00Z'::timestamptz and stay_anchor
    from public.itinerary_items where id = first_id), 'promotion changed the other open stop fields';
  result := public.apply_core_operation_v3(op, g, actor, 'itinerary', g::text, 0, 'reorder_destinations', payload, 1);
  assert result->>'status' = 'duplicate', result::text;

  payload := jsonb_build_object('updates', jsonb_build_array(
    jsonb_build_object('id', second_id, 'day', 1, 'position', 0, 'meetAt', null)));
  result := public.apply_core_operation_v3(gen_random_uuid(), g, actor, 'itinerary', g::text, 0, 'reorder_destinations', payload, 2);
  assert result->>'status' = 'accepted', result::text;
  assert (select meet_at is null and stay_anchor from public.itinerary_items where id = second_id),
    'explicit meetAt null must clear time and retain omitted anchor';

  payload := jsonb_build_object('updates', jsonb_build_array(
    jsonb_build_object('id', first_id, 'day', 1, 'position', 1, 'stayAnchor', null)));
  result := public.apply_core_operation_v3(gen_random_uuid(), g, actor, 'itinerary', g::text, 0, 'reorder_destinations', payload, 3);
  assert result->>'status' = 'accepted', result::text;
  assert (select not stay_anchor and meet_at = '2026-10-09T12:00:00Z'::timestamptz
    from public.itinerary_items where id = first_id), 'explicit anchor null must clear anchor and retain omitted time';
end;
$assertions$;
$test$, 'durable promotion preserves omitted fields while explicit null clears only its field');

select * from finish();
rollback;
