-- #223 / #230 A6: anonymous 14-day cleanup skips live personal Premium.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(3);

insert into auth.users (id, email, is_anonymous) values
  ('b1111111-1111-4111-8111-111111111111', 'anon-live-premium@example.test', true),
  ('b2222222-2222-4222-8222-222222222222', 'anon-expired-free@example.test', true);

insert into public.profiles (id, nickname, anonymous_expires_at) values
  ('b1111111-1111-4111-8111-111111111111', 'LivePrem', now() - interval '1 hour'),
  ('b2222222-2222-4222-8222-222222222222', 'FreeAnon', now() - interval '1 hour');

insert into public.personal_premium_entitlements (
  user_id, status, product_id, source, source_version, expires_at, external_key
) values (
  'b1111111-1111-4111-8111-111111111111',
  'grace_period',
  'premium.monthly',
  'app_store',
  'storekit-v1',
  now() + interval '5 days',
  'apple:transaction:anon-live'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  public.cleanup_expired_anonymous_accounts(),
  1,
  'A6 cleanup deletes expired anonymous users without a live grant'
);
select is(
  (select count(*)::int from auth.users
    where id = 'b1111111-1111-4111-8111-111111111111'),
  1,
  'A6 live personal premium anonymous user is not deleted'
);
select is(
  (select count(*)::int from auth.users
    where id = 'b2222222-2222-4222-8222-222222222222'),
  0,
  'A6 expired anonymous without a live grant is still deleted'
);

select * from finish();
rollback;
