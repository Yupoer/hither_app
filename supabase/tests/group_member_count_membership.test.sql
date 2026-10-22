-- pgTAP: group_member_count requires membership (or a server caller).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(5);

insert into auth.users (id, email) values
  ('e1111111-1111-4111-8111-111111111111', 'count-leader@example.test'),
  ('e2222222-2222-4222-8222-222222222222', 'count-follower@example.test'),
  ('e3333333-3333-4333-8333-333333333333', 'count-outsider@example.test');
insert into public.profiles (id, nickname) values
  ('e1111111-1111-4111-8111-111111111111', 'Leader'),
  ('e2222222-2222-4222-8222-222222222222', 'Follower'),
  ('e3333333-3333-4333-8333-333333333333', 'Outsider');
insert into public.groups (id, name, invite_code, created_by) values
  ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Count', 'COUNT1', 'e1111111-1111-4111-8111-111111111111');
insert into public.memberships (group_id, user_id, role) values
  ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e1111111-1111-4111-8111-111111111111', 'leader'),
  ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2222222-2222-4222-8222-222222222222', 'follower');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);
select is(
  public.group_member_count('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  2,
  'a member reads the member count'
);

select set_config('request.jwt.claim.sub', 'e3333333-3333-4333-8333-333333333333', true);
select throws_ok(
  $$select public.group_member_count('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,
  '42501',
  'not a member of this group',
  'a non-member cannot probe another group''s size'
);
select is(
  (public.get_trip_entitlement('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'error'),
  'not_member',
  'internal callers still answer non-members with their own not_member result'
);

select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
select is(
  (public.get_trip_entitlement('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'member_count')::int,
  2,
  'get_trip_entitlement keeps reporting the count to members'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select is(
  public.group_member_count('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  2,
  'service_role (no auth.uid) still reads the count'
);

select * from finish();
rollback;
