-- pgTAP: App Store REFUND / REVOKE for the Small Trip Pass.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(14);

insert into auth.users (id, email) values
  ('d1111111-1111-4111-8111-111111111111', 'trip-refund-leader@example.test'),
  ('d2222222-2222-4222-8222-222222222222', 'trip-refund-follower@example.test'),
  ('d3333333-3333-4333-8333-333333333333', 'trip-refund-other@example.test');
insert into public.profiles (id, nickname) values
  ('d1111111-1111-4111-8111-111111111111', 'Leader'),
  ('d2222222-2222-4222-8222-222222222222', 'Follower'),
  ('d3333333-3333-4333-8333-333333333333', 'Other');
insert into public.premium_app_account_tokens (user_id, app_account_token) values
  ('d1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-11111111aaaa'),
  ('d3333333-3333-4333-8333-333333333333', 'd3333333-3333-4333-8333-33333333aaaa');
insert into public.groups (id, name, invite_code, created_by) values
  ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Refund trip', 'REFND1', 'd1111111-1111-4111-8111-111111111111');
insert into public.memberships (group_id, user_id, role) values
  ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1111111-1111-4111-8111-111111111111', 'leader'),
  ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd2222222-2222-4222-8222-222222222222', 'follower');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (public.apply_verified_trip_storekit_purchase(
    'd1111111-1111-4111-8111-111111111111', 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'trip-tx-1', 'trip-tx-1', 'hither.small_trip_pass', 'Sandbox', 'PURCHASED',
    'd1111111-1111-4111-8111-11111111aaaa', now() - interval '1 hour',
    now() - interval '1 hour', 'trip-jws-1'
  )->>'status'),
  'active',
  'fixture trip pass is granted'
);
set local role postgres;
select ok(
  public.group_has_active_premium('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'group is premium before the refund'
);
set local role service_role;

select is(
  (public.record_storekit_notification(
    'trip-refund-1', 'REFUND', null, 'Sandbox',
    'trip-tx-1', 'trip-tx-1', 'hither.small_trip_pass', now() - interval '1 minute'
  )->>'accepted'),
  'false',
  'refund notification is recorded unaccepted'
);
select is(
  (public.apply_trip_storekit_notification(
    'trip-refund-1', 'd3333333-3333-4333-8333-333333333333', 'trip-tx-1', 'trip-tx-1',
    'hither.small_trip_pass', 'd3333333-3333-4333-8333-33333333aaaa', 'refunded',
    now() - interval '1 minute'
  )->>'error'),
  'transaction_binding_mismatch',
  'another account cannot revoke the pass'
);
select is(
  (public.apply_trip_storekit_notification(
    'trip-refund-1', 'd1111111-1111-4111-8111-111111111111', 'trip-tx-1', 'trip-tx-1',
    'hither.small_trip_pass', 'd1111111-1111-4111-8111-11111111aaaa', 'refunded',
    now() - interval '1 minute'
  )->>'revoked'),
  'true',
  'refund revokes the trip entitlement'
);
select is(
  (select status from public.trip_entitlements where transaction_id = 'trip-tx-1'),
  'refunded',
  'entitlement status is refunded'
);
set local role postgres;
select ok(
  not public.group_has_active_premium('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'group loses premium after the refund'
);
set local role service_role;
select is(
  (public.record_storekit_notification(
    'trip-refund-1', 'REFUND', null, 'Sandbox',
    'trip-tx-1', 'trip-tx-1', 'hither.small_trip_pass', now() - interval '1 minute'
  )->>'accepted'),
  'true',
  'the notification is accepted with the revocation'
);
select is(
  (public.apply_trip_storekit_notification(
    'trip-refund-1', 'd1111111-1111-4111-8111-111111111111', 'trip-tx-1', 'trip-tx-1',
    'hither.small_trip_pass', 'd1111111-1111-4111-8111-11111111aaaa', 'refunded',
    now() - interval '1 minute'
  )->>'duplicate'),
  'true',
  'replaying the notification is idempotent'
);

select is(
  (public.record_storekit_notification(
    'trip-revoke-1', 'REVOKE', null, 'Sandbox',
    'trip-tx-1', 'trip-tx-1', 'hither.small_trip_pass', now()
  )->>'ok')
  || (public.apply_trip_storekit_notification(
    'trip-revoke-1', 'd1111111-1111-4111-8111-111111111111', 'trip-tx-1', 'trip-tx-1',
    'hither.small_trip_pass', 'd1111111-1111-4111-8111-11111111aaaa', 'revoked', now()
  )->>'revoked'),
  'truefalse',
  'a later REVOKE keeps the first terminal status'
);

-- A refund that lands before the purchase was ever applied blocks the grant.
select is(
  (public.record_storekit_notification(
    'trip-refund-early', 'REFUND', null, 'Sandbox',
    'trip-tx-early', 'trip-tx-early', 'hither.small_trip_pass', now()
  )->>'ok')
  || (public.apply_trip_storekit_notification(
    'trip-refund-early', 'd1111111-1111-4111-8111-111111111111', 'trip-tx-early', 'trip-tx-early',
    'hither.small_trip_pass', 'd1111111-1111-4111-8111-11111111aaaa', 'refunded', now()
  )->>'accepted'),
  'truetrue',
  'refund without an entitlement is still accepted'
);
select is(
  (public.apply_verified_trip_storekit_purchase(
    'd1111111-1111-4111-8111-111111111111', 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'trip-tx-early', 'trip-tx-early', 'hither.small_trip_pass', 'Sandbox', 'PURCHASED',
    'd1111111-1111-4111-8111-11111111aaaa', now() - interval '1 hour',
    now() - interval '1 hour', 'trip-jws-early'
  )->>'error'),
  'transaction_revoked',
  'a refunded transaction can never be granted'
);

select is(
  (public.apply_trip_storekit_notification(
    'trip-refund-early', 'd1111111-1111-4111-8111-111111111111', 'trip-tx-early', 'trip-tx-early',
    'hither.small_trip_pass', 'd1111111-1111-4111-8111-11111111aaaa', 'expired', now()
  )->>'error'),
  'invalid',
  'only refunded, revoked, or acknowledge-only statuses are accepted'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$select public.apply_trip_storekit_notification(
    'trip-refund-1', 'd1111111-1111-4111-8111-111111111111', 'trip-tx-1', 'trip-tx-1',
    'hither.small_trip_pass', 'd1111111-1111-4111-8111-11111111aaaa', 'refunded', now())$$,
  '42501',
  null,
  'authenticated clients cannot call the revocation RPC'
);

select * from finish();
rollback;
