-- All fixtures and DDL are rolled back; safe to run against the linked project.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(23);
create temporary table quick_add_tap(result text);
grant all on quick_add_tap to authenticated;
insert into auth.users(id,email) values
 ('f1020000-0000-4000-8000-000000000001','quick-leader@example.test'),
 ('f1020000-0000-4000-8000-000000000002','quick-follower@example.test'),
 ('f1020000-0000-4000-8000-000000000003','quick-sub@example.test'),
 ('f1020000-0000-4000-8000-000000000004','quick-sub-follower@example.test');
insert into public.profiles(id,nickname) values ('f1020000-0000-4000-8000-000000000003','Sub leader');
insert into public.groups(id,name,invite_code,created_by) values
 ('f1020000-0000-4000-8000-000000000010','Quick add fixture','QA102','f1020000-0000-4000-8000-000000000001');
insert into public.trip_entitlements(group_id,owner_user_id,plan_code,status,source) values
 ('f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000001','lifetime_premium','active','grant');
insert into public.subgroups(id,group_id,name,mode,leader_id) values
 ('f1020000-0000-4000-8000-000000000020','f1020000-0000-4000-8000-000000000010','Sub','led','f1020000-0000-4000-8000-000000000003');
insert into public.memberships(group_id,user_id,role,subgroup_id) values
 ('f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000001','leader',null),
 ('f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000002','follower',null),
 ('f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000003','follower','f1020000-0000-4000-8000-000000000020'),
 ('f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000004','follower','f1020000-0000-4000-8000-000000000020');
insert into public.itinerary_items(group_id,subgroup_id,title,latitude,longitude,position,day,kind,stay_anchor,closed_at) values
 ('f1020000-0000-4000-8000-000000000010',null,'History',25,121,0,1,'stop',false,'2026-10-01T00:00:00Z'),
 ('f1020000-0000-4000-8000-000000000010',null,'Start',25,121,1,1,'accommodation',true,null),
 ('f1020000-0000-4000-8000-000000000010',null,'Old',25,121,2,1,'stop',false,null),
 ('f1020000-0000-4000-8000-000000000010',null,'Tail',25,121,3,1,'accommodation',true,null),
 ('f1020000-0000-4000-8000-000000000010',null,'Tomorrow',25,121,4,2,'stop',false,null),
 ('f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000020','Sub old',25,121,0,1,'stop',false,null);
set local role authenticated;
select set_config('request.jwt.claim.sub','f1020000-0000-4000-8000-000000000001',true);
insert into quick_add_tap select lives_ok($$select public.quick_add_itinerary_item('f1020000-0000-4000-8000-000000000010',null,'Direct',null,25,121,1)$$,'atomic direct quick add');
insert into quick_add_tap select is((select array_agg(title order by position) from public.itinerary_items where group_id='f1020000-0000-4000-8000-000000000010' and subgroup_id is null and day=1),array['History','Start','Direct','Old','Tail'],'history and both stay boundaries retained');
insert into quick_add_tap select is((select array_agg(position order by position) from public.itinerary_items where group_id='f1020000-0000-4000-8000-000000000010' and subgroup_id is null and day=1),array[0,1,2,3,4],'direct ordering has no duplicate positions');
insert into quick_add_tap select is((select position from public.itinerary_items where group_id='f1020000-0000-4000-8000-000000000010' and title='Sub old'),0,'other scope unchanged');
insert into quick_add_tap select is((select closed_at from public.itinerary_items where group_id='f1020000-0000-4000-8000-000000000010' and title='History'),'2026-10-01T00:00:00Z'::timestamptz,'completion history unchanged');
insert into quick_add_tap select is((public.apply_core_operation_v3('f1020000-0000-4000-8000-000000000030','f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000001','itinerary','f1020000-0000-4000-8000-000000000010',0,'add_destination',jsonb_build_object('destinationId','f1020000-0000-4000-8000-000000000030','title','Durable','latitude',25,'longitude',121,'day',1,'placement','firstStop'),1,'{}'::uuid[])->>'status'),'accepted','durable v3 accepts placement');
insert into quick_add_tap select is((select array_agg(title order by position) from public.itinerary_items where group_id='f1020000-0000-4000-8000-000000000010' and subgroup_id is null and day=1),array['History','Start','Durable','Direct','Old','Tail'],'durable quick add is first open stop');
insert into quick_add_tap select is((public.apply_core_operation_v3('f1020000-0000-4000-8000-000000000030','f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000001','itinerary','f1020000-0000-4000-8000-000000000010',0,'add_destination',jsonb_build_object('destinationId','f1020000-0000-4000-8000-000000000030','title','Durable','latitude',25,'longitude',121,'day',1,'placement','firstStop'),1,'{}'::uuid[])->>'status'),'duplicate','retry does not insert or shift twice');
insert into quick_add_tap select lives_ok($$select public.quick_add_itinerary_item('f1020000-0000-4000-8000-000000000010',null,'Empty day',null,25,121,3)$$,'empty day supported');
insert into quick_add_tap select is((select array_agg(title order by position) from public.itinerary_items where group_id='f1020000-0000-4000-8000-000000000010' and subgroup_id is null and day=2),array['Tomorrow'],'adjacent day retained');
insert into quick_add_tap select throws_ok($$select public.quick_add_itinerary_item('f1020000-0000-4000-8000-000000000010',null,'Invalid',null,25,121,null)$$,'22023','quick add requires a scheduled stop','unscheduled quick add rejected');
select set_config('request.jwt.claim.sub','f1020000-0000-4000-8000-000000000002',true);
insert into quick_add_tap select throws_ok($$select public.quick_add_itinerary_item('f1020000-0000-4000-8000-000000000010',null,'Forbidden',null,25,121,1)$$,'42501','permission denied','group follower forbidden');
select set_config('request.jwt.claim.sub','f1020000-0000-4000-8000-000000000003',true);
insert into quick_add_tap select lives_ok($$select public.quick_add_itinerary_item('f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000020','Sub quick',null,25,121,1)$$,'subgroup leader can add in own scope');
insert into quick_add_tap select is((select array_agg(title order by position) from public.itinerary_items where group_id='f1020000-0000-4000-8000-000000000010' and subgroup_id='f1020000-0000-4000-8000-000000000020'),array['Sub quick','Sub old'],'subgroup quick add first');
insert into quick_add_tap select throws_ok($$select public.quick_add_itinerary_item('f1020000-0000-4000-8000-000000000010',null,'Wrong scope',null,25,121,1)$$,'42501','permission denied','subgroup member cannot write main scope');

select set_config('request.jwt.claim.sub','f1020000-0000-4000-8000-000000000003',true);
insert into quick_add_tap select is((public.apply_core_operation_v3('f1020000-0000-4000-8000-000000000031','f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000003','itinerary','f1020000-0000-4000-8000-000000000010',0,'add_destination',jsonb_build_object('destinationId','f1020000-0000-4000-8000-000000000031','title','Sub durable','latitude',25,'longitude',121,'day',1,'subgroupId','f1020000-0000-4000-8000-000000000020','placement','firstStop'),1,'{}'::uuid[])->>'status'),'accepted','durable subgroup leader authorized');
insert into quick_add_tap select is((select array_agg(title order by position) from public.itinerary_items where group_id='f1020000-0000-4000-8000-000000000010' and subgroup_id='f1020000-0000-4000-8000-000000000020'),array['Sub durable','Sub quick','Sub old'],'durable subgroup insertion order');
select set_config('request.jwt.claim.sub','f1020000-0000-4000-8000-000000000004',true);
insert into quick_add_tap select throws_ok($$select public.quick_add_itinerary_item('f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000020','Follower',null,25,121,1)$$,'42501','permission denied','subgroup follower cannot edit itinerary');
select set_config('request.jwt.claim.sub','f1020000-0000-4000-8000-000000000001',true);
insert into quick_add_tap select lives_ok($$insert into public.itinerary_items(group_id,title,latitude,longitude,position,day,kind,stay_anchor) values ('f1020000-0000-4000-8000-000000000010','Stay start',25,121,20,4,'accommodation',true)$$,'seed start stay');
insert into quick_add_tap select lives_ok($$insert into public.itinerary_items(group_id,title,latitude,longitude,position,day,kind,stay_anchor) values ('f1020000-0000-4000-8000-000000000010','Stay tail',25,121,21,4,'accommodation',true)$$,'seed tail stay');
insert into quick_add_tap select lives_ok($$select public.quick_add_itinerary_item('f1020000-0000-4000-8000-000000000010',null,'Stay quick',null,25,121,4)$$,'quick add between stays');
insert into quick_add_tap select is((select array_agg(title order by position) from public.itinerary_items where group_id='f1020000-0000-4000-8000-000000000010' and subgroup_id is null and day=4),array['Stay start','Stay quick','Stay tail'],'empty-stop day preserves both stay boundaries');
reset role;
update auth.users set is_anonymous=true where id='f1020000-0000-4000-8000-000000000003';
select public.allow_anonymous_expiry_write();
update public.profiles set anonymous_expires_at=now()-interval '1 day' where id='f1020000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1020000-0000-4000-8000-000000000003',true);
insert into quick_add_tap select throws_ok($$select public.quick_add_itinerary_item('f1020000-0000-4000-8000-000000000010','f1020000-0000-4000-8000-000000000020','Expired',null,25,121,1)$$,'42501','permission denied','expired anonymous subgroup leader rejected');

insert into quick_add_tap select * from finish();
select result from quick_add_tap;
rollback;
