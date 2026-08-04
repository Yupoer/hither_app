-- pgTAP: StoreKit transaction and notification ledger state transitions.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(15);

insert into auth.users (id, email) values
  ('33333333-3333-4333-8333-333333333333', 'storekit-ledger@example.test');
insert into public.premium_app_account_tokens (user_id, app_account_token) values (
  '33333333-3333-4333-8333-333333333333',
  '33333333-3333-4333-8333-333333333334'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- First delivery creates an unaccepted replay ledger row.
select is(
  (public.record_storekit_notification(
    'notification-1', 'SUBSCRIBED', 'INITIAL_BUY', 'Sandbox',
    'tx-1', 'orig-1', 'premium.monthly', now() - interval '5 minutes'
  )->>'duplicate'),
  'false',
  'first notification is not a duplicate'
);
select is(
  (public.record_storekit_notification(
    'notification-1', 'SUBSCRIBED', 'INITIAL_BUY', 'Sandbox',
    'tx-1', 'orig-1', 'premium.monthly', now() - interval '5 minutes'
  )->>'duplicate'),
  'true',
  'same notificationUUID is deduplicated'
);
select is(
  (public.record_storekit_notification(
    'notification-1', 'SUBSCRIBED', 'INITIAL_BUY', 'Sandbox',
    'tx-1', 'orig-1', 'premium.monthly', now() - interval '5 minutes'
  )->>'accepted'),
  'false',
  'new notification remains unaccepted before durable apply'
);
select is(
  (public.record_storekit_notification(
    'notification-1', 'SUBSCRIBED', 'INITIAL_BUY', 'Sandbox',
    'different-tx', 'orig-1', 'premium.monthly', now() - interval '5 minutes'
  )->>'error'),
  'notification_payload_mismatch',
  'immutable notification payload mismatch fails closed'
);
select is(
  (public.accept_storekit_notification(
    'notification-1', 'tx-1', 'orig-1', 'premium.monthly', now() - interval '5 minutes'
  )->>'error'),
  'transaction_not_durable',
  'notification cannot be accepted before transaction apply'
);

select is(
  (public.apply_storekit_transaction(
    '33333333-3333-4333-8333-333333333333', 'tx-1', 'orig-1',
    'premium.monthly', 'hither-premium', 'Sandbox', 'PURCHASED',
    '33333333-3333-4333-8333-333333333334', 'active',
    now() - interval '10 minutes', now() + interval '30 days', null,
    now() - interval '5 minutes', 'jws-hash-1', 'asn-v2:SUBSCRIBED'
  )->>'ok'),
  'true',
  'transaction and personal grant apply durably'
);
select is(
  (public.apply_storekit_transaction(
    '33333333-3333-4333-8333-333333333333', 'tx-1', 'orig-1',
    'premium.monthly', 'hither-premium', 'Sandbox', 'PURCHASED',
    '33333333-3333-4333-8333-333333333334', 'active',
    now() - interval '10 minutes', now() + interval '30 days', null,
    now() - interval '5 minutes', 'jws-hash-1', 'asn-v2:SUBSCRIBED'
  )->>'durable'),
  'true',
  'durable retry response is explicit'
);
select is(
  (public.accept_storekit_notification(
    'notification-1', 'tx-1', 'orig-1', 'premium.monthly', now() - interval '5 minutes'
  )->>'accepted'),
  'true',
  'notification is accepted only after durable apply'
);
select is(
  (public.accept_storekit_notification(
    'notification-1', 'tx-1', 'orig-1', 'premium.annual', now() - interval '5 minutes'
  )->>'error'),
  'notification_payload_mismatch',
  'acceptance cannot mutate an immutable notification payload'
);
select is(
  (public.accept_storekit_notification(
    'notification-1', 'tx-1', 'orig-1', 'premium.monthly', now() - interval '5 minutes'
  )->>'duplicate'),
  'true',
  'acceptance mark is idempotent'
);
select is(
  (public.record_storekit_notification(
    'notification-1', 'SUBSCRIBED', 'INITIAL_BUY', 'Sandbox',
    'tx-1', 'orig-1', 'premium.monthly', now() - interval '5 minutes'
  )->>'accepted'),
  'true',
  'accepted duplicate is visible to the receiver'
);
select is(
  (select count(*)::int from public.personal_premium_entitlements
    where user_id = '33333333-3333-4333-8333-333333333333'
      and external_key = 'apple:transaction:tx-1'),
  1,
  'replaying a durable transaction does not create a second grant'
);

-- A newer state wins; an older refund/revocation cannot roll it back.
select is(
  (public.apply_storekit_transaction(
    '33333333-3333-4333-8333-333333333333', 'tx-order', 'orig-order',
    'premium.monthly', 'hither-premium', 'Sandbox', 'PURCHASED',
    '33333333-3333-4333-8333-333333333334', 'active',
    now() - interval '1 hour', now() + interval '30 days', null,
    now() - interval '1 minute', 'jws-hash-order-new', 'asn-v2:DID_RENEW'
  )->>'status'),
  'active',
  'newer lifecycle state is applied'
);
select is(
  (public.apply_storekit_transaction(
    '33333333-3333-4333-8333-333333333333', 'tx-order', 'orig-order',
    'premium.monthly', 'hither-premium', 'Sandbox', 'PURCHASED',
    '33333333-3333-4333-8333-333333333334', 'revoked',
    now() - interval '1 hour', now() + interval '30 days', now(),
    now() - interval '2 minutes', 'jws-hash-order-old', 'asn-v2:REVOKE'
  )->>'duplicate'),
  'true',
  'older lifecycle replay is ignored'
);
select is(
  (select status from public.premium_store_transactions where transaction_id = 'tx-order'),
  'active',
  'older revocation does not overwrite newer state'
);

select * from finish();
rollback;
