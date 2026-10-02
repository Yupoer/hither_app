-- Rollback-only PostgreSQL regression; also runnable by supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(1);
insert into auth.users(id,email) values
 ('c1111111-1111-4111-8111-111111111111','security-owner@example.test'),
 ('c2222222-2222-4222-8222-222222222222','security-follower@example.test'),
 ('c3333333-3333-4333-8333-333333333333','security-free@example.test');
insert into public.profiles(id,nickname) values
 ('c1111111-1111-4111-8111-111111111111','Owner'),
 ('c2222222-2222-4222-8222-222222222222','Follower'),
 ('c3333333-3333-4333-8333-333333333333','Free');
insert into public.groups(id,name,invite_code,created_by) values
 ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Security','SECURE','c2222222-2222-4222-8222-222222222222'),
 ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Free','FREE01','c3333333-3333-4333-8333-333333333333');
insert into public.memberships(group_id,user_id,role) values
 ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-1111-4111-8111-111111111111','leader'),
 ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c2222222-2222-4222-8222-222222222222','follower'),
 ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c3333333-3333-4333-8333-333333333333','leader');
insert into public.promo_codes(code,plan_name,plan_code,remaining_uses) values
 ('SECURITY-ONE','Premium','lifetime_premium',1),
 ('security-case','Premium','lifetime_premium',1);
set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
do $$
declare
 g uuid := 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 r jsonb;
begin
 assert (public.redeem_promo_code('SECURITY-ONE', null::uuid)::jsonb->>'success')::boolean;
 assert (public.redeem_promo_code('SECURITY-ONE', null::uuid)::jsonb->>'code') = 'already_used';
 -- Premium still accepts a small import into the unscheduled pool.
 assert public.import_itinerary_batch(g,null,null,'[{"title":"Pool","latitude":25,"longitude":121}]') = 1;
 assert (select day is null from public.itinerary_items where group_id=g and title='Pool');
 begin
   perform public.import_itinerary_batch(g,null,1,
     (select jsonb_agg(jsonb_build_object('title','X','latitude',25,'longitude',121)) from generate_series(1,101)));
   raise exception 'premium batch ceiling missing';
 exception when sqlstate '22023' then assert sqlerrm = 'import batch limit exceeded'; end;
 begin
   perform public.import_itinerary_batch(g,null,1,jsonb_build_array(jsonb_build_object('title',repeat('X',513),'latitude',25,'longitude',121)));
   raise exception 'title ceiling missing';
 exception when sqlstate '22023' then assert sqlerrm = 'invalid import item title'; end;
 begin
   perform public.import_itinerary_batch(g,null,1,jsonb_build_array(jsonb_build_object('title','X','address',repeat('X',2049),'latitude',25,'longitude',121)));
   raise exception 'address ceiling missing';
 exception when sqlstate '22023' then assert sqlerrm = 'invalid import item title'; end;
 begin
   perform public.import_itinerary_batch(g,null,1,jsonb_build_array(jsonb_build_object('title','X','extra',repeat('X',1048576),'latitude',25,'longitude',121)));
   raise exception 'payload ceiling missing';
 exception when sqlstate '22023' then assert sqlerrm = 'import batch limit exceeded'; end;
 assert (select count(*) = 1 from public.itinerary_items where group_id=g), 'rejected imports persisted rows';
end;
$$;
select set_config('request.jwt.claim.sub','c3333333-3333-4333-8333-333333333333',true);
do $$ begin
 assert public.redeem_promo_code('SECURITY-ONE', null::uuid)::jsonb->>'code' = 'already_used';
 begin
   perform public.import_itinerary_batch('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,1,
     (select jsonb_agg(jsonb_build_object('title','X','latitude',25,'longitude',121)) from generate_series(1,101)));
   raise exception 'free batch ceiling missing';
 exception when sqlstate '22023' then assert sqlerrm = 'import batch limit exceeded'; end;
 assert (public.redeem_promo_code('security-case', null::uuid)::jsonb->>'success')::boolean, 'case fallback redemption failed';
end; $$;
select set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222',true);
do $$
declare t text; r jsonb;
begin
 for t in select unnest(array['gather','find_gathering','depart','rest','be_careful','go_left','go_right','stop','hurry_up']) loop
   begin
     insert into public.commands(group_id,sender_id,type) values
       ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),t);
     raise exception 'follower leader-command permission: %',t;
   exception when insufficient_privilege then null; end;
   r := public.apply_core_operation_v3(gen_random_uuid(),'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),
     'group_snapshot','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,'send_command',jsonb_build_object('type',t),1);
   assert r->'conflict'->>'code'='unauthorized', 'follower v3 leader command accepted: '||r::text;
 end loop;
 assert not exists(select 1 from public.core_notification_outbox where group_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'denied commands entered outbox';
 for t in select unnest(array['need_restroom','need_break','need_help','found_something','request_start','custom']) loop
   insert into public.commands(group_id,sender_id,type) values
     ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),t);
 end loop;
end;
$$;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
do $$
declare t text; g public.groups;
begin
 for t in select unnest(array['gather','find_gathering','depart','rest','be_careful','go_left','go_right','stop','hurry_up','custom']) loop
   insert into public.commands(group_id,sender_id,type) values
     ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),t);
 end loop;
 g := public.create_group('Bootstrap');
 assert exists(select 1 from public.groups where id=g.id), 'atomic creation cannot read group';
 assert exists(select 1 from public.memberships where group_id=g.id and user_id=auth.uid() and role='leader');
end;
$$;
reset role;
do $$ begin
 assert (select remaining_uses=0 from public.promo_codes where code='SECURITY-ONE');
 assert (select count(*)=1 from public.promo_redemptions where code='SECURITY-ONE');
 begin update public.promo_codes set remaining_uses=-1 where code='SECURITY-ONE';
   raise exception 'negative remaining uses accepted';
 exception when check_violation then null; end;
end; $$;
-- A seeded, cancelled session still accepts a current member's offline event.
insert into public.itinerary_items(id,group_id,title,latitude,longitude,position,day,kind) values
 ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Session point',25,121,1,1,'stop');
set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
select public.start_navigation_session('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0101');
reset role;
update public.navigation_sessions set status='cancelled',ended_at=now() where id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0101';
set local role authenticated;
select set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222',true);
do $$
declare r jsonb;
begin
 r := public.apply_core_operation_v3('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0301','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),
   'itinerary','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',0,'record_arrival',
   jsonb_build_object('navigationSessionId','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0101','userId',auth.uid(),'arrived',true),1);
 assert r->>'status'='accepted', 'current-member offline arrival rejected: '||r::text;
end;
$$;
reset role;
delete from public.memberships where group_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='c2222222-2222-4222-8222-222222222222';
do $$ begin
 assert (select invite_code<>'SECURE' from public.groups where id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'leave did not revoke old invite';
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222',true);
do $$
declare r jsonb;
begin
 assert not exists(select 1 from public.groups where id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'former creator still sees invite';
 begin perform public.join_group('SECURE'); raise exception 'revoked invite accepted';
 exception when sqlstate 'P0002' then null; end;
 r := public.apply_core_operation_v3('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0302','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),
   'itinerary','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',0,'record_arrival',
   jsonb_build_object('navigationSessionId','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0101','userId',auth.uid(),'arrived',false),2);
 assert r->'conflict'->>'code'='unauthorized', 'former-member arrival accepted: '||r::text;
end;
$$;
reset role;
do $$ begin
 assert not exists(select 1 from public.navigation_arrival_events where operation_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0302');
 assert exists(select 1 from public.navigation_session_history where navigation_session_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0101' and user_id='c2222222-2222-4222-8222-222222222222' and arrived), 'unauthorized undo changed historical arrival';
end; $$;
update public.account_import_quotas set rate_window_count=1000 where user_id='c1111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
do $$ begin
 begin perform public.import_itinerary_batch('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'[{"title":"Rate","latitude":25,"longitude":121}]');
   raise exception 'hourly rate ceiling missing';
 exception when sqlstate 'P0004' then assert sqlerrm='import rate limit exceeded'; end;
end; $$;
reset role;
update public.account_import_quotas set rate_window_count=0 where user_id='c1111111-1111-4111-8111-111111111111';
insert into public.itinerary_items(group_id,title,latitude,longitude,position,day)
 select 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Existing '||n,25,121,n+1,null from generate_series(1,998) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
do $$ begin
 begin perform public.import_itinerary_batch('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'[{"title":"Aggregate","latitude":25,"longitude":121}]');
   raise exception 'group aggregate ceiling missing';
 exception when sqlstate 'P0004' then assert sqlerrm='group import limit exceeded'; end;
 assert (select count(*)=1000 from public.itinerary_items where group_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'limit rejection changed existing data';
end; $$;
select pass('promo limits, creator revocation, bootstrap, import ceilings, command role matrix, current/former member offline arrivals');
select * from finish();
rollback;
