-- #223 / #230 A6: anonymous cleanup skips live personal Premium.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(5);

insert into auth.users (id, email, is_anonymous) values
  ('c1111111-1111-4111-8111-111111111111', 'anon-premium@example.test', true),
  ('c2222222-2222-4222-8222-222222222222', 'anon-free@example.test', true);

insert into public.profiles (id, nickname) values
  ('c1111111-1111-4111-8111-111111111111', 'AnonPremium'),
  ('c2222222-2222-4222-8222-222222222222', 'AnonFree');

select public.allow_anonymous_expiry_write();
update public.profiles
   set anonymous_expires_at = now() - interval '1 hour'
 where id in (
   'c1111111-1111-4111-8111-111111111111',
   'c2222222-2222-4222-8222-222222222222'
 );

insert into public.personal_premium_entitlements (
  user_id, status, product_id, source, source_version, expires_at, external_key
) values (
  'c1111111-1111-4111-8111-111111111111',
  'grace_period',
  'premium.monthly',
  'app_store',
  'storekit-v1',
  now() + interval '5 days',
  'apple:transaction:anon-live'
);

select ok(
  public.personal_premium_is_live('grace_period', now() + interval '5 days'),
  'A6 grace_period remains a live personal grant'
);

select ok(
  public.personal_premium_is_live('billing_retry', now() + interval '5 days')
    and not public.personal_premium_is_live('expired', now() + interval '5 days'),
  'A6 billing_retry is live and expired is not'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select cmp_ok(
  public.cleanup_expired_anonymous_accounts(),
  '>=',
  1,
  'A6 cleanup actually runs and deletes expired anonymous accounts without a live grant'
);

set local role postgres;

select ok(
  exists(
    select 1 from auth.users
     where id = 'c1111111-1111-4111-8111-111111111111'
  ),
  'A6 anonymous cleanup does not delete a user who still has a live personal grant'
);

select ok(
  not exists(
    select 1 from auth.users
     where id = 'c2222222-2222-4222-8222-222222222222'
  ),
  'A6 expired anonymous user without a live grant is removed'
);

select * from finish();
rollback;
