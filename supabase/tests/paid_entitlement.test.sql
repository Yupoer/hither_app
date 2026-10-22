-- Legacy Small Trip Pass compatibility boundary (20260725000100_paid_entitlement,
-- 20260804040000_disable_legacy_trip_pass_purchases). New Premium purchases use
-- the StoreKit ledger; historical trip rows stay readable and revocable.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(10);

insert into auth.users (id, email, is_anonymous) values
  ('a7111111-1111-4111-8111-111111111111', 'pass-leader@example.test', false),
  ('a7222222-2222-4222-8222-222222222222', 'pass-other@example.test', false);
insert into public.profiles (id, nickname) values
  ('a7111111-1111-4111-8111-111111111111', 'PassLeader'),
  ('a7222222-2222-4222-8222-222222222222', 'PassOther')
on conflict (id) do nothing;
insert into public.groups (id, name, invite_code, created_by) values
  ('a7aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pass trip', 'PASS01', 'a7111111-1111-4111-8111-111111111111'),
  ('a7bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other trip', 'PASS02', 'a7111111-1111-4111-8111-111111111111');
insert into public.memberships (group_id, user_id, role) values
  ('a7aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a7111111-1111-4111-8111-111111111111', 'leader'),
  ('a7bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'a7111111-1111-4111-8111-111111111111', 'leader');
insert into public.trip_entitlements (
  id, group_id, owner_user_id, plan_code, status, source, expires_at, transaction_id
) values (
  'a7eeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'a7aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'a7111111-1111-4111-8111-111111111111', 'small_trip_pass', 'active', 'purchase',
  now() + interval '3 days', 'legacy-trip-pass-1'
);

select ok(
  not has_function_privilege('authenticated', 'public.apply_verified_purchase(uuid,text,text)', 'EXECUTE'),
  'clients cannot call the legacy purchase seam'
);
select ok(
  not has_function_privilege('anon', 'public.apply_verified_purchase(uuid,text,text)', 'EXECUTE'),
  'anonymous callers cannot call the legacy purchase seam'
);
select is(
  public.apply_verified_purchase('a7bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'legacy-trip-pass-2', 'small_trip_pass')->>'error',
  'legacy_trip_pass_disabled',
  'the legacy purchase seam refuses new trip passes'
);
select is(
  (select count(*)::int from public.trip_entitlements where transaction_id = 'legacy-trip-pass-2'),
  0,
  'the disabled seam writes no trip pass'
);
select ok(
  public.group_has_active_premium('a7aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'a historical active trip pass still unlocks its own trip'
);
select ok(
  not public.group_has_active_premium('a7bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'a trip pass does not unlock another trip led by the same owner'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"a7111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select throws_ok(
  $$update public.profiles set pro = true where id = 'a7111111-1111-4111-8111-111111111111'$$,
  '42501',
  null,
  'a client cannot self-grant profiles.pro'
);

select set_config('request.jwt.claim.sub', 'a7222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"a7222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is(
  public.revoke_trip_entitlement('a7eeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'refunded')->>'error',
  'not_applicable',
  'only the owner can revoke a trip pass'
);

select set_config('request.jwt.claim.sub', 'a7111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"a7111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select is(
  public.revoke_trip_entitlement('a7eeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'refunded')->>'status',
  'refunded',
  'an owner refund marks the trip pass refunded'
);

reset role;
select ok(
  not public.group_has_active_premium('a7aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'a refunded trip pass no longer unlocks the trip'
);

select * from finish();
rollback;
