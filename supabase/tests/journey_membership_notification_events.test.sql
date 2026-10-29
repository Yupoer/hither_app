begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(7);

select ok(has_table_privilege('service_role','public.group_alerts','SELECT'),
 'send-push can read durable departure evidence as service_role');

create temporary table notification_push_receipts(sequence bigint generated always as identity, payload jsonb);
create or replace function extensions.notify_push(payload jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into pg_temp.notification_push_receipts(payload) values ($1);
$$;

insert into auth.users(id,email,is_anonymous) values
 ('d3010000-0000-4000-8000-000000000001','notification-leader@example.test',false),
 ('d3010000-0000-4000-8000-000000000002','notification-member@example.test',false),
 ('d3010000-0000-4000-8000-000000000003','notification-outsider@example.test',false);
insert into public.profiles(id,nickname) values
 ('d3010000-0000-4000-8000-000000000001','Tokyo Leader'),
 ('d3010000-0000-4000-8000-000000000002','Tokyo A')
 on conflict(id) do update set nickname=excluded.nickname;
insert into public.groups(id,name,invite_code,created_by) values
 ('d3010000-0000-4000-8000-000000000010','Notification contract','N30101','d3010000-0000-4000-8000-000000000001');
insert into public.memberships(group_id,user_id,role) values
 ('d3010000-0000-4000-8000-000000000010','d3010000-0000-4000-8000-000000000001','leader'),
 ('d3010000-0000-4000-8000-000000000010','d3010000-0000-4000-8000-000000000002','follower');
insert into public.itinerary_items(id,group_id,title,latitude,longitude,position) values
 ('d3010000-0000-4000-8000-000000000020','d3010000-0000-4000-8000-000000000010','Asakusa',35.71,139.80,0),
 ('d3010000-0000-4000-8000-000000000021','d3010000-0000-4000-8000-000000000010','Skytree',35.71,139.81,1);
truncate notification_push_receipts;

set local role authenticated;
select set_config('request.jwt.claim.sub','d3010000-0000-4000-8000-000000000002',true);
select public.set_solo('d3010000-0000-4000-8000-000000000010',true);
select public.set_solo('d3010000-0000-4000-8000-000000000010',true);
select public.set_solo('d3010000-0000-4000-8000-000000000010',false);
reset role;
select lives_ok($test$
do $assertions$
begin
 assert (select count(*)=2 from public.group_alerts where group_id='d3010000-0000-4000-8000-000000000010'), 'unchanged Solo generated another event';
 assert (select array_agg(payload->>'category' order by sequence)=array['member_solo','member_follow'] from notification_push_receipts where payload->>'category' in ('member_solo','member_follow')), 'Solo/follow push categories drifted';
 assert not exists(select 1 from notification_push_receipts p left join public.group_alerts a on a.id::text=p.payload->>'entity_id'
   where p.payload->>'category' in ('member_solo','member_follow') and (a.id is null or a.kind<>p.payload->>'category' or a.member_name<>'Tokyo A'
     or p.payload->>'sender_id'<>'d3010000-0000-4000-8000-000000000002'
     or p.payload->>'member_name'<>'Tokyo A')), 'push does not identify the same durable member event';
end;
$assertions$;
$test$,'Solo/follow transitions create unique durable events with matching push payloads');

set local role authenticated;
delete from public.memberships where group_id='d3010000-0000-4000-8000-000000000010' and user_id=auth.uid();
reset role;
select lives_ok($test$
do $assertions$
begin
 assert (select count(*)=1 from public.group_alerts where kind='member_left' and group_id='d3010000-0000-4000-8000-000000000010'), 'self leave event absent';
 assert exists(select 1 from notification_push_receipts p join public.group_alerts a on a.id::text=p.payload->>'entity_id'
   where p.payload->>'category'='member_left' and a.kind='member_left' and a.member_name='Tokyo A'), 'departure push lost its persisted authority or name';
end;
$assertions$;
$test$,'authenticated self departure retains one event after membership removal');

select ok(not has_table_privilege('authenticated','public.group_alerts','INSERT,UPDATE,DELETE')
 and not has_table_privilege('anon','public.group_alerts','INSERT,UPDATE,DELETE')
 and not has_function_privilege('authenticated','public.on_membership_participation_change()','EXECUTE')
 and not has_function_privilege('anon','public.on_membership_participation_change()','EXECUTE'),
 'clients cannot forge the durable departure proof or invoke its writer');

set local role authenticated;
select set_config('request.jwt.claim.sub','d3010000-0000-4000-8000-000000000003',true);
select throws_ok($$insert into public.group_alerts(group_id,kind,sender_id,member_id)
 values('d3010000-0000-4000-8000-000000000010','member_left','d3010000-0000-4000-8000-000000000002','d3010000-0000-4000-8000-000000000002')$$,
 '42501',null,'an outsider cannot manufacture a departed sender event');
reset role;

select set_config('request.jwt.claim.sub','d3010000-0000-4000-8000-000000000001',true);
truncate notification_push_receipts;
select lives_ok($test$
do $assertions$
declare g uuid:='d3010000-0000-4000-8000-000000000010'; stop uuid:='d3010000-0000-4000-8000-000000000020';
begin
 update public.groups set journey_status='going',active_destination_id=stop,journey_started_at='2026-10-22T00:00:00.123456Z' where id=g;
 update public.groups set journey_status='going' where id=g;
 update public.groups set journey_status='paused',active_destination_id=null,journey_started_at=null where id=g;
 update public.groups set journey_status='going',active_destination_id=stop,journey_started_at='2026-10-22T00:01:00Z' where id=g;
 update public.groups set active_destination_id='d3010000-0000-4000-8000-000000000021',journey_started_at='2026-10-22T00:02:00Z' where id=g;
 assert (select count(*)=4 from notification_push_receipts where payload->>'category'='journey'), 'start/pause/resume/switch lifecycle delivery drift';
 assert (select payload->>'destination_id'=stop::text and (payload->>'version')::bigint=1792627200123
   from notification_push_receipts where payload->>'status'='paused'), 'pause lost original destination/start identity';
 assert (select count(distinct (payload->>'destination_id',payload->>'status',payload->>'version'))=4
   from notification_push_receipts where payload->>'category'='journey'), 'lifecycle identity collision';
 update public.itinerary_items set closed_at=now() where id='d3010000-0000-4000-8000-000000000021';
 update public.groups set journey_status='paused',active_destination_id=null,journey_started_at=null where id=g;
 assert (select count(*)=4 from notification_push_receipts where payload->>'category'='journey'), 'completion emitted a user pause';
end;
$assertions$;
$test$,'journey push identity distinguishes lifecycle events and retains paused destination');

select lives_ok($test$
do $assertions$
declare g uuid:='d3010000-0000-4000-8000-000000000010'; member uuid:='d3010000-0000-4000-8000-000000000002'; v_before bigint;
begin
 select count(*) into v_before from notification_push_receipts where payload->>'category'='member_left';
 insert into public.memberships(group_id,user_id,role) values(g,member,'follower');
 delete from public.memberships where group_id=g and user_id=member;
 insert into public.memberships(group_id,user_id,role) values(g,member,'follower');
 perform set_config('request.jwt.claim.sub',member::text,true);
 delete from public.groups where id=g;
 assert (select count(*)=v_before from notification_push_receipts where payload->>'category'='member_left'), 'foreign removal or group cleanup emitted self departure';
end;
$assertions$;
$test$,'foreign removals and deleted-group cleanup do not invent voluntary departure');

select * from finish();
rollback;
