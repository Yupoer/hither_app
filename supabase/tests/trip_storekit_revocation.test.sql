-- pgTAP: App Store REFUND / REVOKE / REFUND_REVERSED for the Small Trip Pass.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(33);

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
  ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Refund trip', 'REFND1', 'd1111111-1111-4111-8111-111111111111'),
  ('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Reversed early trip', 'REFND2', 'd1111111-1111-4111-8111-111111111111'),
  ('dccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Out of order trip', 'REFND3', 'd1111111-1111-4111-8111-111111111111');
insert into public.memberships (group_id, user_id, role) values
  ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1111111-1111-4111-8111-111111111111', 'leader'),
  ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd2222222-2222-4222-8222-222222222222', 'follower'),
  ('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'd1111111-1111-4111-8111-111111111111', 'leader'),
  ('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'd2222222-2222-4222-8222-222222222222', 'follower'),
  ('dccccccc-cccc-4ccc-8ccc-cccccccccccc', 'd1111111-1111-4111-8111-111111111111', 'leader'),
  ('dccccccc-cccc-4ccc-8ccc-cccccccccccc', 'd2222222-2222-4222-8222-222222222222', 'follower');

create function public.test_trip_grant(p_group_id uuid, p_transaction_id text)
returns json language sql as $$
  select public.apply_verified_trip_storekit_purchase(
    'd1111111-1111-4111-8111-111111111111', p_group_id,
    p_transaction_id, p_transaction_id, 'hither.small_trip_pass', 'Sandbox', 'PURCHASED',
    'd1111111-1111-4111-8111-11111111aaaa', now() - interval '2 hours',
    now() - interval '2 hours', 'jws-' || p_transaction_id
  );
$$;

create function public.test_trip_notify(
  p_notification_id text, p_type text, p_transaction_id text, p_signed_at timestamptz
)
returns json language plpgsql as $$
begin
  perform public.record_storekit_notification(
    p_notification_id, p_type, null, 'Sandbox',
    p_transaction_id, p_transaction_id, 'hither.small_trip_pass', p_signed_at
  );
  return public.apply_trip_storekit_notification(
    p_notification_id, 'd1111111-1111-4111-8111-111111111111', p_transaction_id, p_transaction_id,
    'hither.small_trip_pass', 'd1111111-1111-4111-8111-11111111aaaa', p_signed_at
  );
end;
$$;

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
    'hither.small_trip_pass', 'd3333333-3333-4333-8333-33333333aaaa', now() - interval '1 minute'
  )->>'error'),
  'transaction_binding_mismatch',
  'another account cannot revoke the pass'
);
select is(
  (public.apply_trip_storekit_notification(
    'trip-refund-1', 'd1111111-1111-4111-8111-111111111111', 'trip-tx-1', 'trip-tx-1',
    'hither.small_trip_pass', 'd1111111-1111-4111-8111-11111111aaaa', now() - interval '1 minute'
  )->>'outcome'),
  'revoked',
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
    'hither.small_trip_pass', 'd1111111-1111-4111-8111-11111111aaaa', now() - interval '1 minute'
  )->>'duplicate'),
  'true',
  'replaying the notification is idempotent'
);

select is(
  public.test_trip_notify('trip-revoke-1', 'REVOKE', 'trip-tx-1', now())->>'status',
  'refunded',
  'a later REVOKE keeps the first terminal status'
);
select is(
  public.test_trip_notify('trip-reverse-1', 'REFUND_REVERSED', 'trip-tx-1', now() + interval '1 minute')->>'status',
  'refunded',
  'a refund reversal does not lift a REVOKE'
);

-- A refund that lands before the purchase was ever applied blocks the grant.
select is(
  (public.test_trip_notify('trip-refund-early', 'REFUND', 'trip-tx-early', now())->>'accepted'),
  'true',
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
    'hither.other_product', 'd1111111-1111-4111-8111-11111111aaaa', now()
  )->>'error'),
  'invalid',
  'only the trip pass product is applied'
);

-- Reversal of a refunded pass while another pass is active in the group.
select is(
  public.test_trip_grant('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'trip-tx-a')->>'status',
  'active',
  'a second pass is granted after the first was refunded'
);
select is(
  public.test_trip_notify('trip-refund-a', 'REFUND', 'trip-tx-a', now() - interval '50 minutes')->>'outcome',
  'revoked',
  'the second pass is refunded'
);
select is(
  public.test_trip_grant('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'trip-tx-b')->>'status',
  'active',
  'a third pass is granted after the second was refunded'
);
select is(
  public.test_trip_notify('trip-reverse-a', 'REFUND_REVERSED', 'trip-tx-a', now() - interval '40 minutes')->>'outcome',
  'reinstatement_blocked',
  'a reversal does not reinstate while the group has a different active pass'
);
select is(
  (select string_agg(transaction_id || '=' || status, ',' order by transaction_id)
     from public.trip_entitlements where transaction_id in ('trip-tx-a', 'trip-tx-b')),
  'trip-tx-a=refunded,trip-tx-b=active',
  'the blocked reversal leaves both passes unchanged'
);

-- Reversal of a refunded pass restores it inside its original window.
select is(
  public.test_trip_notify('trip-refund-b', 'REFUND', 'trip-tx-b', now() - interval '30 minutes')->>'outcome',
  'revoked',
  'the third pass is refunded'
);
select is(
  public.test_trip_notify('trip-reverse-b', 'REFUND_REVERSED', 'trip-tx-b', now() - interval '20 minutes')->>'outcome',
  'reinstated',
  'a refund reversal reinstates the refunded pass'
);
select is(
  (select status || '/' || (started_at = now() - interval '2 hours')::text
          || '/' || (expires_at = now() - interval '2 hours' + interval '10 days')::text
     from public.trip_entitlements where transaction_id = 'trip-tx-b'),
  'active/true/true',
  'the reinstated pass keeps its original validity window'
);
set local role postgres;
select ok(
  public.group_has_active_premium('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'group regains premium after the reversal'
);
set local role service_role;
select is(
  public.test_trip_notify('trip-reverse-b', 'REFUND_REVERSED', 'trip-tx-b', now() - interval '20 minutes')->>'duplicate',
  'true',
  'replaying the reversal is idempotent'
);

-- Refund before the first grant, then a reversal: the grant goes through.
select is(
  (public.test_trip_notify('trip-reverse-early', 'REFUND_REVERSED', 'trip-tx-early', now() + interval '1 minute')
     ->> 'outcome'),
  'acknowledged',
  'a reversal without an entitlement is accepted'
);
select is(
  public.test_trip_grant('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'trip-tx-early')->>'status',
  'active',
  'a later reversal lifts the pre-grant refund block'
);

-- Out-of-order delivery: Apple's signedDate, not arrival order, decides.
select is(
  public.test_trip_notify('trip-reverse-ooo-1', 'REFUND_REVERSED', 'trip-tx-ooo', now() - interval '5 minutes')->>'outcome',
  'acknowledged',
  'a reversal delivered before its refund is accepted'
);
select is(
  coalesce(
    public.test_trip_notify('trip-refund-ooo-1', 'REFUND', 'trip-tx-ooo', now() - interval '6 minutes')->>'store_status',
    'none'
  ),
  'none',
  'a refund signed before an already-applied reversal does not block'
);
select is(
  public.test_trip_grant('dccccccc-cccc-4ccc-8ccc-cccccccccccc', 'trip-tx-ooo')->>'status',
  'active',
  'the out-of-order pair does not block the grant'
);
select is(
  public.test_trip_notify('trip-reverse-ooo-2', 'REFUND_REVERSED', 'trip-tx-ooo', now() + interval '3 minutes')->>'status',
  'active',
  'a reversal delivered first leaves the active pass alone'
);
select is(
  public.test_trip_notify('trip-refund-ooo-2', 'REFUND', 'trip-tx-ooo', now() + interval '2 minutes')->>'outcome',
  'acknowledged',
  'a refund signed before an applied reversal does not revoke'
);
select is(
  (select status from public.trip_entitlements where transaction_id = 'trip-tx-ooo'),
  'active',
  'the out-of-order pair converges to an active pass'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$select public.apply_trip_storekit_notification(
    'trip-refund-1', 'd1111111-1111-4111-8111-111111111111', 'trip-tx-1', 'trip-tx-1',
    'hither.small_trip_pass', 'd1111111-1111-4111-8111-11111111aaaa', now())$$,
  '42501',
  null,
  'authenticated clients cannot call the revocation RPC'
);

select * from finish();
rollback;
