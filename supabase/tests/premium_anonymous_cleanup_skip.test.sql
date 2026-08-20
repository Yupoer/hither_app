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

select is(
  (
    select count(*)::int
      from auth.users u
      join public.profiles p on p.id = u.id
     where coalesce(u.is_anonymous, false) = true
       and p.anonymous_expires_at is not null
       and p.anonymous_expires_at <= now()
       and not exists (
         select 1
           from public.personal_premium_entitlements e
          where e.user_id = u.id
            and e.source in ('app_store', 'promo')
            and public.personal_premium_is_live(e.status, e.expires_at)
       )
  ),
  1,
  'A6 only expired anonymous users without a live grant are cleanup candidates'
);

select lives_ok(
  'select public.cleanup_expired_anonymous_accounts()',
  'A6 cleanup of expired anonymous accounts runs'
);

select is(
  (select count(*)::int from auth.users
    where id = 'b1111111-1111-4111-8111-111111111111'),
  1,
  'A6 live personal premium anonymous user is not deleted'
);

select * from finish();
rollback;
