begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(17);

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'start-leader@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'start-sender@example.test'),
  ('10000000-0000-4000-8000-000000000003', 'start-other@example.test');
insert into public.groups (id, name, invite_code, created_by)
values ('20000000-0000-4000-8000-000000000001', 'Start inbox', 'STARTI', '10000000-0000-4000-8000-000000000001');
insert into public.memberships (group_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'leader'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'follower'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'follower');
insert into public.itinerary_items (id, group_id, title, latitude, longitude, position, day) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Requested stop', 25, 121, 0, 1),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Rejected stop', 25, 121, 1, 1);
insert into public.subgroups (id, group_id, name, mode)
values ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Private subgroup', 'collab');
insert into public.itinerary_items (id, group_id, subgroup_id, title, latitude, longitude, position, day)
values ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', 'Out of scope', 25, 121, 0, 1);
insert into public.notification_preferences (user_id, follower_requests)
values ('10000000-0000-4000-8000-000000000001', false)
on conflict (user_id) do update set follower_requests = false;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('test.start_inbox.approved', '50000000-0000-4000-8000-000000000001', true);
select set_config('test.start_inbox.rejected', '50000000-0000-4000-8000-000000000002', true);
select is(public.apply_core_operation_v3(
  current_setting('test.start_inbox.approved')::uuid, '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', 'itinerary', current_setting('test.start_inbox.approved'), 0,
  'send_command', '{"type":"request_start","destinationId":"30000000-0000-4000-8000-000000000001"}',
  1, '{}'::uuid[], now() - interval '1 hour')->>'status', 'accepted',
  'an offline start request persists when it finally reaches the server');
select is(public.apply_core_operation_v3(
  current_setting('test.start_inbox.rejected')::uuid, '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', 'itinerary', current_setting('test.start_inbox.rejected'), 0,
  'send_command', '{"type":"request_start","destinationId":"30000000-0000-4000-8000-000000000002"}',
  2, '{}'::uuid[], now())->>'status', 'accepted', 'a second destination request persists');
select is(public.apply_core_operation_v3(
  '50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', 'itinerary', '50000000-0000-4000-8000-000000000003', 0,
  'send_command', '{"type":"request_start","destinationId":"30000000-0000-4000-8000-000000000003"}',
  3, '{}'::uuid[], now())->>'status', 'conflict', 'request cannot cross into another subgroup');

select is((select count(*) from public.commands where request_status = 'pending'), 2::bigint,
  'sender sees their own pending requests');
select throws_ok(
  $$select public.resolve_gathering_start(current_setting('test.start_inbox.approved')::uuid, true)$$,
  '42501', 'start request is not available to this user', 'sender cannot accept');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.commands where request_status is not null), 0::bigint,
  'other group members cannot read the targeted payload');
select is((select count(*) from public.core_operations where operation_type = 'send_command'), 0::bigint,
  'other group members cannot read targeted payloads through core receipts');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(public.apply_core_operation_v3(
  '50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', 'itinerary', '50000000-0000-4000-8000-000000000004', 0,
  'send_command', '{"type":"need_help","message":"Help"}',
  4, '{}'::uuid[], now())->>'status', 'accepted', 'help uses the existing durable send operation');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.commands where type = 'need_help'), 0::bigint,
  'new help notice is visible in the organizer inbox only');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.commands where type = 'need_help' and core_delivery), 1::bigint,
  'organizer sees the help notice independently of push preferences');
select is((select count(*) from public.commands where request_status = 'pending'), 2::bigint,
  'organizer inbox is available when notification preferences are off');
select lives_ok(
  $$select public.resolve_gathering_start(current_setting('test.start_inbox.approved')::uuid, true)$$,
  'organizer can accept a targeted request');
select is(
  (select started_by from public.navigation_sessions where request_id = current_setting('test.start_inbox.approved')::uuid),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'accepted request starts navigation as the organizer');
select is(
  (select active_destination_id from public.groups where id = '20000000-0000-4000-8000-000000000001'),
  '30000000-0000-4000-8000-000000000001'::uuid,
  'accepted request starts the requested destination');
select lives_ok(
  $$select public.resolve_gathering_start(current_setting('test.start_inbox.rejected')::uuid, false)$$,
  'organizer can reject a targeted request');
select lives_ok(
  $$select public.resolve_gathering_start(current_setting('test.start_inbox.rejected')::uuid, true)$$,
  'resolving a closed request does not reopen it');
select is(
  (select count(*) from public.navigation_sessions where group_id = '20000000-0000-4000-8000-000000000001'),
  1::bigint,
  'rejection and stale retries do not create a second session');

select * from finish();
rollback;
