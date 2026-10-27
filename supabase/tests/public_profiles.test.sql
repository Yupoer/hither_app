begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select no_plan();

select columns_are('public', 'public_profiles', array['id', 'nickname', 'avatar', 'avatar_color'],
  'public profile storage exposes exactly four fields');
select ok(not has_table_privilege('anon', 'public.public_profiles', 'SELECT'), 'anon cannot select public profiles');
select ok(not has_table_privilege('authenticated', 'public.public_profiles', 'INSERT,UPDATE,DELETE'),
  'authenticated cannot write public profiles');
select ok(not has_function_privilege('authenticated', 'extensions.sync_public_profile()', 'EXECUTE'),
  'client cannot invoke projection writer');
select ok(exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime'
  and schemaname = 'public' and tablename = 'public_profiles'), 'public profiles are published');
select ok(exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime'
  and schemaname = 'public' and tablename = 'profiles'), 'legacy profiles remain published during compatibility window');
select is((select count(*) from public.public_profiles), (select count(*) from public.profiles),
  'migration backfills every existing profile');

insert into auth.users(id,email,is_anonymous) values
 ('d2700000-0000-4000-8000-000000000001','public-owner@example.test',false),
 ('d2700000-0000-4000-8000-000000000002','public-peer@example.test',false),
 ('d2700000-0000-4000-8000-000000000003','public-outsider@example.test',false),
 ('d2700000-0000-4000-8000-000000000004','public-expired@example.test',true),
 ('d2700000-0000-4000-8000-000000000005','public-upsert@example.test',false),
 ('d2700000-0000-4000-8000-000000000006','public-delete@example.test',false);
insert into public.profiles(id,nickname,avatar,avatar_color,preferences,onboarding) values
 ('d2700000-0000-4000-8000-000000000001','Owner','O','#112233','{"secret":"owner-preferences"}','{"secret":"owner-onboarding"}'),
 ('d2700000-0000-4000-8000-000000000002','Peer','P',null,'{"secret":"peer-preferences"}','{"secret":"peer-onboarding"}'),
 ('d2700000-0000-4000-8000-000000000003','Outsider',null,null,'{}','{}'),
 ('d2700000-0000-4000-8000-000000000004','Expired',null,null,'{}','{}'),
 ('d2700000-0000-4000-8000-000000000006','Delete',null,null,'{}','{}');
insert into public.groups(id,name,invite_code,created_by) values
 ('d2700000-0000-4000-8000-000000000010','Public contract','P27001','d2700000-0000-4000-8000-000000000001');
insert into public.memberships(group_id,user_id,role,created_at) values
 ('d2700000-0000-4000-8000-000000000010','d2700000-0000-4000-8000-000000000001','leader',now()-interval '20 days'),
 ('d2700000-0000-4000-8000-000000000010','d2700000-0000-4000-8000-000000000002','follower',now()-interval '20 days'),
 ('d2700000-0000-4000-8000-000000000010','d2700000-0000-4000-8000-000000000004','follower',now()-interval '20 days');
select public.allow_anonymous_expiry_write();
update public.profiles set anonymous_expires_at=now()-interval '1 hour'
 where id='d2700000-0000-4000-8000-000000000004';

create temporary table public_profile_events(old_row jsonb,new_row jsonb);
create function pg_temp.capture_public_profile() returns trigger language plpgsql set search_path = pg_temp as $$
begin
 insert into public_profile_events values(to_jsonb(old),to_jsonb(new));
 return new;
end;
$$;
create trigger capture_public_profile after update on public.public_profiles
 for each row execute function pg_temp.capture_public_profile();

set local role authenticated;
select set_config('request.jwt.claim.sub','d2700000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is((select to_jsonb(p) from public.public_profiles p where id='d2700000-0000-4000-8000-000000000002'),
 '{"id":"d2700000-0000-4000-8000-000000000002","nickname":"Peer","avatar":"P","avatar_color":null}'::jsonb,
 'co-member receives the complete exact public shape');
select is((select count(*) from public.public_profiles where id='d2700000-0000-4000-8000-000000000003'),0::bigint,
 'member cannot read unrelated profiles');
select is((select count(*) from public.public_profiles where id='d2700000-0000-4000-8000-000000000004'),1::bigint,
 'active member still sees expired peer identity as with existing membership semantics');
select is((select to_jsonb(p)->'preferences'->>'secret' from public.profiles p where id=auth.uid()),
 'owner-preferences','owner wildcard read retains private preferences');
select is((select to_jsonb(p)->'onboarding'->>'secret' from public.profiles p where id=auth.uid()),
 'owner-onboarding','owner wildcard read retains onboarding');
select ok((select to_jsonb(p) ?& array['pro','pro_plan','pro_purchased_at','pro_expires_at','anonymous_expires_at','created_at']
 from public.profiles p where id=auth.uid()),'owner wildcard read retains server metadata');
select is((select preferences->>'secret' from public.profiles where id='d2700000-0000-4000-8000-000000000002'),
 'peer-preferences','legacy co-member base read is explicitly retained until a separately authorized cutoff');
select is(
  public.get_group_recovery_snapshot('d2700000-0000-4000-8000-000000000010')->'profiles',
  '[{"id":"d2700000-0000-4000-8000-000000000001","nickname":"Owner","avatar":"O","avatar_color":"#112233"},
    {"id":"d2700000-0000-4000-8000-000000000002","nickname":"Peer","avatar":"P","avatar_color":null},
    {"id":"d2700000-0000-4000-8000-000000000004","nickname":"Expired","avatar":null,"avatar_color":null}]'::jsonb,
  'recovery returns exact public identity values with no synthetic private secrets'
);
select is((select array_agg(key order by key) from jsonb_object_keys(
  public.get_group_recovery_snapshot('d2700000-0000-4000-8000-000000000010')) key),
  array['entity_versions','generated_at','group','itinerary','location_sharing','locations','memberships','profiles','realtime_revision','schema_version','subgroups']::text[],
  'recovery envelope retains every existing data family and version fence');
select throws_ok($$select preferences from public.public_profiles$$,'42703',null,'private columns do not exist in projection');
select throws_ok($$insert into public.public_profiles(id,nickname) values(auth.uid(),'Forged')$$,
 '42501',null,'owner cannot insert public profile directly');
select throws_ok($$update public.public_profiles set nickname='Forged' where id=auth.uid()$$,
 '42501',null,'owner cannot update public profile directly');
select throws_ok($$delete from public.public_profiles where id=auth.uid()$$,
 '42501',null,'owner cannot delete public profile directly');
select throws_ok($$update public.profiles set pro=true where id=auth.uid()$$,
 '42501',null,'premium self-grant remains denied');
select throws_ok($$update public.profiles set anonymous_expires_at=now()+interval '1 year' where id=auth.uid()$$,
 '42501',null,'client cannot change authoritative anonymous expiry');
select lives_ok($$update public.profiles set preferences='{"secret":"changed"}',onboarding='{"done":true}' where id=auth.uid()$$,
 'own preferences and onboarding writes remain available');
reset role;
select is((select count(*) from public_profile_events),0::bigint,'private-only update writes no public row or public UPDATE event');

set local role authenticated;
select lives_ok($$update public.profiles set nickname='Owner',avatar='O',avatar_color='#112233' where id=auth.uid()$$,
 'unchanged public identity is accepted');
reset role;
select is((select count(*) from public_profile_events),0::bigint,'unchanged public fields emit no public update');

set local role authenticated;
select lives_ok($$update public.profiles set nickname='Renamed',avatar='R',avatar_color='#445566' where id=auth.uid()$$,
 'own identity writes remain available');
select is((select to_jsonb(p) from public.public_profiles p where id=auth.uid()),
 '{"id":"d2700000-0000-4000-8000-000000000001","nickname":"Renamed","avatar":"R","avatar_color":"#445566"}'::jsonb,
 'identity fields synchronize in the same transaction');
reset role;
select is((select count(*) from public_profile_events),1::bigint,'one identity change emits one public update');
select is((select array_agg(key order by key) from public_profile_events,jsonb_object_keys(new_row) key),
 array['avatar','avatar_color','id','nickname']::text[],'new public update payload contains exactly public keys');
select is((select array_agg(key order by key) from public_profile_events,jsonb_object_keys(old_row) key),
 array['avatar','avatar_color','id','nickname']::text[],'stored old public row contains exactly public keys');

set local role authenticated;
select set_config('request.jwt.claim.sub','d2700000-0000-4000-8000-000000000005',true);
select lives_ok($$insert into public.profiles(id,nickname,avatar,preferences,onboarding)
 values(auth.uid(),'New','N','{"own":true}','{"done":true}')
 on conflict(id) do update set nickname=excluded.nickname returning id$$,
 'missing own row upsert with returning remains supported');
select is((select nickname from public.public_profiles where id=auth.uid()),'New','new own profile is projected immediately');
select lives_ok($$insert into public.profiles(id,nickname,avatar) values(auth.uid(),'Upserted',null)
 on conflict(id) do update set nickname=excluded.nickname,avatar=excluded.avatar returning id$$,
 'existing own row upsert with returning remains supported');
select is((select nickname from public.public_profiles where id=auth.uid()),'Upserted','existing own upsert updates projection');
select is((select avatar from public.public_profiles where id=auth.uid()),null::text,'public nullable fields synchronize');

select set_config('request.jwt.claim.sub','d2700000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.public_profiles where id in
 ('d2700000-0000-4000-8000-000000000001','d2700000-0000-4000-8000-000000000002')),0::bigint,
 'outsider sees no group member public profiles');
select is((select nickname from public.public_profiles where id=auth.uid()),'Outsider','outsider retains own public profile');
select throws_ok($$select public.get_group_recovery_snapshot('d2700000-0000-4000-8000-000000000010')$$,
 '42501',null,'outsider cannot bypass policy through recovery');
select set_config('request.jwt.claim.sub','d2700000-0000-4000-8000-000000000004',true);
select is((select count(*) from public.public_profiles where id in
 ('d2700000-0000-4000-8000-000000000001','d2700000-0000-4000-8000-000000000002')),0::bigint,
 'expired anonymous requester cannot read peers despite stored membership');
select is((select nickname from public.public_profiles where id=auth.uid()),'Expired','expired anonymous requester retains own profile');
select throws_ok($$select public.get_group_recovery_snapshot('d2700000-0000-4000-8000-000000000010')$$,
 '42501',null,'expired anonymous requester cannot bypass through recovery');

reset role;
update public.profiles set anonymous_expires_at=now()+interval '1 hour'
 where id='d2700000-0000-4000-8000-000000000004';
set local role authenticated;
select is((select count(*) from public.public_profiles where id in
 ('d2700000-0000-4000-8000-000000000001','d2700000-0000-4000-8000-000000000002')),2::bigint,
 'unexpired anonymous requester can read peers');
select set_config('request.jwt.claim.sub','d2700000-0000-4000-8000-000000000002',true);
select lives_ok($$delete from public.memberships where group_id='d2700000-0000-4000-8000-000000000010' and user_id=auth.uid()$$,
 'existing member leave path remains available');
select is((select count(*) from public.public_profiles where id='d2700000-0000-4000-8000-000000000001'),0::bigint,
 'membership loss immediately removes peer read authorization');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','anon',true);
set local role anon;
select throws_ok($$select * from public.public_profiles$$,'42501',null,'unauthenticated callers cannot query projection');
reset role;
delete from public.profiles where id='d2700000-0000-4000-8000-000000000006';
select is((select count(*) from public.public_profiles where id='d2700000-0000-4000-8000-000000000006'),0::bigint,
 'profile deletion cascades to its public projection');
delete from auth.users where id='d2700000-0000-4000-8000-000000000005';
select is((select count(*) from public.public_profiles where id='d2700000-0000-4000-8000-000000000005'),0::bigint,
 'account deletion cascades through profile to projection');
select * from finish();
rollback;
