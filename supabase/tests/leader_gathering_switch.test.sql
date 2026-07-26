-- pgTAP: leader switch preserves open itinerary rows and replaces active point.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(5);

insert into auth.users (id, email) values
  ('33333333-3333-4333-8333-333333333333', 'switch-leader@example.test');
insert into public.groups (id, name, invite_code, created_by) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Switch trip', 'SWITCH1',
  '33333333-3333-4333-8333-333333333333'
);
insert into public.memberships (group_id, user_id, role) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '33333333-3333-4333-8333-333333333333', 'leader'
);
insert into public.itinerary_items (
  id, group_id, title, latitude, longitude, position, day
) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'A', 25.1, 121.5, 0, 1),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'B', 25.2, 121.6, 1, 1);

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);

select is(
  (public.apply_leader_gathering_switch(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    0,
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
  )->>'status'),
  'accepted',
  'first leader switch is accepted'
);
select is(
  (public.apply_leader_gathering_switch(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    1,
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'
  )->>'status'),
  'accepted',
  'second leader switch is accepted'
);
select is(
  (select state->'pointStatuses'->>'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
   from public.core_entity_versions
   where group_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     and entity_type = 'active_gathering'),
  'pending',
  'old active point returns to pending'
);
select is(
  (select state->'pointStatuses'->>'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'
   from public.core_entity_versions
   where group_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     and entity_type = 'active_gathering'),
  'en_route',
  'new point becomes active'
);
select is(
  (select closed_at from public.itinerary_items
   where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  null,
  'switch does not close the old itinerary point'
);

select * from finish();
rollback;
