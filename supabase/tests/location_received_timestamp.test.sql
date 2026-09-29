begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(3);

insert into auth.users(id, email, is_anonymous) values
  ('e1111111-1111-4111-8111-111111111111', 'location-clock@example.test', false);
insert into public.groups(id, name, invite_code, created_by) values
  ('e2222222-2222-4222-8222-222222222222', 'Location clock', 'CLK001',
   'e1111111-1111-4111-8111-111111111111');
insert into public.member_locations(group_id, user_id, latitude, longitude, captured_at, updated_at) values
  ('e2222222-2222-4222-8222-222222222222', 'e1111111-1111-4111-8111-111111111111',
   25, 121, '2026-01-01T10:00:00Z', '2099-01-01T10:00:00Z');

select ok((select abs(extract(epoch from (updated_at - clock_timestamp()))) < 5
  from public.member_locations where user_id = 'e1111111-1111-4111-8111-111111111111'),
  'upload time comes from server, not device clock');
select is((select captured_at from public.member_locations
  where user_id = 'e1111111-1111-4111-8111-111111111111'),
  '2026-01-01T10:00:00Z'::timestamptz, 'offline capture time is preserved');
update public.member_locations set updated_at = '2099-01-01T10:00:00Z'
  where user_id = 'e1111111-1111-4111-8111-111111111111';
select ok((select abs(extract(epoch from (updated_at - clock_timestamp()))) < 5
  from public.member_locations where user_id = 'e1111111-1111-4111-8111-111111111111'),
  'updates cannot forge upload time');
select * from finish();
rollback;
