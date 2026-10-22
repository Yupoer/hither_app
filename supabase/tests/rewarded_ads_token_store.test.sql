-- Rewarded-ad token store: wallet RLS, reward sessions, and SSV credit
-- idempotency (20260730120000_rewarded_ads_token_store,
-- 20260807000000_promo_premium_projection_and_test_ads).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(13);

insert into auth.users (id, email, is_anonymous) values
  ('a8111111-1111-4111-8111-111111111111', 'tokens-user@example.test', false),
  ('a8222222-2222-4222-8222-222222222222', 'tokens-anon@example.test', true);

select ok(
  not has_function_privilege('authenticated',
    'public.credit_rewarded_ad_transaction(text,text,text,text,text,text)', 'EXECUTE'),
  'clients cannot credit their own rewarded ads'
);
select ok(
  has_function_privilege('service_role',
    'public.credit_rewarded_ad_transaction(text,text,text,text,text,text)', 'EXECUTE'),
  'the SSV callback role can credit rewarded ads'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$insert into public.token_wallets (user_id, balance)
    values ('a8111111-1111-4111-8111-111111111111', 100)$$,
  '42501',
  null,
  'a client cannot write its own wallet'
);
select throws_ok(
  $$insert into public.token_ledger (user_id, delta, balance_after, reason)
    values ('a8111111-1111-4111-8111-111111111111', 100, 100, 'rewarded_ad')$$,
  '42501',
  null,
  'a client cannot write the token ledger'
);

create temporary table reward_ref as
select public.create_reward_session('ios') as result;
grant select on reward_ref to postgres;

select is(
  (select result->>'ok' from reward_ref),
  'true',
  'a registered user starts a reward session'
);
select is(
  public.create_reward_session('ios')->>'error',
  'session_active',
  'a second session is refused while one is active'
);

select set_config('request.jwt.claim.sub', 'a8222222-2222-4222-8222-222222222222', true);
select is(
  public.create_reward_session('ios')->>'error',
  'registration_required',
  'anonymous users cannot start a reward session'
);

reset role;
select is(
  public.credit_rewarded_ad_transaction(
    (select result->>'session_ref' from reward_ref), 'gtx-token-store-1',
    'ca-app-pub-8135109277557342/7899053731', '1', 'hither_token', 'ios'
  )->>'already_credited',
  'false',
  'a valid SSV callback credits the session'
);
select is(
  (select balance from public.token_wallets where user_id = 'a8111111-1111-4111-8111-111111111111'),
  1,
  'a credit adds exactly one token'
);
select is(
  public.credit_rewarded_ad_transaction(
    (select result->>'session_ref' from reward_ref), 'gtx-token-store-1',
    'ca-app-pub-8135109277557342/7899053731', '1', 'hither_token', 'ios'
  )->>'already_credited',
  'true',
  'replaying a Google transaction id is reported as already credited'
);
select is(
  (select balance from public.token_wallets where user_id = 'a8111111-1111-4111-8111-111111111111'),
  1,
  'a replay leaves the balance unchanged'
);
select is(
  public.credit_rewarded_ad_transaction(
    (select result->>'session_ref' from reward_ref), 'gtx-token-store-2',
    'ca-app-pub-0000000000000000/0000000000', '1', 'hither_token', 'ios'
  )->>'error',
  'invalid_ad_unit',
  'an ad unit outside the allow-list earns nothing'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8111111-1111-4111-8111-111111111111', true);
select is(
  public.create_reward_session('ios')->>'ok',
  'true',
  'a credited session frees the user for the next ad'
);

select * from finish();
rollback;
