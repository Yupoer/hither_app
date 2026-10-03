-- #287: rollback-only real SQL replacement and isolation regression.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(5);
insert into auth.users(id,email,is_anonymous) values
 ('bc111111-1111-4111-8111-111111111111','stay-reconcile-leader@example.test',false),
 ('bc222222-2222-4222-8222-222222222222','stay-reconcile-member@example.test',false),
 ('bc333333-3333-4333-8333-333333333333','stay-reconcile-outsider@example.test',false);
insert into public.groups(id,name,invite_code,created_by,departure_date,accommodation_auto_add) values
 ('bc000000-0000-4000-8000-000000000001','Stay reconcile','QSTY01','bc111111-1111-4111-8111-111111111111','2026-10-03',false),
 ('bc000000-0000-4000-8000-000000000002','Other trip','QSTY02','bc111111-1111-4111-8111-111111111111','2026-10-03',false);
insert into public.memberships(group_id,user_id,role) values
 ('bc000000-0000-4000-8000-000000000001','bc111111-1111-4111-8111-111111111111','leader'),
 ('bc000000-0000-4000-8000-000000000001','bc222222-2222-4222-8222-222222222222','follower'),
 ('bc000000-0000-4000-8000-000000000002','bc111111-1111-4111-8111-111111111111','leader');
insert into public.subgroups(id,group_id,name,leader_id) values
 ('bc000000-0000-4000-8000-000000000100','bc000000-0000-4000-8000-000000000001','Other scope','bc111111-1111-4111-8111-111111111111');
-- Premium fixture permits this full isolation matrix without disabling quotas.
insert into public.personal_premium_entitlements(user_id,status,product_id,expires_at) values
 ('bc111111-1111-4111-8111-111111111111','active','test.premium',now()+interval '7 days');
insert into public.itinerary_items(id,group_id,title,address,latitude,longitude,day,position,kind,stay_anchor,provider_place_id,closed_at,subgroup_id) values
 ('bc000000-0000-4000-8000-000000000201','bc000000-0000-4000-8000-000000000001','Old Hotel','Old Address',25,121,2,1,'accommodation',true,'old-provider',null,null),
 ('bc000000-0000-4000-8000-000000000202','bc000000-0000-4000-8000-000000000001','Old Hotel','Old Address',25,121,2,2,'accommodation',true,'old-provider','2026-10-04T10:00Z',null),
 ('bc000000-0000-4000-8000-000000000203','bc000000-0000-4000-8000-000000000001','Old Hotel','Old Address',25,121,1,3,'accommodation',true,'old-provider',null,null),
 ('bc000000-0000-4000-8000-000000000204','bc000000-0000-4000-8000-000000000001','Independent Hotel','Other Address',25,121,2,4,'accommodation',true,'other-provider',null,null),
 ('bc000000-0000-4000-8000-000000000205','bc000000-0000-4000-8000-000000000001','Old Hotel','Other Coordinates',26,122,2,5,'accommodation',true,'different-coordinates',null,null),
 ('bc000000-0000-4000-8000-000000000206','bc000000-0000-4000-8000-000000000001','Old Hotel','Old Address',25,121,2,6,'accommodation',true,'old-provider',null,'bc000000-0000-4000-8000-000000000100'),
 ('bc000000-0000-4000-8000-000000000207','bc000000-0000-4000-8000-000000000002','Old Hotel','Old Address',25,121,2,7,'accommodation',true,'old-provider',null,null),
 ('bc000000-0000-4000-8000-000000000208','bc000000-0000-4000-8000-000000000001','Old Hotel','Old Address',25,121,2,8,'stop',false,'old-provider',null,null),
 ('bc000000-0000-4000-8000-000000000209','bc000000-0000-4000-8000-000000000001','Old Hotel','Old Address',25,121,2,9,'accommodation',true,'old-provider',null,null),
 ('bc000000-0000-4000-8000-000000000210','bc000000-0000-4000-8000-000000000001','Old Hotel','Old Address',25,121,2,10,'accommodation',true,'old-provider',null,null);
insert into public.daily_accommodations(group_id,stay_date,title,address,latitude,longitude,created_by) values
 ('bc000000-0000-4000-8000-000000000001','2026-10-04','Old Hotel','Old Address',25,121,'bc111111-1111-4111-8111-111111111111');
select set_config('request.jwt.claim.sub','bc111111-1111-4111-8111-111111111111',true);
insert into public.navigation_sessions(id,group_id,destination_id,destination_name,destination_latitude,destination_longitude,started_by,request_id) values
 ('bc000000-0000-4000-8000-000000000300','bc000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000210','Old Hotel',25,121,'bc111111-1111-4111-8111-111111111111','bc000000-0000-4000-8000-000000000301');
update public.groups set active_destination_id='bc000000-0000-4000-8000-000000000209' where id='bc000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','bc111111-1111-4111-8111-111111111111',true);
select lives_ok($test$
do $assertions$
declare
 g uuid := 'bc000000-0000-4000-8000-000000000001'; actor uuid := 'bc111111-1111-4111-8111-111111111111';
 op uuid := gen_random_uuid(); r jsonb; original_position integer;
 payload jsonb := '{"stayDate":"2026-10-04","day":2,"daily":{"title":"New Hotel","address":"New Address","coordinates":{"latitude":35.6,"longitude":139.7}}}';
begin
 select position into original_position from public.itinerary_items where id='bc000000-0000-4000-8000-000000000201';
 r := public.apply_core_operation_v3(op,g,actor,'itinerary',g::text,0,'set_daily_accommodation',payload,1);
 assert r->>'status' = 'accepted', r::text;
 assert (select active_destination_id='bc000000-0000-4000-8000-000000000209'::uuid from public.groups where id=g), 'active destination identity was replaced';
 assert (select title='New Hotel' and address='New Address' and latitude=35.6 and longitude=139.7
   from public.daily_accommodations where group_id=g and stay_date='2026-10-04'), 'daily snapshot not replaced';
 assert (select title='New Hotel' and address='New Address' and latitude=35.6 and longitude=139.7
   and provider_place_id is null and not stay_anchor and day=2 and position=original_position
   from public.itinerary_items where id='bc000000-0000-4000-8000-000000000201'), 'matching open day-2 copied card not replaced';
 -- Location metadata/history must remain independent. The inherited daily RPC
 -- separately demotes same-day boundary anchors; that is not a coordinate edit.
 assert (select count(*)=7 from public.itinerary_items where id in (
   'bc000000-0000-4000-8000-000000000202','bc000000-0000-4000-8000-000000000203',
   'bc000000-0000-4000-8000-000000000206','bc000000-0000-4000-8000-000000000207',
   'bc000000-0000-4000-8000-000000000208','bc000000-0000-4000-8000-000000000209','bc000000-0000-4000-8000-000000000210')
   and title='Old Hotel' and address='Old Address' and latitude=25 and longitude=121 and provider_place_id='old-provider'),
   'closed, other-day, subgroup, other-group, ordinary-stop or active-target metadata changed';
 assert (select destination_id='bc000000-0000-4000-8000-000000000210'::uuid and destination_name='Old Hotel' and destination_latitude=25 and destination_longitude=121 and status='active' from public.navigation_sessions where id='bc000000-0000-4000-8000-000000000300'), 'ongoing navigation target snapshot changed';
 assert (select closed_at='2026-10-04T10:00Z'::timestamptz from public.itinerary_items where id='bc000000-0000-4000-8000-000000000202'), 'history closed_at changed';
 assert (select title='Independent Hotel' and address='Other Address' and latitude=25 and longitude=121 and provider_place_id='other-provider'
   from public.itinerary_items where id='bc000000-0000-4000-8000-000000000204'), 'independent same-day hotel replaced';
 assert (select title='Old Hotel' and address='Other Coordinates' and latitude=26 and longitude=122 and provider_place_id='different-coordinates'
   from public.itinerary_items where id='bc000000-0000-4000-8000-000000000205'), 'same-name hotel at different coordinates replaced';
 r := public.apply_core_operation_v3(op,g,actor,'itinerary',g::text,0,'set_daily_accommodation',payload,1);
 assert r->>'status'='duplicate', 'replacement UUID replay was not idempotent';
 assert (select count(*)=1 from public.daily_accommodations where group_id=g), 'duplicate daily stay created';
end;
$assertions$;
$test$,'Replaced daily stay updates matching open cards and preserves independent location metadata');

select lives_ok($test$
do $assertions$
declare g uuid := 'bc000000-0000-4000-8000-000000000001'; actor uuid := 'bc222222-2222-4222-8222-222222222222'; r jsonb; count_rows integer;
begin
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
   insert into public.daily_stay_coordinate_replacement_context(transaction_id,backend_pid,destination_id,group_id)
   values(txid_current(),pg_backend_pid(),'bc000000-0000-4000-8000-000000000201',g);
   raise exception 'authenticated actor forged a coordinate capability';
 exception when insufficient_privilege then null;
 end;
 r := public.apply_core_operation_v3(gen_random_uuid(),g,actor,'itinerary',g::text,0,'set_daily_accommodation',
   '{"stayDate":"2026-10-04","day":2,"daily":{"title":"Forbidden Hotel","coordinates":{"latitude":0,"longitude":0}}}',1);
 assert r->>'status'='conflict' and r->'conflict'->>'code'='unauthorized', 'follower could replace a team stay';
 update public.daily_accommodations set title='Forbidden Direct' where group_id=g;
 get diagnostics count_rows=row_count;
 assert count_rows=0, 'follower bypassed replacement authorization via direct update';
 assert (select title='New Hotel' from public.itinerary_items where id='bc000000-0000-4000-8000-000000000201'), 'rejected write fired replacement trigger';
 perform set_config('request.jwt.claim.sub','bc333333-3333-4333-8333-333333333333',true);
 r := public.apply_core_operation_v3(gen_random_uuid(),g,'bc333333-3333-4333-8333-333333333333','itinerary',g::text,0,'set_daily_accommodation',
   '{"stayDate":"2026-10-04","day":2,"daily":{"title":"Forbidden Hotel","coordinates":{"latitude":0,"longitude":0}}}',1);
 assert r->>'status'='conflict', 'outsider could replace stay metadata';
end;
$assertions$;
$test$,'Stay replacement trigger remains behind leader and membership authorization');
-- A leader's direct update is also immutable; a GUC is not a capability.
select set_config('request.jwt.claim.sub','bc111111-1111-4111-8111-111111111111',true);
select set_config('hither.allow_coordinate_update','true',true);
select throws_ok($statement$
 update public.itinerary_items set latitude=35.8 where id='bc000000-0000-4000-8000-000000000201'
$statement$,'22023','destination coordinates are immutable; delete and recreate the destination','ordinary coordinate update remains immutable');
reset role;
select lives_ok($test$
do $assertions$
begin
 assert (select count(*)=0 from public.daily_stay_coordinate_replacement_context), 'capability survived trusted replacement';
 assert not has_table_privilege('authenticated','public.daily_stay_coordinate_replacement_context','SELECT')
   and not has_table_privilege('authenticated','public.daily_stay_coordinate_replacement_context','INSERT')
   and not has_table_privilege('anon','public.daily_stay_coordinate_replacement_context','INSERT')
   and not has_table_privilege('service_role','public.daily_stay_coordinate_replacement_context','INSERT'), 'capability table grants are exposed';
end;
$assertions$;
$test$,'Coordinate capabilities are inaccessible to client roles and do not remain after use');
-- Force a statement failure after the nested coordinate write. PostgreSQL must
-- roll back both the copied row and its private authorization capability.
create function pg_temp.reject_failed_stay_replacement() returns trigger language plpgsql as $$
begin
  if new.title='Fail Hotel' then raise exception 'fixture_replacement_failed'; end if;
  return new;
end;
$$;
create trigger test_reject_failed_stay_replacement after update on public.itinerary_items
for each row execute function pg_temp.reject_failed_stay_replacement();
select lives_ok($test$
do $assertions$
begin
 begin
   update public.daily_accommodations set title='Fail Hotel',latitude=35.61
     where group_id='bc000000-0000-4000-8000-000000000001' and stay_date='2026-10-04';
   raise exception 'fixture did not reject replacement';
 exception when raise_exception then
   assert sqlerrm='fixture_replacement_failed', sqlerrm;
 end;
 assert (select count(*)=0 from public.daily_stay_coordinate_replacement_context), 'failed statement left an authorization capability';
 assert (select title='New Hotel' and latitude=35.6 from public.daily_accommodations where group_id='bc000000-0000-4000-8000-000000000001'), 'failed daily statement was partly applied';
 assert (select title='New Hotel' and latitude=35.6 from public.itinerary_items where id='bc000000-0000-4000-8000-000000000201'), 'failed copied-row statement was partly applied';
end;
$assertions$;
$test$,'Failed replacement rolls back copied coordinates and private capability together');
select * from finish();
rollback;
