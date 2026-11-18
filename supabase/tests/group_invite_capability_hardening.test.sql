begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(16);

insert into auth.users (id, email, is_anonymous) values
  ('a1111111-1111-4111-8111-111111111111', 'invite-leader@example.test', false),
  ('a2222222-2222-4222-8222-222222222222', 'invite-peer@example.test', false),
  ('a3333333-3333-4333-8333-333333333333', 'invite-outsider@example.test', false);

select ok(
  not has_table_privilege('authenticated', 'public.groups', 'INSERT'),
  'authenticated cannot bypass create_group with a chosen invite code'
);
select ok(
  not has_column_privilege('authenticated', 'public.groups', 'invite_code', 'UPDATE'),
  'authenticated cannot replace an invite capability directly'
);
select ok(
  has_column_privilege('authenticated', 'public.groups', 'name', 'UPDATE'),
  'authenticated retains ordinary group name updates'
);
select ok(
  not has_function_privilege('authenticated', 'public.generate_group_invite_code()', 'EXECUTE'),
  'authenticated cannot invoke the internal capability generator'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
select matches(
  (public.create_group('Invite capability test')).invite_code,
  '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20}$',
  'create_group returns a 100-bit-alphabet invite capability'
);

reset role;
select set_config(
  'test.invite_code',
  (select invite_code from public.groups where name = 'Invite capability test'),
  true
);
select ok(
  exists (
    select 1
    from public.memberships m
    join public.groups g on g.id = m.group_id
    where g.name = 'Invite capability test'
      and m.user_id = 'a1111111-1111-4111-8111-111111111111'
      and m.role = 'leader'
  ),
  'create_group preserves atomic leader membership creation'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$insert into public.groups (name, invite_code, created_by)
    values ('Bypass', 'WEAK', 'a1111111-1111-4111-8111-111111111111')$$,
  '42501',
  null,
  'authenticated direct group creation is denied'
);
select throws_ok(
  $$update public.groups
    set invite_code = 'AAAAAAAAAAAAAAAAAAAA'
    where name = 'Invite capability test'$$,
  '42501',
  null,
  'authenticated direct invite replacement is denied'
);
select lives_ok(
  $$update public.groups
    set name = 'Renamed invite capability test'
    where name = 'Invite capability test'$$,
  'leader can still rename a group'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222222', true);
select lives_ok(
  format('select public.join_group(%L)', current_setting('test.invite_code')),
  'valid capability still joins the group'
);

reset role;
select ok(
  exists (
    select 1
    from public.memberships m
    join public.groups g on g.id = m.group_id
    where g.name = 'Renamed invite capability test'
      and m.user_id = 'a2222222-2222-4222-8222-222222222222'
      and m.role = 'follower'
  ),
  'valid capability preserves follower membership creation'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', true);
select throws_ok(
  $$select public.join_group('SHORT')$$,
  'P0002',
  'invalid invite code',
  'malformed capabilities receive the generic failure'
);
select throws_ok(
  $$select public.join_group('ZZZZZZZZZZZZZZZZZZZZ')$$,
  'P0002',
  'invalid invite code',
  'unknown well-formed capabilities receive the generic failure'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$delete from public.memberships
    where user_id = 'a2222222-2222-4222-8222-222222222222'
      and group_id = (
        select id from public.groups where name = 'Renamed invite capability test'
      )$$,
  'member can still leave a group'
);

reset role;
select isnt(
  (select invite_code from public.groups where name = 'Renamed invite capability test'),
  current_setting('test.invite_code'),
  'membership deletion revokes the previous capability'
);
select matches(
  (select invite_code from public.groups where name = 'Renamed invite capability test'),
  '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20}$',
  'membership deletion rotates to a strong capability'
);

select * from finish();
rollback;
