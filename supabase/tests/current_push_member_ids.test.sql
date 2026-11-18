begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(2);

insert into auth.users(id, email, is_anonymous) values
  ('ad130000-0000-4000-8000-000000000001', 'push-registered@example.test', false),
  ('ad130000-0000-4000-8000-000000000002', 'push-anonymous@example.test', true),
  ('ad130000-0000-4000-8000-000000000003', 'push-expired@example.test', true),
  ('ad130000-0000-4000-8000-000000000004', 'push-departed@example.test', false);
insert into public.profiles(id, nickname) values
  ('ad130000-0000-4000-8000-000000000001', 'Registered'),
  ('ad130000-0000-4000-8000-000000000002', 'Anonymous'),
  ('ad130000-0000-4000-8000-000000000003', 'Expired'),
  ('ad130000-0000-4000-8000-000000000004', 'Departed');
insert into public.groups(id, name, invite_code, created_by) values
  ('ad130000-0000-4000-8000-000000000010', 'Push membership', 'PSH413', 'ad130000-0000-4000-8000-000000000001');
insert into public.memberships(group_id, user_id, role) values
  ('ad130000-0000-4000-8000-000000000010', 'ad130000-0000-4000-8000-000000000001', 'leader'),
  ('ad130000-0000-4000-8000-000000000010', 'ad130000-0000-4000-8000-000000000002', 'follower'),
  ('ad130000-0000-4000-8000-000000000010', 'ad130000-0000-4000-8000-000000000003', 'follower');
select public.allow_anonymous_expiry_write();
update public.profiles set anonymous_expires_at = case id
  when 'ad130000-0000-4000-8000-000000000002'::uuid then now() + interval '1 day'
  else now() - interval '1 day'
end where id in ('ad130000-0000-4000-8000-000000000002', 'ad130000-0000-4000-8000-000000000003');

select ok(
  not has_function_privilege('anon', 'public.current_push_member_ids(uuid, uuid[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.current_push_member_ids(uuid, uuid[])', 'EXECUTE')
  and has_function_privilege('service_role', 'public.current_push_member_ids(uuid, uuid[])', 'EXECUTE'),
  'only the backend service role can check arbitrary push candidates'
);

set local role service_role;
select is(
  (select array_agg(user_id order by user_id) from public.current_push_member_ids(
    'ad130000-0000-4000-8000-000000000010', array[
      'ad130000-0000-4000-8000-000000000001', 'ad130000-0000-4000-8000-000000000002',
      'ad130000-0000-4000-8000-000000000003', 'ad130000-0000-4000-8000-000000000004'
    ]::uuid[]
  )),
  array['ad130000-0000-4000-8000-000000000001', 'ad130000-0000-4000-8000-000000000002']::uuid[],
  'batch eligibility keeps registered and unexpired members and excludes expired or departed candidates'
);

select * from finish();
rollback;
