-- Run against the complete migrated Supabase schema; fixtures roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(28);

insert into auth.users(id,email,is_anonymous) values
 ('c1111111-1111-4111-8111-111111111111','capability-a@example.test',false),
 ('c2222222-2222-4222-8222-222222222222','capability-b@example.test',false);
insert into profiles(id,nickname) values
 ('c1111111-1111-4111-8111-111111111111','Capability A'),
 ('c2222222-2222-4222-8222-222222222222','Capability B');
insert into groups(id,name,invite_code,created_by) values
 ('c3aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','This device','CAP001','c1111111-1111-4111-8111-111111111111'),
 ('c3bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other device','CAP002','c1111111-1111-4111-8111-111111111111');
insert into memberships(group_id,user_id,role) values
 ('c3aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-1111-4111-8111-111111111111','leader'),
 ('c3bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c1111111-1111-4111-8111-111111111111','leader');
insert into itinerary_items(id,group_id,title,position) values
 ('c4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c3aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','This destination',0),
 ('c4bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c3bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other destination',0);
insert into push_tokens(user_id,token,device_id) values
 ('c1111111-1111-4111-8111-111111111111','other-device-token','device-b'),
 ('c2222222-2222-4222-8222-222222222222','other-account-token','device-a'),
 ('c1111111-1111-4111-8111-111111111111','legacy-device-token',null);
insert into device_live_activity_tokens(user_id,device_id,push_to_start_token) values
 ('c1111111-1111-4111-8111-111111111111','device-b',repeat('b',64));
insert into live_activity_sessions(user_id,group_id,destination_id,activity_id,push_token,initial_distance_m,current_distance_m,travel_mode,device_id) values
 ('c1111111-1111-4111-8111-111111111111','c3bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c4bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','other-activity',repeat('d',64),100,80,'walk','device-b');

select ok(not has_function_privilege('anon','public.revoke_installation_capabilities(text,text,text[])','EXECUTE'),'anon cannot revoke capabilities');
select ok(not has_table_privilege('authenticated','public.revoked_installation_sessions','INSERT'),'client cannot edit revocation fences');

select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"c5555555-5555-4555-8555-555555555555"}',true);
set local role authenticated;
select lives_ok($$insert into public.push_tokens(user_id,token,device_id) values('c1111111-1111-4111-8111-111111111111','this-device-token','device-a')$$,'normal push registration works');
select lives_ok($$insert into public.device_live_activity_tokens(user_id,device_id,push_to_start_token) values('c1111111-1111-4111-8111-111111111111','device-a',repeat('a',64))$$,'normal push-to-start registration works');
select lives_ok($$insert into public.live_activity_sessions(user_id,group_id,destination_id,activity_id,push_token,initial_distance_m,current_distance_m,travel_mode,device_id) values('c1111111-1111-4111-8111-111111111111','c3aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','this-activity',repeat('c',64),100,80,'walk','device-a')$$,'normal per-activity registration works with membership RLS');
select lives_ok($$select public.revoke_installation_capabilities('device-a','legacy-device-token',array['this-activity'])$$,'logout revokes in one transaction');
select is((select count(*)::int from public.push_tokens where device_id='device-a'),0,'current device push removed');
select is((select count(*)::int from public.device_live_activity_tokens where device_id='device-a'),0,'current device push-to-start removed');
select is((select count(*)::int from public.live_activity_sessions where device_id='device-a'),0,'current device per-activity removed');
reset role;
select is((select count(*)::int from public.push_tokens where user_id='c2222222-2222-4222-8222-222222222222'),1,'other account retained');
select is((select count(*)::int from public.push_tokens where token='other-device-token'),1,'other device push retained');
select is((select count(*)::int from public.device_live_activity_tokens where device_id='device-b'),1,'other device push-to-start retained');
select is((select count(*)::int from public.live_activity_sessions where activity_id='other-activity'),1,'other device activity retained');
set local role authenticated;
select lives_ok($$select public.revoke_installation_capabilities('device-a')$$,'revocation retry is idempotent');
select throws_ok($$insert into public.push_tokens(user_id,token,device_id) values('c1111111-1111-4111-8111-111111111111','late-token','device-a')$$,'42501',null,'late push registration cannot resurrect revoked session');
select throws_ok($$insert into public.device_live_activity_tokens(user_id,device_id,push_to_start_token) values('c1111111-1111-4111-8111-111111111111','device-a',repeat('a',64))$$,'42501',null,'late push-to-start cannot resurrect revoked session');
select throws_ok($$insert into public.live_activity_sessions(user_id,group_id,destination_id,activity_id,initial_distance_m,current_distance_m,travel_mode,device_id) values('c1111111-1111-4111-8111-111111111111','c3aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','late-activity',100,80,'walk','device-a')$$,'42501',null,'late activity cannot resurrect revoked session');
select throws_ok($$insert into public.push_tokens(user_id,token,device_id) values('c2222222-2222-4222-8222-222222222222','foreign-write','device-a')$$,'42501',null,'cannot register another account token');
select throws_ok($$insert into public.push_tokens(user_id,token) values('c1111111-1111-4111-8111-111111111111','unbound-token')$$,'42501',null,'registration requires installation binding');
select throws_ok($$select public.revoke_installation_capabilities('short')$$,'42501',null,'revocation validates installation identifier');

select set_config('request.jwt.claims','{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"c6666666-6666-4666-8666-666666666666"}',true);
select lives_ok($$insert into public.push_tokens(user_id,token,device_id) values('c1111111-1111-4111-8111-111111111111','fresh-token','device-a')$$,'fresh authentication registers normally');
select set_config('request.jwt.claims','{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select throws_ok($$select public.revoke_installation_capabilities('device-a')$$,'42501',null,'missing session claim fails closed');
reset role;
set local role anon;
select throws_ok($$select public.revoke_installation_capabilities('device-a')$$,'42501',null,'anon call fails');
reset role;
select set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"c7777777-7777-4777-8777-777777777777"}',true);
set local role authenticated;
select lives_ok($$insert into public.push_tokens(user_id,token,device_id) values('c2222222-2222-4222-8222-222222222222','account-switch-token','device-a')$$,'new account can register the same installation');
select lives_ok($$insert into public.push_tokens(user_id,token,device_id) values('c2222222-2222-4222-8222-222222222222','fresh-token','device-a')$$,'same installation token rebinds atomically to the new account');
select throws_ok($$insert into public.push_tokens(user_id,token,device_id) values('c2222222-2222-4222-8222-222222222222','other-device-token','device-a')$$,'23505',null,'another installation token cannot be stolen');
reset role;
select is((select count(*)::int from public.push_tokens where token='fresh-token'),1,'physical push token has one delivery owner');
select is((select user_id::text from public.push_tokens where token='fresh-token'),'c2222222-2222-4222-8222-222222222222','rebound token belongs only to new account');
select * from finish();
rollback;
