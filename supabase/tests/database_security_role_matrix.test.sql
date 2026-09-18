-- Database security slice: direct membership/profile writes stay closed while
-- self leave, authorized RPCs, and current client profile upsert continue to work.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(46);

insert into auth.users (id, email, is_anonymous) values
  ('b1111111-1111-4111-8111-111111111111', 'security-leader@example.test', false),
  ('b2222222-2222-4222-8222-222222222222', 'security-peer@example.test', false),
  ('b3333333-3333-4333-8333-333333333333', 'security-outsider@example.test', false),
  ('b4444444-4444-4444-8444-444444444444', 'security-new@example.test', false),
  ('b5555555-5555-4555-8555-555555555555', null, true),
  ('b6666666-6666-4666-8666-666666666666', null, true);

insert into public.profiles (id, nickname) values
  ('b1111111-1111-4111-8111-111111111111', 'Leader'),
  ('b2222222-2222-4222-8222-222222222222', 'Premium peer'),
  ('b3333333-3333-4333-8333-333333333333', 'Outsider'),
  ('b5555555-5555-4555-8555-555555555555', 'Anonymous'),
  ('b6666666-6666-4666-8666-666666666666', 'Expired leader');

select public.allow_entitlement_profile_write();
update public.profiles
set pro = true,
    pro_plan = 'premium',
    pro_purchased_at = now() - interval '1 day',
    pro_expires_at = now() + interval '1 day'
where id = 'b2222222-2222-4222-8222-222222222222';

insert into public.groups (id, name, invite_code, created_by) values
  (
    'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Security group',
    'SEC001',
    'b1111111-1111-4111-8111-111111111111'
  ),
  (
    'b1bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Other group',
    'SEC002',
    'b3333333-3333-4333-8333-333333333333'
  ),
  (
    'b6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Expired group',
    'SEC006',
    'b6666666-6666-4666-8666-666666666666'
  );

insert into public.memberships (group_id, user_id, role) values
  (
    'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b1111111-1111-4111-8111-111111111111',
    'leader'
  ),
  (
    'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b2222222-2222-4222-8222-222222222222',
    'follower'
  ),
  (
    'b1bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'b3333333-3333-4333-8333-333333333333',
    'leader'
  ),
  (
    'b6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b6666666-6666-4666-8666-666666666666',
    'leader'
  );

select public.allow_anonymous_expiry_write();
update public.profiles
set anonymous_expires_at = now() - interval '1 hour'
where id = 'b6666666-6666-4666-8666-666666666666';

-- Effective table/column boundaries.
select ok(
  not has_table_privilege('authenticated', 'public.memberships', 'INSERT'),
  'authenticated cannot INSERT memberships directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.memberships', 'UPDATE'),
  'authenticated cannot UPDATE memberships directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.memberships', 'TRUNCATE'),
  'authenticated cannot TRUNCATE memberships'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'id', 'INSERT'),
  'profile upsert may INSERT its own id'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'nickname', 'INSERT'),
  'profile upsert may INSERT editable nickname'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'pro', 'INSERT'),
  'profile INSERT cannot name server-owned pro'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'),
  'profile upsert may include id in conflict UPDATE'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'nickname', 'UPDATE'),
  'profile UPDATE may edit nickname'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'pro', 'UPDATE'),
  'profile UPDATE cannot name server-owned pro'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'),
  'authenticated cannot TRUNCATE profiles'
);
select ok(
  not has_function_privilege('authenticated', 'public.ensure_anonymous_expiry(uuid)', 'EXECUTE'),
  'authenticated cannot call the internal expiry stamper directly'
);
select ok(
  has_function_privilege('authenticated', 'public.clear_anonymous_expiry_if_registered(uuid)', 'EXECUTE'),
  'authenticated retains the client self-clear RPC'
);
select ok(
  (select p.prosecdef from pg_proc p
    where p.oid = 'public.start_navigation_session(uuid,uuid,uuid)'::regprocedure),
  'navigation RPC is SECURITY DEFINER after membership UPDATE hardening'
);
select ok(
  exists(
    select 1
    from pg_proc p
    where p.oid = 'public.start_navigation_session(uuid,uuid,uuid)'::regprocedure
      and p.prosecdef
      and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=%'
  ),
  'navigation RPC keeps an explicit locked search_path'
);
select is(
  (select public from storage.buckets where id = 'feedback-screenshots'),
  false,
  'feedback screenshots bucket remains private'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'feedback screenshots: upload own'
      and cmd = 'INSERT'),
  1,
  'feedback storage keeps its owner-scoped INSERT policy'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'feedback screenshots: upload own'
      and cmd = 'SELECT'),
  0,
  'feedback storage has no client SELECT policy'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'feedback screenshots: upload own'
      and cmd = 'UPDATE'),
  0,
  'feedback storage has no client UPDATE policy'
);
select ok(
  not has_function_privilege('anon', 'public.prevent_client_pro_self_grant()', 'EXECUTE'),
  'trigger-only pro guard is not publicly executable'
);
select ok(
  not has_function_privilege('anon', 'public.delete_empty_group_or_subgroup()', 'EXECUTE'),
  'trigger/maintenance SD function is not anonymously executable'
);
select ok(
  has_function_privilege('authenticated', 'public.effective_live_activity_entitlement(uuid,uuid)', 'EXECUTE'),
  'audit: entitlement helper remains authenticated-executable for follow-up cross-group review'
);

-- JSON-only role claims are used below; the legacy role GUC is intentionally
-- not set. auth.uid() still receives the subject through the compatibility
-- subject GUC used by the local SQL harness.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b4444444-4444-4444-8444-444444444444', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b4444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);

select throws_ok(
  $$insert into public.memberships (group_id, user_id, role)
    values ('b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'b4444444-4444-4444-8444-444444444444', 'leader')$$,
  '42501',
  null,
  'authenticated cannot create a membership directly'
);
select throws_ok(
  $$update public.memberships set role = 'leader'
    where group_id = 'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = 'b2222222-2222-4222-8222-222222222222'$$,
  '42501',
  null,
  'authenticated cannot change a membership role directly'
);
select throws_ok(
  $$insert into public.profiles (id, nickname, pro)
    values ('b4444444-4444-4444-8444-444444444444', 'attacker', true)$$,
  '42501',
  null,
  'authenticated cannot INSERT server-owned profile fields'
);
select throws_ok(
  $$update public.profiles set pro = true
    where id = 'b4444444-4444-4444-8444-444444444444'$$,
  '42501',
  null,
  'authenticated cannot UPDATE server-owned profile fields'
);
select lives_ok(
  $$insert into public.profiles (id, nickname)
    values ('b4444444-4444-4444-8444-444444444444', 'Editable')$$,
  'authenticated can INSERT editable profile fields'
);
select is(
  (select pro from public.profiles where id = 'b4444444-4444-4444-8444-444444444444'),
  false,
  'editable profile INSERT receives the server default for pro'
);
select throws_ok(
  $$select public.ensure_anonymous_expiry('b1111111-1111-4111-8111-111111111111')$$,
  '42501',
  null,
  'authenticated cannot invoke the internal expiry stamper'
);

select lives_ok(
  $$select public.clear_anonymous_expiry_if_registered(
    'b4444444-4444-4444-8444-444444444444'
  )$$,
  'authenticated caller can clear its own registered profile expiry'
);
select throws_ok(
  $$select public.clear_anonymous_expiry_if_registered(
    'b1111111-1111-4111-8111-111111111111'
  )$$,
  '42501',
  null,
  'authenticated caller cannot clear another profile expiry'
);

-- No subject plus a JSON-only authenticated role must not authorize a clear.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$select public.clear_anonymous_expiry_if_registered(
    'b1111111-1111-4111-8111-111111111111'
  )$$,
  '42501',
  null,
  'JSON-only authenticated caller without a subject cannot clear a profile'
);

-- An active member cannot invoke the SD navigation RPC for another group.
select set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.start_navigation_session(
    'b1bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'b7aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b7bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  )$$,
  '42501',
  null,
  'navigation SD RPC rejects a cross-group actor before reading the group'
);

-- An expired anonymous leader is still present in memberships but cannot start
-- navigation after the explicit membership + expiry guards.
select set_config('request.jwt.claim.sub', 'b6666666-6666-4666-8666-666666666666', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b6666666-6666-4666-8666-666666666666","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.start_navigation_session(
    'b6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b7cccccc-cccc-4ccc-8ccc-cccccccccccc',
    'b7dddddd-dddd-4ddd-8ddd-dddddddddddd'
  )$$,
  '42501',
  null,
  'expired anonymous leader cannot start navigation'
);

-- Authorized RPC insert path still works after direct INSERT is revoked.
select set_config('request.jwt.claim.sub', 'b5555555-5555-4555-8555-555555555555', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b5555555-5555-4555-8555-555555555555","role":"authenticated"}',
  true
);
select lives_ok(
  $$select public.join_group('SEC001')$$,
  'authorized join_group RPC can insert a membership'
);
select is(
  (select count(*)::int from public.memberships
    where group_id = 'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = 'b5555555-5555-4555-8555-555555555555'),
  1,
  'join_group inserted the anonymous membership'
);
select ok(
  (select anonymous_expires_at > now() from public.profiles
    where id = 'b5555555-5555-4555-8555-555555555555'),
  'join_group server path still stamps anonymous expiry'
);

-- Raw leader DELETE no longer bypasses kick_group_member's atomic rotation.
select set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
delete from public.memberships
where group_id = 'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = 'b2222222-2222-4222-8222-222222222222';
select is(
  (select count(*)::int from public.memberships
    where group_id = 'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = 'b2222222-2222-4222-8222-222222222222'),
  1,
  'leader raw DELETE leaves the target membership intact'
);
select is(
  (select pro from public.profiles
    where id = 'b2222222-2222-4222-8222-222222222222'),
  true,
  'audit: same-group peer can currently read the sensitive pro field'
);
select lives_ok(
  $$select public.kick_group_member(
    'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'b2222222-2222-4222-8222-222222222222'
  )$$,
  'dedicated kick_group_member RPC remains authorized'
);
select is(
  (select count(*)::int from public.memberships
    where group_id = 'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = 'b2222222-2222-4222-8222-222222222222'),
  0,
  'kick_group_member removes the target membership'
);

-- Self DELETE remains the intentional leave path.
select set_config('request.jwt.claim.sub', 'b5555555-5555-4555-8555-555555555555', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b5555555-5555-4555-8555-555555555555","role":"authenticated"}',
  true
);
delete from public.memberships
where group_id = 'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = 'b5555555-5555-4555-8555-555555555555';
select is(
  (select count(*)::int from public.memberships
    where group_id = 'b1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = 'b5555555-5555-4555-8555-555555555555'),
  0,
  'self DELETE removes only the caller membership'
);

-- Actual ProfileService upsert shape: id is present in the payload and the
-- conflict update includes id plus editable fields, never server-owned fields.
select set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
select lives_ok(
  $$insert into public.profiles (id, nickname)
    values ('b2222222-2222-4222-8222-222222222222', 'Updated peer')
    on conflict (id) do update
      set id = excluded.id, nickname = excluded.nickname$$,
  'client profile upsert including id can update editable fields'
);
select is(
  (select pro from public.profiles where id = 'b2222222-2222-4222-8222-222222222222'),
  true,
  'profile upsert preserves server-owned pro'
);
select is(
  (select pro_plan from public.profiles where id = 'b2222222-2222-4222-8222-222222222222'),
  'premium',
  'profile upsert preserves server-owned pro_plan'
);
select ok(
  (select pro_expires_at > now() from public.profiles
    where id = 'b2222222-2222-4222-8222-222222222222'),
  'profile upsert preserves server-owned expiry'
);

-- RLS still blocks a member from another group's row set.
select set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
select is(
  (select count(*)::int from public.groups
    where id = 'b1bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'cross-group group rows remain hidden by RLS'
);

select * from finish();
rollback;
