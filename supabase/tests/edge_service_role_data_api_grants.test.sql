-- Run after a clean migration replay with automatic public grants disabled.
-- This fixture grants no permissions, so missing migration grants remain visible.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(11);

-- The 11-table matrix is limited to operations performed through the admin
-- Data API clients in send-push and apple-server-notifications.
with required(table_name, privilege) as (
  values
    ('push_tokens', 'SELECT'), ('push_tokens', 'DELETE'),
    ('groups', 'SELECT'),
    ('itinerary_items', 'SELECT'),
    ('profiles', 'SELECT'),
    ('memberships', 'SELECT'),
    ('notification_preferences', 'SELECT'),
    ('navigation_sessions', 'SELECT'),
    ('device_live_activity_tokens', 'SELECT'),
    ('device_live_activity_tokens', 'UPDATE'),
    ('live_activity_sessions', 'SELECT'),
    ('live_activity_sessions', 'UPDATE'),
    ('live_activity_sessions', 'DELETE'),
    ('destination_arrivals', 'SELECT'),
    ('premium_app_account_tokens', 'SELECT')
), checked as (
  select t.table_name, p.privilege,
    exists (
      select 1 from required r
      where r.table_name = t.table_name and r.privilege = p.privilege
    ) as required,
    has_table_privilege('service_role', 'public.' || t.table_name, p.privilege) as granted
  from (select distinct table_name from required) t
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege)
)
select is(
  (select count(*)::int from checked where required is distinct from granted),
  0,
  'service_role has exactly the required CRUD privileges on the two Edge Function table surfaces'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in (
     'push_tokens', 'groups', 'itinerary_items', 'profiles', 'memberships',
     'notification_preferences', 'navigation_sessions', 'device_live_activity_tokens',
     'live_activity_sessions', 'destination_arrivals', 'premium_app_account_tokens'
   ) and c.relrowsecurity),
  11,
  'RLS stays enabled on all 11 exposed tables'
);

select ok(
  not exists (
    select 1 from (values
      ('push_tokens'), ('groups'), ('itinerary_items'), ('profiles'), ('memberships'),
      ('notification_preferences'), ('navigation_sessions'),
      ('device_live_activity_tokens'), ('live_activity_sessions'),
      ('destination_arrivals'), ('premium_app_account_tokens')
    ) t(table_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege)
    where has_table_privilege('anon', 'public.' || t.table_name, p.privilege)
  ),
  'anon gains no CRUD access to these tables on a replay without automatic grants'
);

select ok(
  not has_table_privilege('authenticated', 'public.memberships', 'INSERT')
  and not has_table_privilege('authenticated', 'public.memberships', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'pro', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.premium_app_account_tokens', 'SELECT'),
  'authenticated membership, profile entitlement, and account-token boundaries remain closed'
);

select ok(
  not exists (
    select 1 from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege)
    where has_table_privilege('service_role', 'public.premium_store_notifications', p.privilege)
  ),
  'the private notification ledger remains outside the service_role Data API'
);

select ok(
  (select count(*) = 4 and bool_and(
    has_function_privilege('service_role', p.oid, 'EXECUTE')
    and not has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in (
     'record_storekit_notification', 'accept_storekit_notification',
     'apply_storekit_transaction', 'apply_trip_storekit_notification'
   )),
  'Apple notification RPCs keep their service_role-only execution boundary'
);

-- Exercise permissions as the same database role used by the Edge clients.
-- EXPLAIN checks write planning without modifying rows or sending pushes.
set local role service_role;
select lives_ok(
  $$select
      (select count(*) from public.push_tokens where false) +
      (select count(*) from public.groups where false) +
      (select count(*) from public.itinerary_items where false) +
      (select count(*) from public.profiles where false) +
      (select count(*) from public.memberships where false) +
      (select count(*) from public.notification_preferences where false) +
      (select count(*) from public.navigation_sessions where false) +
      (select count(*) from public.device_live_activity_tokens where false) +
      (select count(*) from public.live_activity_sessions where false) +
      (select count(*) from public.destination_arrivals where false) +
      (select count(*) from public.premium_app_account_tokens where false)$$,
  'service_role can plan all 11 backend reads'
);
select lives_ok(
  $$explain delete from public.push_tokens where false$$,
  'service_role can plan dead push-token cleanup'
);
select lives_ok(
  $$explain update public.device_live_activity_tokens
    set live_activities_enabled = false where false$$,
  'service_role can plan dead start-token cleanup'
);
select lives_ok(
  $$explain update public.live_activity_sessions
    set updated_at = updated_at where false$$,
  'service_role can plan live-session reuse'
);
select lives_ok(
  $$explain delete from public.live_activity_sessions where false$$,
  'service_role can plan live-session cleanup'
);

select * from finish();
rollback;
