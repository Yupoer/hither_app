begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(15);

insert into auth.users (id, email, is_anonymous) values
  ('a7111111-1111-4111-8111-111111111111', 'reward-member@example.test', false),
  ('a7222222-2222-4222-8222-222222222222', 'reward-anon@example.test', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7222222-2222-4222-8222-222222222222', true);
select is(public.create_reward_session('ios')->>'error', 'registration_required',
  'anonymous users cannot create reward sessions');
select set_config('request.jwt.claim.sub', 'a7111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$insert into public.token_wallets (user_id, balance) values ('a7111111-1111-4111-8111-111111111111', 100)$$,
  '42501', null, 'authenticated cannot mint a wallet balance'
);
select throws_ok(
  $$insert into public.token_ledger (user_id, delta, balance_after, reason)
    values ('a7111111-1111-4111-8111-111111111111', 100, 100, 'rewarded_ad')$$,
  '42501', null, 'authenticated cannot invent reward ledger entries'
);

create temporary table reward_session_test as select public.create_reward_session('ios')::jsonb as result;
select is((select result->>'ok' from reward_session_test), 'true',
  'registered user creates a reward session');
select ok((select result->>'session_ref' ~ '^[0-9a-f]{64}$' from reward_session_test),
  'reward session reference is opaque random data');
select is(public.create_reward_session('ios')->>'error', 'session_active',
  'a user cannot create two unfinished reward sessions');
select throws_ok(
  $$select public.credit_rewarded_ad_transaction('session', 'reward-test-forged', 'unit', '1', 'hither_token', 'ios')$$,
  '42501', null, 'only the server may apply an SSV reward'
);

set local role service_role;
select is(public.credit_rewarded_ad_transaction(
  (select session_ref from public.reward_sessions where user_id = 'a7111111-1111-4111-8111-111111111111'),
  'reward-test-transaction', 'untrusted-unit', '1', 'hither_token', 'ios')->>'error',
  'invalid_ad_unit', 'untrusted ad unit cannot credit a reward');
select is(public.credit_rewarded_ad_transaction(
  (select session_ref from public.reward_sessions where user_id = 'a7111111-1111-4111-8111-111111111111'),
  'reward-test-transaction', public.rewarded_ad_unit_for_platform('ios'), '2', 'hither_token', 'ios')->>'error',
  'invalid_reward', 'production unit requires the exact reward amount');
select is(public.credit_rewarded_ad_transaction(
  (select session_ref from public.reward_sessions where user_id = 'a7111111-1111-4111-8111-111111111111'),
  'reward-test-transaction', public.rewarded_ad_unit_for_platform('ios'), '1', 'hither_token', 'ios')->>'balance',
  '1', 'valid SSV credit adds one token');
select is(public.credit_rewarded_ad_transaction(
  (select session_ref from public.reward_sessions where user_id = 'a7111111-1111-4111-8111-111111111111'),
  'reward-test-transaction', public.rewarded_ad_unit_for_platform('ios'), '1', 'hither_token', 'ios')->>'already_credited',
  'true', 'Google transaction replay is idempotent');
reset role;
select is((select balance from public.token_wallets where user_id = 'a7111111-1111-4111-8111-111111111111'),
  1, 'replay does not increase the wallet');
select is((select count(*)::int from public.token_ledger where external_ref = 'gtxn:reward-test-transaction'),
  1, 'replay leaves one durable ledger entry');

set local role authenticated;
select is((select balance from public.token_wallets where user_id = 'a7111111-1111-4111-8111-111111111111'),
  1, 'member can read its own credited wallet');
select is(public.create_reward_session('ios')->>'ok', 'true',
  'credited session frees the slot for the next reward');

select * from finish();
rollback;
