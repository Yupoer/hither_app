-- #223 / #230 A6: anonymous cleanup skips live personal Premium.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(3);

select ok(
  pg_get_functiondef('public.cleanup_expired_anonymous_accounts()'::regprocedure)
    like '%personal_premium_is_live%',
  'A6 cleanup excludes live personal Premium from anonymous expiry'
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

select * from finish();
rollback;
