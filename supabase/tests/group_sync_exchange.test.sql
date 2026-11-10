begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,auth;
select plan(4);
insert into auth.users(id,email,is_anonymous) values
 ('a1000000-0000-4000-8000-000000000001','exchange@example.test',false),
 ('a1000000-0000-4000-8000-000000000002','exchange-peer@example.test',false);
insert into public.profiles(id,nickname) values ('a1000000-0000-4000-8000-000000000001','Leader'),('a1000000-0000-4000-8000-000000000002','Peer');
insert into public.groups(id,name,invite_code,created_by) values
 ('a1000000-0000-4000-8000-000000000100','Exchange','EXCH100','a1000000-0000-4000-8000-000000000001');
insert into public.memberships(group_id,user_id,role) values
 ('a1000000-0000-4000-8000-000000000100','a1000000-0000-4000-8000-000000000001','leader'),
 ('a1000000-0000-4000-8000-000000000100','a1000000-0000-4000-8000-000000000002','follower');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select lives_ok($test$
do $assertions$
declare
 g uuid := 'a1000000-0000-4000-8000-000000000100';
 u uuid := 'a1000000-0000-4000-8000-000000000001';
 d uuid := 'a1000000-0000-4000-8000-000000000101';
 a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
 e uuid := gen_random_uuid(); ops jsonb; result jsonb; replay jsonb;
 sample jsonb; captured timestamptz := clock_timestamp();
begin
 ops:=jsonb_build_array(
  jsonb_build_object('operation_id',a,'entity_type','itinerary','entity_id',g,'entity_version',0,
   'operation_type','add_destination','sequence',1,'created_at',now(),'payload',jsonb_build_object(
    'destinationId',d,'title','New','latitude',25,'longitude',121,'day',1)),
  jsonb_build_object('operation_id',b,'entity_type','itinerary','entity_id',g,'entity_version',0,
   'operation_type','edit_destination','sequence',2,'created_at',now(),'dependency_ids',jsonb_build_array(a),
   'payload',jsonb_build_object('destinationId',d,'patch',jsonb_build_object('title','Edited'))),
  jsonb_build_object('operation_id',c,'entity_type','active_gathering','entity_id',g,'entity_version',0,
   'operation_type','start_gathering','sequence',3,'created_at',now(),'dependency_ids',jsonb_build_array(a,b),
   'payload',jsonb_build_object('activeDestinationId',d,'navigationRequestId',gen_random_uuid())));
 sample:=jsonb_build_object('id',e,'actorId',u,'groupId',g,'navigationSessionId',null,
  'capturedAt',extract(epoch from captured)*1000,'coords',jsonb_build_object('latitude',25,'longitude',121,'accuracy',5),
  'trackingMode','foreground','source','foreground','sequence',1);
 result:=public.sync_group(g,auth.uid(),ops,jsonb_build_array(sample),'{"includeSnapshot":false}');
 assert result#>>'{coreResults,0,status}'='accepted',result::text;
 assert result#>>'{coreResults,1,status}'='accepted',result::text;
 assert result#>>'{coreResults,2,status}'='accepted',result::text;
 assert result->'snapshot'='null','lean exchange included recovery data';
 assert result#>'{locationResult,acceptedIds}'=jsonb_build_array(e),'GPS ACK';
 assert result#>>'{locationReceipts,0,id}'=e::text,'GPS receipt';
 replay:=public.sync_group(g,auth.uid(),ops,jsonb_build_array(sample));
 assert replay#>>'{coreResults,0,status}'='duplicate',replay::text;
 assert replay#>>'{coreResults,1,status}'='duplicate',replay::text;
 assert replay#>>'{coreResults,2,status}'='duplicate',replay::text;
 assert replay->'locationReceipts'=result->'locationReceipts','receipt time immutable on replay';
 assert replay#>>'{snapshot,itinerary,0,title}'='Edited','postwrite itinerary visibility';
 assert replay#>>'{snapshot,group,journey_status}'='going','postwrite navigation visibility';
 assert jsonb_array_length(replay#>'{snapshot,locations}')=1,replay::text;
 assert replay#>'{snapshot,daily_accommodations}'='[]','accommodations included by default';
 assert (select count(*)=3 from public.core_operations where group_id=g),'one identity per core op';
 assert (select count(*) from jsonb_object_keys(replay#>'{snapshot,profiles,0}'))=4,'public profile projection';
end;
$assertions$;
$test$,'lean mixed exchange persists ordered core/GPS writes visible on default full replay');

reset role;
insert into public.location_refresh_pending(group_id,user_id,requested_by,requested_at)
 values ('a1000000-0000-4000-8000-000000000100','a1000000-0000-4000-8000-000000000001',
 'a1000000-0000-4000-8000-000000000002',now()-interval '1 second');
set local role authenticated;
select lives_ok($test$
do $receipts$
declare g uuid:='a1000000-0000-4000-8000-000000000100'; u uuid:='a1000000-0000-4000-8000-000000000001';
 event_id uuid; request_token text; result jsonb; original_time text; blocked jsonb; suffix uuid:=gen_random_uuid();
begin
 select id,ingested_at::text into event_id,original_time from public.location_upload_events where group_id=g;
 request_token:=public.sync_group(g,auth.uid(),'[]','[]','{"includeSnapshot":false}')#>>'{pendingRefreshes,0,requested_at}';
 result:=public.sync_group(g,auth.uid(),'[]','[]',jsonb_build_object('includeSnapshot',false,'acknowledgements',jsonb_build_array(
  jsonb_build_object('requestedAt',request_token,'eventId',event_id))));
 assert (result#>>'{refreshAcknowledgements,0,accepted}')::boolean,'qualifying original receipt rejected';
 assert jsonb_array_length(result->'pendingRefreshes')=0,'exact request still pending';
 assert (select ingested_at::text=original_time from public.location_upload_events where id=event_id),'ACK relabelled receipt time';
 result:=public.sync_group(g,auth.uid(),'[]','[]',jsonb_build_object('includeSnapshot',false,'requestedAt',request_token,
  'acknowledgements',jsonb_build_array(jsonb_build_object('requestedAt',request_token,'eventId',event_id))));
 assert (result#>>'{refreshAcknowledgements,0,accepted}')::boolean,'lost ACK replay rejected';
 assert result->'acknowledgedIds'=jsonb_build_array(u),'exact request ACK missing from peer status';
 blocked:=jsonb_build_array(
  jsonb_build_object('operation_id',gen_random_uuid(),'entity_type','itinerary','entity_id',g,'entity_version',0,
   'operation_type','edit_destination','sequence',4,'created_at',now(),'payload',jsonb_build_object(
   'destinationId',gen_random_uuid(),'patch',jsonb_build_object('title','Missing'))),
  jsonb_build_object('operation_id',suffix,'entity_type','itinerary','entity_id',g,'entity_version',0,
   'operation_type','set_trip_details','sequence',5,'created_at',now(),'payload',jsonb_build_object('tripDays',2,'departureDate','2026-11-02')));
 result:=public.sync_group(g,auth.uid(),blocked);
 assert result#>>'{coreResults,0,status}'='conflict',result::text;
 assert result#>>'{coreResults,1,status}'='not_submitted',result::text;
 assert not exists(select 1 from public.core_operations where operation_id=suffix),'untouched suffix entered ledger';
 assert (result#>'{snapshot,group,trip_days}')='null','suffix modified group';
end;
$receipts$;
$test$,'receipt-backed exact ACK is immutable and replayable; first conflict leaves suffix unsubmitted');
reset role;
insert into public.location_refresh_pending(group_id,user_id,requested_by,requested_at)
 values ('a1000000-0000-4000-8000-000000000100','a1000000-0000-4000-8000-000000000001',
 'a1000000-0000-4000-8000-000000000002',now()+interval '1 second');
set local role authenticated;
select lives_ok($test$
do $security$
declare g uuid:='a1000000-0000-4000-8000-000000000100'; event_id uuid; token text; result jsonb;
 sample jsonb; caught boolean:=false;
begin
 select id into event_id from public.location_upload_events where group_id=g;
 token:=public.sync_group(g,auth.uid())#>>'{pendingRefreshes,0,requested_at}';
 result:=public.sync_group(g,auth.uid(),'[]','[]',jsonb_build_object('includeSnapshot',false,'acknowledgements',jsonb_build_array(
  jsonb_build_object('requestedAt',token,'eventId',event_id))));
 assert not (result#>>'{refreshAcknowledgements,0,accepted}')::boolean,'old sample ACKed newer request';
 assert jsonb_array_length(result->'pendingRefreshes')=1,'old receipt cleared later request';
 sample:=jsonb_build_object('id',gen_random_uuid(),'actorId','a1000000-0000-4000-8000-000000000001','groupId',g,
  'capturedAt',extract(epoch from now()-interval '1 hour')*1000,'navigationSessionId',null,
  'coords',jsonb_build_object('latitude',24,'longitude',121,'accuracy',5),'sequence',0,'source','foreground','trackingMode','foreground');
 result:=public.sync_group(g,auth.uid(),'[]',jsonb_build_array(sample),'{"includeSnapshot":false}');
 assert result#>'{locationResult,acceptedIds}'='[]','rejected stale sample was ACKed';
 assert result#>>'{locationResult,rejected,0,reason}'='stale_sample',result::text;
 assert result->'locationReceipts'='[]','rejected event acquired an accepted receipt';
 sample:=jsonb_build_object('id',gen_random_uuid(),'actorId','a1000000-0000-4000-8000-000000000002','groupId',g);
 begin perform public.sync_group(g,auth.uid(),'[]',jsonb_build_array(sample)); exception when insufficient_privilege then caught:=true; end;
 assert caught,'cross actor event accepted'; caught:=false;
 sample:=sample||jsonb_build_object('actorId','a1000000-0000-4000-8000-000000000001','groupId',gen_random_uuid());
 begin perform public.sync_group(g,auth.uid(),'[]',jsonb_build_array(sample)); exception when insufficient_privilege then caught:=true; end;
 assert caught,'cross group event accepted'; caught:=false;
 begin
  perform public.sync_group(gen_random_uuid(),auth.uid(),'[]','[]','{"includeSnapshot":false}');
 exception when insufficient_privilege then caught:=true;
 end;
 assert caught,'nonmember read accepted';
end;
$security$;
$test$,'old receipt cannot clear a later request and mixed envelope enforces actor/group boundaries');

select lives_ok($test$
do $actor_fence$
declare g uuid:='a1000000-0000-4000-8000-000000000100'; a uuid:='a1000000-0000-4000-8000-000000000001';
 b uuid:='a1000000-0000-4000-8000-000000000002'; op uuid:=gen_random_uuid(); result jsonb; caught boolean:=false;
begin
 perform set_config('request.jwt.claim.sub',b::text,true);
 result:=public.apply_core_operation_v3(op,g,a,'itinerary',g::text,0,'set_trip_details',
  jsonb_build_object('tripDays',7,'departureDate','2026-11-02'),6);
 assert result->>'status'='conflict' and result#>>'{conflict,code}'='account_changed',result::text;
 begin
  perform public.sync_group(g,a,jsonb_build_array(jsonb_build_object('operation_id',op,'entity_type','itinerary',
   'entity_id',g,'entity_version',0,'operation_type','set_trip_details','sequence',6,'created_at',now(),
   'payload',jsonb_build_object('tripDays',7,'departureDate','2026-11-02'))),'[]',jsonb_build_object('requestPeers',true));
 exception when invalid_authorization_specification then caught:=true;
 end;
 assert caught,'captured actor A batch executed as authenticated actor B';
 assert not exists(select 1 from public.core_operations where operation_id=op),'mismatch entered operation ledger';
 result:=public.sync_group(g,b,'[]','[]',jsonb_build_object('requestPeers',true));
 assert (result#>>'{refreshRequest,accepted}')::boolean,'mismatch consumed peer refresh cooldown';
 assert result#>'{snapshot,group,trip_days}'='null','actor mismatch changed group state';
end;
$actor_fence$;
$test$,'old v3 and mixed exchange reject a lazy-auth account switch before core and refresh effects');
select * from finish();
rollback;



