-- Local rollback-only behavior regression; no production data or push dispatch.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(2);
insert into auth.users(id,email,is_anonymous) values
 ('bd111111-1111-4111-8111-111111111111','solo-leader@example.test',false),
 ('bd222222-2222-4222-8222-222222222222','solo-member@example.test',false),
 ('bd333333-3333-4333-8333-333333333333','solo-outsider@example.test',false);
insert into public.groups(id,name,invite_code,created_by) values
 ('bd000000-0000-4000-8000-000000000001','Solo receipts','QSOL01','bd111111-1111-4111-8111-111111111111');
insert into public.memberships(group_id,user_id,role) values
 ('bd000000-0000-4000-8000-000000000001','bd111111-1111-4111-8111-111111111111','leader'),
 ('bd000000-0000-4000-8000-000000000001','bd222222-2222-4222-8222-222222222222','follower');
insert into public.location_refresh_pending(group_id,user_id,requested_by,requested_at) values
 ('bd000000-0000-4000-8000-000000000001','bd222222-2222-4222-8222-222222222222','bd111111-1111-4111-8111-111111111111','2026-10-03T12:30:00Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','bd222222-2222-4222-8222-222222222222',true);
select lives_ok($test$
do $assertions$
declare
 g uuid := 'bd000000-0000-4000-8000-000000000001';
 actor uuid := 'bd222222-2222-4222-8222-222222222222';
 op uuid := gen_random_uuid(); r jsonb; payload jsonb := jsonb_build_object('userId', actor::text, 'solo', true);
begin
 r := public.apply_core_operation_v3(op,g,actor,'itinerary',actor::text,0,'set_solo',payload,1);
 assert r->>'status' = 'accepted', 'follower Solo intent rejected: '||r::text;
 assert (select solo from public.memberships where group_id=g and user_id=actor), 'Solo was not saved';
 r := public.apply_core_operation_v3(op,g,actor,'itinerary',actor::text,0,'set_solo',payload,1);
 assert r->>'status' = 'duplicate', 'same Solo UUID is not idempotent';
 r := public.apply_core_operation_v3(gen_random_uuid(),g,actor,'itinerary','bd111111-1111-4111-8111-111111111111',0,
   'set_solo',jsonb_build_object('userId','bd111111-1111-4111-8111-111111111111','solo',true),2);
 assert r->>'status' = 'conflict', 'another membership was writable';
 assert (select not solo from public.memberships where group_id=g and user_id='bd111111-1111-4111-8111-111111111111'), 'leader status changed';
 r := public.apply_core_operation_v3(gen_random_uuid(),g,actor,'itinerary',actor::text,0,'set_solo',
   jsonb_build_object('userId',actor::text,'solo','invalid'),3);
 assert r->>'status' = 'conflict' and r->'conflict'->>'code' = 'validation', 'nonboolean Solo accepted';
end;
$assertions$;
$test$,'Solo receipts are follower-authorized, actor-scoped and UUID-idempotent');

select lives_ok($test$
do $assertions$
declare g uuid := 'bd000000-0000-4000-8000-000000000001'; v timestamptz := '2026-10-03T12:30:00Z';
begin
 assert public.get_group_location_refresh_acknowledgements(g,v) = '[]'::jsonb, 'pending is already counted as ACK';
 assert not public.ack_my_location_refresh(g,v - interval '1 second'), 'stale ACK deleted a newer request';
 assert public.get_group_location_refresh_acknowledgements(g,v) = '[]'::jsonb, 'wrong version counted as ACK';
 assert public.ack_my_location_refresh(g,v), 'exact ACK rejected';
 assert public.ack_my_location_refresh(g,v), 'lost-response exact ACK retry not idempotent';
 assert public.get_group_location_refresh_acknowledgements(g,v) = '["bd222222-2222-4222-8222-222222222222"]'::jsonb, 'exact ACK absent';
 assert public.get_group_location_refresh_acknowledgements(g,v + interval '60 seconds') = '[]'::jsonb, 'old version counted for new request';
 perform set_config('request.jwt.claim.sub','bd333333-3333-4333-8333-333333333333',true);
 assert not public.ack_my_location_refresh(g,v), 'outsider ACK accepted';
 begin
   perform public.get_group_location_refresh_acknowledgements(g,v);
   raise exception 'outsider could read receipts';
 exception when insufficient_privilege then null;
 end;
end;
$assertions$;
$test$,'Refresh accounting requires exact version ACK and preserves membership access');
select * from finish();
rollback;
