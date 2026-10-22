begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(15);

insert into auth.users (id, email, is_anonymous) values
  ('e1111111-1111-4111-8111-111111111111', 'paid-leader@example.test', false),
  ('e2222222-2222-4222-8222-222222222222', 'paid-other@example.test', false);
insert into public.profiles (id, nickname, pro) values
  ('e1111111-1111-4111-8111-111111111111', 'Paid leader', false);
insert into public.groups (id, name, invite_code, created_by) values
  ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Paid trip', 'PAID01', 'e1111111-1111-4111-8111-111111111111'),
  ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other trip', 'PAID02', 'e1111111-1111-4111-8111-111111111111');
insert into public.memberships (group_id, user_id, role) values
  ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e1111111-1111-4111-8111-111111111111', 'leader'),
  ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e1111111-1111-4111-8111-111111111111', 'leader');

select ok(
  not has_function_privilege('anon', 'public.apply_verified_purchase(uuid,text,text)', 'EXECUTE'),
  'anonymous callers cannot call the legacy purchase seam'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$update public.profiles set pro = true where id = 'e1111111-1111-4111-8111-111111111111'$$,
  '42501', null, 'a client cannot self-grant profiles.pro'
);
select throws_ok(
  $$select public.apply_verified_purchase('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'paid-test-new', 'small_trip_pass')$$,
  '42501', null, 'authenticated cannot invent verified purchases'
);

set local role service_role;
select is(
  public.apply_verified_purchase('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'paid-test-new', 'small_trip_pass')->>'error',
  'legacy_trip_pass_disabled', 'legacy purchase seam remains disabled'
);
reset role;
select is(
  (select count(*)::int from public.trip_entitlements where transaction_id = 'paid-test-new'),
  0, 'disabled purchase creates no entitlement'
);

-- Historical passes remain readable after new purchases moved to StoreKit.
insert into public.trip_entitlements (
  id, group_id, owner_user_id, plan_code, status, source, expires_at, transaction_id
) values (
  'eccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'e1111111-1111-4111-8111-111111111111', 'small_trip_pass', 'active', 'purchase',
  now() + interval '7 days', 'paid-test-historical'
);
select is(public.group_has_active_premium('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true,
  'historical pass activates its trip');
select is(public.group_has_active_premium('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false,
  'historical pass cannot activate another trip with the same leader');
select is((select pro from public.profiles where id = 'e1111111-1111-4111-8111-111111111111'), false,
  'trip pass does not write personal Premium');
select throws_ok(
  $$insert into public.trip_entitlements (group_id, owner_user_id, plan_code, status, source, transaction_id)
    values ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e1111111-1111-4111-8111-111111111111',
      'small_trip_pass', 'active', 'purchase', 'paid-test-historical')$$,
  '23505', null, 'transaction identity cannot be reused across trips'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);
select is(public.revoke_trip_entitlement('eccccccc-cccc-4ccc-8ccc-cccccccccccc', 'refunded')->>'error',
  'not_applicable', 'only the owner can revoke a trip pass');
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
select is(public.revoke_trip_entitlement('eccccccc-cccc-4ccc-8ccc-cccccccccccc', 'refunded')->>'status',
  'refunded', 'owner refund records the refunded status');
reset role;
select is((select status from public.trip_entitlements where id = 'eccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'refunded', 'refund is persisted');
select is(public.group_has_active_premium('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false,
  'refunded trip pass no longer activates Premium');

select public.allow_entitlement_profile_write();
update public.profiles set pro = true, pro_expires_at = null
where id = 'e1111111-1111-4111-8111-111111111111';
select is(public.profile_has_lifetime_premium('e1111111-1111-4111-8111-111111111111'), true,
  'legacy lifetime helper requires pro with no expiry');
update public.profiles set pro_expires_at = now() + interval '1 day'
where id = 'e1111111-1111-4111-8111-111111111111';
select is(public.profile_has_lifetime_premium('e1111111-1111-4111-8111-111111111111'), false,
  'finite personal expiry is not lifetime Premium');

select * from finish();
rollback;
