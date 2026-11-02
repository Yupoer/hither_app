begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(47);
create table public.test_schedule_pushes(id bigint generated always as identity, payload jsonb);
create or replace function extensions.notify_push(payload jsonb) returns void language sql as $$ insert into public.test_schedule_pushes(payload) values(payload) $$;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','schedule-captain@example.test'),
 ('22222222-2222-4222-8222-222222222222','schedule-peer@example.test'),
 ('33333333-3333-4333-8333-333333333333','schedule-sub@example.test');
insert into public.groups(id,name,invite_code,created_by) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Scheduled','SCHED1','11111111-1111-4111-8111-111111111111');
insert into public.trip_entitlements(group_id,owner_user_id,plan_code,status,source,expires_at) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','small_trip_pass','active','grant',now()+interval '1 day');
insert into public.memberships(group_id,user_id,role) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','leader'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222','follower');
insert into public.subgroups(id,group_id,name,mode,leader_id) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Sub','led','33333333-3333-4333-8333-333333333333');
insert into public.memberships(group_id,user_id,role,subgroup_id) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','33333333-3333-4333-8333-333333333333','leader','eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01');
insert into public.itinerary_items(id,group_id,title,latitude,longitude,position,day,meet_at,meet_set_by) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0001','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Main due',25,121,0,1,now()-interval '1 minute','11111111-1111-4111-8111-111111111111'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0002','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Replacement',25,121,1,1,null,'11111111-1111-4111-8111-111111111111');
insert into public.itinerary_items(id,group_id,title,latitude,longitude,position,day,meet_at,meet_set_by,subgroup_id) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0c02','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Sub due',25,121,0,1,now()-interval '1 minute','33333333-3333-4333-8333-333333333333','eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01');
insert into public.itinerary_items(id,group_id,title,latitude,longitude,position,day) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0080','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Pool preserved',25,121,9,null);
select throws_ok($$insert into public.navigation_sessions(group_id,destination_id,destination_name,destination_latitude,destination_longitude,started_by,request_id)
 values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','eeeeeeee-eeee-4eee-8eee-eeeeeeee0080','Pool preserved',25,121,'11111111-1111-4111-8111-111111111111',gen_random_uuid())$$,
 '22023','navigation destination missing or closed','legacy direct navigation cannot target the unscheduled pool');
select set_config('request.jwt.claim.sub','',true);
select is(public.process_meet_time_pushes(),2,'one due occurrence starts each independent scope without a foreground actor');
select is((select count(*)::integer from navigation_sessions where status='active'),2,'main and subgroup active independently');
select is((select count(*)::integer from navigation_member_states),3,'core owner projects members in correct scope');
select is((select count(*)::integer from navigation_scope_states where journey_state='active'),2,'core owner projects scope state');
select is((select entity_version from core_entity_versions where entity_type='active_gathering' and entity_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and state->>'journeyPhase'='en_route'),2,'core owner projects both starts through existing gathering entity identity');
select is((select count(*)::integer from test_schedule_pushes where payload->>'origin'='scheduled' and payload->>'category'='navigation_session'),2,'origin is persisted before each start trigger');
select is((select count(*)::integer from test_schedule_pushes where payload->>'category'='meet_due'),0,'scheduled navigation replaces due-only alert');
select is(public.process_meet_time_pushes(),0,'repeat minute consumes no second start');
select is((select count(*)::integer from core_operations where status='accepted'),2,'one accepted core operation per occurrence');
select ok((select bool_and(s.id=i.meet_schedule_occurrence_id) from navigation_sessions s join itinerary_items i on i.id=s.destination_id),'occurrence UUID owns session identity');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.report_straggler('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222',900);
select is((select count(*)::integer from group_alerts),1,'active main navigation allows separation report');
update navigation_member_states set local_status='arrived' where user_id='11111111-1111-4111-8111-111111111111';
select public.report_straggler('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222',900);
select is((select count(*)::integer from group_alerts),2,'captain personal arrival does not stop team separation');
select public.report_straggler('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','33333333-3333-4333-8333-333333333333',900);
select is((select count(*)::integer from group_alerts),2,'main detector cannot report independent subgroup member');
update public.itinerary_items set meet_at=now()-interval '30 seconds' where id='eeeeeeee-eeee-4eee-8eee-eeeeeeee0001';
select set_config('request.jwt.claim.sub','',true);
select is(public.process_meet_time_pushes(),0,'same active target consumes new occurrence without restart');
select is((select count(*)::integer from navigation_sessions),2,'same target keeps original sessions');
select is((select local_status from navigation_member_states where user_id='11111111-1111-4111-8111-111111111111'),'arrived','same target preserves member arrival');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
update public.itinerary_items set meet_at=now()-interval '20 seconds' where id='eeeeeeee-eeee-4eee-8eee-eeeeeeee0002';
select set_config('request.jwt.claim.sub','',true);
select is(public.process_meet_time_pushes(),1,'different due target uses core replacement');
select ok((select day is null and position=9 from public.itinerary_items where id='eeeeeeee-eeee-4eee-8eee-eeeeeeee0080'),
 'scheduled promotion preserves unscheduled pool day and position');
select is((select status from navigation_sessions where destination_id='eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'),'cancelled','replacement terminates old same-scope session');
select is((select status from navigation_sessions where destination_id='eeeeeeee-eeee-4eee-8eee-eeeeeeee0c02'),'active','replacement preserves other scope');
select ok((select started_at from navigation_sessions where destination_id='eeeeeeee-eeee-4eee-8eee-eeeeeeee0002') > (select started_at from navigation_sessions where destination_id='eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'),'same-tick scheduled replacements preserve newest-session ordering');
update navigation_sessions set status='completed' where scope_key='main';
update navigation_scope_states set journey_state='idle',active_session_id=null where scope_key='main';
select is(public.process_meet_time_pushes(),0,'completed occurrence cannot restart');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.report_straggler('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222',900);
select is((select count(*)::integer from group_alerts),2,'idle SQL write boundary suppresses old-client report');
set local role authenticated;
select is((public.apply_core_operation_v3(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222','active_gathering','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',0,'start_gathering','{}',1)->'conflict'->>'code'),'account_changed','public v3 retains authenticated actor equality');
select ok(not public.can_manage_itinerary_scope('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',null,'33333333-3333-4333-8333-333333333333'),'public authority helper retains actor equality');
select throws_ok($q$update public.itinerary_items set meet_schedule_consumed_at=null where title='Replacement'$q$,'42501',null,'client cannot replay consumed schedule metadata');
select throws_ok($q$update public.navigation_sessions set origin='manual' where destination_id='eeeeeeee-eeee-4eee-8eee-eeeeeeee0002'$q$,'42501',null,'client cannot rewrite durable scheduled origin');
select throws_ok('select hither_private.can_manage_itinerary_scope_actor(null,null,null)','42501',null,'authenticated cannot invoke private actor authority');
select throws_ok('select hither_private.apply_core_operation_actor(null,null,null,null,null,null,null,null,null)','42501',null,'authenticated cannot invoke private executor');
select throws_ok('select public.process_meet_time_pushes()','42501',null,'authenticated cannot invoke schedule executor');
reset role;
set local role anon;
select throws_ok('select hither_private.can_manage_itinerary_scope_actor(null,null,null)','42501',null,'anon cannot invoke private authority');
select throws_ok('select hither_private.apply_core_operation_actor(null,null,null,null,null,null,null,null,null)','42501',null,'anon cannot invoke private executor');
select throws_ok('select public.process_meet_time_pushes()','42501',null,'anon cannot invoke schedule executor');
reset role;
select ok(not has_function_privilege('service_role','hither_private.apply_core_operation_actor(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamp with time zone,text)','EXECUTE'),'service role cannot call generic actor executor');

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
create temporary table previous_occurrence as select meet_schedule_occurrence_id id from itinerary_items where title='Replacement';
update itinerary_items set meet_at=now()+interval '1 hour' where title='Replacement';
select ok((select meet_schedule_occurrence_id <> (select id from previous_occurrence) and meet_schedule_consumed_at is null from itinerary_items where title='Replacement'),'clock edit invalidates consumed occurrence');
update itinerary_items set meet_at=null where title='Replacement';
select ok((select meet_schedule_occurrence_id is null from itinerary_items where title='Replacement'),'cleared clock invalidates occurrence');
select set_config('request.jwt.claim.sub','',true);
insert into public.itinerary_items(id,group_id,title,latitude,longitude,position,day,meet_at,meet_set_by,closed_at) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0003','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Closed',25,121,2,1,now()-interval '1 minute','11111111-1111-4111-8111-111111111111',now()),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0004','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','No coordinates',null,null,3,1,now()-interval '1 minute','11111111-1111-4111-8111-111111111111',null),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0005','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Unauthorized setter',25,121,4,1,now()-interval '1 minute','22222222-2222-4222-8222-222222222222',null),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0006','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Outside horizon',25,121,5,1,now()-interval '3 hours','11111111-1111-4111-8111-111111111111',null),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0007','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Unscheduled',25,121,6,null,now()-interval '1 minute','11111111-1111-4111-8111-111111111111',null);
select set_config('request.jwt.claim.sub','',true);
select is(public.process_meet_time_pushes(),0,'closed, missing coordinates, unauthorized, old and unscheduled clocks cannot start');
select is((select count(*)::integer from navigation_sessions),3,'invalid clocks create no sessions');
select ok((select meet_at is null and meet_schedule_occurrence_id is null from itinerary_items where title='Unscheduled'),'pool boundary clears schedule before occurrence trigger');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
update itinerary_items set meet_at=now()+interval '2 minutes' where title='Replacement';
select set_config('request.jwt.claim.sub','',true);
select is(public.process_meet_time_pushes(),1,'future eligible occurrence keeps separate warning');
select is(public.process_meet_time_pushes(),0,'warning is emitted only once');
select is((select count(*)::integer from test_schedule_pushes where payload->>'category'='meet_warning'),1,'warning has one presentation event');
select ok((select meet_schedule_consumed_at is null from itinerary_items where title='Replacement'),'warning does not consume future start');
select ok((select bool_and(meet_schedule_revision>0) from itinerary_items where meet_at is not null),'scheduled clocks carry durable revisions');

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
update itinerary_items set meet_at=now()-interval '20 seconds' where title='Replacement';
update itinerary_items set meet_at=now()-interval '10 seconds',meet_set_by='11111111-1111-4111-8111-111111111111' where title='Unauthorized setter';
select set_config('request.jwt.claim.sub','',true);
select is(public.process_meet_time_pushes(),2,'one minute tick processes two same-scope due targets in order');
select ok((select id from navigation_sessions where scope_key='main' order by started_at desc limit 1) =
  (select id from navigation_sessions where scope_key='main' and status='active') and
  (select payload->>'session_id' from test_schedule_pushes where payload->>'category'='navigation_session' and payload->>'status'='active' order by id desc limit 1) =
  (select id::text from navigation_sessions where scope_key='main' and status='active'),
  'final active session is both newest by execution clock and final emitted start event');
select * from finish();
rollback;
