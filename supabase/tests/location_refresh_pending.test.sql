-- pgTAP contract for the durable per-recipient location refresh ledger.
-- The fixture exercises cooldown expiry, recipient filtering, and versioned
-- ACK behavior in addition to the public boundary checks.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, auth;

select plan(26);

insert into auth.users (id, email) values
  ('f1111111-1111-4111-8111-111111111111', 'refresh-leader@example.test'),
  ('f2222222-2222-4222-8222-222222222222', 'refresh-follower@example.test'),
  ('f3333333-3333-4333-8333-333333333333', 'refresh-offline@example.test'),
  ('f4444444-4444-4444-8444-444444444444', 'refresh-outsider@example.test'),
  ('f5555555-5555-4555-8555-555555555555', 'refresh-expired-anon@example.test', true);

insert into public.profiles (id, nickname, anonymous_expires_at) values
  ('f5555555-5555-4555-8555-555555555555', 'Expired anon', now() + interval '1 hour');

insert into public.groups (id, name, invite_code, created_by) values (
  'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Refresh contract trip',
  'REFRESH1',
  'f1111111-1111-4111-8111-111111111111'
);

insert into public.memberships (group_id, user_id, role, status) values
  ('fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'f1111111-1111-4111-8111-111111111111', 'leader', 'active'),
  ('fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'f2222222-2222-4222-8222-222222222222', 'follower', 'active'),
  ('fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'f3333333-3333-4333-8333-333333333333', 'follower', 'offline'),
  ('fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'f5555555-5555-4555-8555-555555555555', 'follower', 'active');

update public.profiles
   set anonymous_expires_at = now() - interval '1 hour'
 where id = 'f5555555-5555-4555-8555-555555555555';

create temporary table location_refresh_pending_test_versions (
  requested_at timestamptz not null
);
create temporary table location_refresh_pending_test_latest (
  requested_at timestamptz not null
);

select has_table(
  'public',
  'location_refresh_pending',
  'per-recipient pending location refresh table exists'
);

select ok(
  exists (
    select 1
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
     where n.nspname = 'public'
       and r.relname = 'location_refresh_pending'
       and c.contype = 'p'
       and position('PRIMARY KEY (group_id, user_id)' in upper(pg_get_constraintdef(c.oid))) > 0
  ),
  'pending table primary key is group_id plus user_id'
);

select ok(
  (select c.relrowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'location_refresh_pending'),
  'pending table has RLS enabled'
);

select has_function(
  'public',
  'request_group_location_refresh',
  array['uuid']
);
select has_function(
  'public',
  'list_my_pending_location_refreshes',
  array[]::text[]
);
select has_function(
  'public',
  'ack_my_location_refresh',
  array['uuid', 'timestamp with time zone']
);

select ok(
  exists (
    select 1
      from pg_proc p
     where p.oid = 'public.request_group_location_refresh(uuid)'::regprocedure
       and p.prosecdef
       and exists (
         select 1
           from unnest(coalesce(p.proconfig, '{}'::text[])) setting
          where setting like 'search_path=%'
            and regexp_replace(setting, '^search_path=', '') in ('', '""')
       )
  ),
  'request RPC is SECURITY DEFINER with an empty search_path'
);

select ok(
  position('for update' in lower(pg_get_functiondef(
    'public.request_group_location_refresh(uuid)'::regprocedure
  ))) > 0,
  'request RPC locks the cooldown row before deciding acceptance'
);

select ok(
  position('SECURITY DEFINER' in upper(pg_get_functiondef(
    'public.list_my_pending_location_refreshes()'::regprocedure
  ))) > 0
  and position('SECURITY DEFINER' in upper(pg_get_functiondef(
    'public.ack_my_location_refresh(uuid,timestamptz)'::regprocedure
  ))) > 0,
  'list and ACK RPCs are SECURITY DEFINER'
);

select ok(
  not has_table_privilege('authenticated', 'public.location_refresh_pending', 'select'),
  'authenticated cannot read the ledger table directly'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.ack_my_location_refresh(uuid,timestamptz)',
    'execute'
  ),
  'authenticated can execute the explicit ACK RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (public.request_group_location_refresh('fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'accepted'),
  'true',
  'member request is accepted'
);

reset role;
insert into location_refresh_pending_test_versions (requested_at)
select requested_at
  from public.location_refresh_pending
 where group_id = 'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and user_id = 'f2222222-2222-4222-8222-222222222222';

select is(
  (select count(*)::int
     from public.location_refresh_pending
    where group_id = 'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'only the active, non-expired recipient receives a pending row'
);
select is(
  (select count(*)::int
     from public.location_refresh_pending
    where group_id = 'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = 'f5555555-5555-4555-8555-555555555555'),
  0,
  'an expired anonymous membership receives no pending row'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1111111-1111-4111-8111-111111111111', true);
select is(
  (public.request_group_location_refresh('fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'accepted'),
  'false',
  'the 60 second cooldown rejects a duplicate request'
);

select set_config('request.jwt.claim.sub', 'f2222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*)::int
     from public.list_my_pending_location_refreshes()),
  1,
  'recipient can list its own pending request through the RPC'
);

reset role;
update public.location_refresh_requests
   set requested_at = now() - interval '61 seconds'
 where group_id = 'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1111111-1111-4111-8111-111111111111', true);
select is(
  (public.request_group_location_refresh('fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'accepted'),
  'true',
  'an expired cooldown accepts a new request'
);

reset role;
select ok(
  (select requested_at
     from public.location_refresh_pending
    where group_id = 'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = 'f2222222-2222-4222-8222-222222222222')
  > (select requested_at from location_refresh_pending_test_versions),
  'a new request versions the recipient ledger row'
);
insert into location_refresh_pending_test_latest (requested_at)
select requested_at
  from public.location_refresh_pending
 where group_id = 'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and user_id = 'f2222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2222222-2222-4222-8222-222222222222', true);
select is(
  public.ack_my_location_refresh(
    'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select requested_at from location_refresh_pending_test_versions)
  ),
  false,
  'a stale ACK cannot delete a newer request'
);
select is(
  (select count(*)::int from public.list_my_pending_location_refreshes()),
  1,
  'a stale ACK leaves the newer pending row intact'
);
reset role;
delete from public.memberships
 where group_id = 'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and user_id = 'f2222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2222222-2222-4222-8222-222222222222', true);
select is(
  public.ack_my_location_refresh(
    'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select requested_at from location_refresh_pending_test_latest)
  ),
  false,
  'ACK is denied after the recipient membership is removed'
);
reset role;
select is(
  (select count(*)::int
     from public.location_refresh_pending
    where group_id = 'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = 'f2222222-2222-4222-8222-222222222222'),
  1,
  'a denied ACK cannot delete the newer pending row'
);
insert into public.memberships (group_id, user_id, role, status)
values (
  'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'f2222222-2222-4222-8222-222222222222',
  'follower',
  'active'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2222222-2222-4222-8222-222222222222', true);
select is(
  public.ack_my_location_refresh(
    'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select requested_at from location_refresh_pending_test_latest)
  ),
  true,
  'the exact request version ACKs successfully'
);
select is(
  (select count(*)::int from public.list_my_pending_location_refreshes()),
  0,
  'an exact ACK removes only that recipient row'
);

select set_config('request.jwt.claim.sub', 'f4444444-4444-4444-8444-444444444444', true);
select is(
  (select count(*)::int from public.list_my_pending_location_refreshes()),
  0,
  'a non-member cannot list another group pending row'
);
select is(
  public.ack_my_location_refresh(
    'fgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    now()
  ),
  false,
  'a non-member cannot ACK another group pending row'
);

select * from finish();
rollback;
