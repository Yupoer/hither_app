-- pgTAP: the new personal/team projection is StoreKit-only.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(14);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'storekit-member@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'legacy-member@example.test');
insert into public.profiles (id, nickname, pro, pro_plan, pro_expires_at) values
  ('11111111-1111-4111-8111-111111111111', 'StoreKit', false, null, null),
  ('22222222-2222-4222-8222-222222222222', 'Legacy Pro', true, 'legacy-pro', null);
insert into public.groups (id, name, invite_code, created_by) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Premium projection', 'PREM01',
  '11111111-1111-4111-8111-111111111111'
);
insert into public.memberships (group_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'leader'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'follower');
insert into public.trip_entitlements (
  group_id, owner_user_id, plan_code, status, source, expires_at
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '22222222-2222-4222-8222-222222222222',
  'small_trip_pass', 'active', 'purchase', now() + interval '7 days'
);
insert into public.personal_premium_entitlements (
  user_id, status, product_id, source, source_version, expires_at, external_key
) values (
  '22222222-2222-4222-8222-222222222222', 'active', 'legacy-pro', 'legacy',
  'legacy-v1', now() + interval '30 days', 'legacy-test-key'
);

-- Legacy profile and trip-pass data do not enter the subscription projection.
select is(
  public.group_has_active_subscription_premium('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  false,
  'legacy profile and trip pass do not activate subscription team Premium'
);
select is(
  public.group_has_active_premium('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  true,
  'historical trip-pass compatibility facade remains readable'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  public.get_premium_projection(null)->>'personalPremiumActive',
  'false',
  'legacy profile and legacy personal source stay free'
);
select is(
  public.get_premium_projection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'teamPremiumActive',
  'false',
  'legacy member does not activate team subscription projection'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (public.apply_personal_premium_projection(
    '22222222-2222-4222-8222-222222222222', 'active', 'legacy-pro',
    now() + interval '30 days', 'legacy', 'legacy-v2', 'legacy-write-key', null, now()
  )->>'error'),
  'invalid',
  'non-StoreKit projection writes are rejected'
);
select is(
  (public.apply_personal_premium_projection(
    '22222222-2222-4222-8222-222222222222', 'active', 'premium.monthly',
    null, 'app_store', 'storekit-v1', 'missing-expiry-key', null, now()
  )->>'error'),
  'invalid',
  'null expiry projection writes are rejected'
);

select is(
  (public.apply_personal_premium_projection(
    '11111111-1111-4111-8111-111111111111', 'active', 'premium.monthly',
    now() + interval '30 days', 'app_store', 'storekit-active-v1',
    'apple:transaction:active-1', null, now()
  )->>'ok'),
  'true',
  'active StoreKit entitlement is durable'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  public.get_premium_projection(null)->>'personalPremiumActive',
  'true',
  'active StoreKit entitlement activates personal Premium'
);
select is(
  public.get_premium_projection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'teamPremiumActive',
  'true',
  'a current member StoreKit entitlement activates team Premium'
);
select is(
  public.get_premium_projection(null)->>'sourceVersion',
  'storekit-active-v1',
  'projection exposes the StoreKit source version'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (public.apply_personal_premium_projection(
    '11111111-1111-4111-8111-111111111111', 'expired', 'premium.monthly',
    now() - interval '1 day', 'app_store', 'storekit-expired-v1',
    'apple:transaction:expired-1', null, now() + interval '1 hour'
  )->>'ok'),
  'true',
  'expired StoreKit lifecycle is durable'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  public.get_premium_projection(null)->>'personalPremiumActive',
  'false',
  'expired StoreKit entitlement removes personal Premium'
);
select is(
  public.get_premium_projection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'teamPremiumActive',
  'false',
  'expired StoreKit entitlement removes team Premium'
);
select is(
  public.group_has_active_premium('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  true,
  'trip-pass compatibility remains independent of subscription projection'
);

select * from finish();
rollback;
