-- Tickets 6-8: account-bound StoreKit subscription ledger.
-- Raw signed transaction payloads are never stored. The Edge Function verifies
-- them and stores only the transaction identity, signed timestamp, lifecycle
-- state, and a one-way JWS hash for audit correlation.

create table if not exists public.premium_app_account_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_account_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.premium_app_account_tokens enable row level security;
drop policy if exists "premium_app_account_tokens: select own"
  on public.premium_app_account_tokens;
create policy "premium_app_account_tokens: select own"
  on public.premium_app_account_tokens for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.get_or_create_premium_app_account_token()
returns uuid
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  insert into public.premium_app_account_tokens (user_id)
  values (v_uid)
  on conflict (user_id) do update set updated_at = now()
  returning app_account_token into v_token;
  return v_token;
end;
$$;

revoke all on function public.get_or_create_premium_app_account_token()
  from public, anon;
grant execute on function public.get_or_create_premium_app_account_token()
  to authenticated;

create table if not exists public.premium_store_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id text not null unique,
  original_transaction_id text,
  product_id text not null,
  subscription_group_id text,
  app_account_token uuid not null,
  environment text not null
    check (environment in ('Production', 'Sandbox', 'Xcode')),
  ownership_type text not null default 'PURCHASED',
  status text not null
    check (status in ('pending', 'active', 'expired', 'refunded', 'revoked', 'rejected')),
  purchase_date timestamptz,
  expires_at timestamptz,
  revocation_date timestamptz,
  signed_at timestamptz not null,
  jws_sha256 text not null,
  source_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists premium_store_transactions_user_idx
  on public.premium_store_transactions(user_id, signed_at desc);
create index if not exists premium_store_transactions_original_idx
  on public.premium_store_transactions(original_transaction_id, signed_at desc);
create unique index if not exists premium_store_transactions_jws_hash_idx
  on public.premium_store_transactions(jws_sha256);

alter table public.premium_store_transactions enable row level security;
drop policy if exists "premium_store_transactions: select own"
  on public.premium_store_transactions;
create policy "premium_store_transactions: select own"
  on public.premium_store_transactions for select to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.premium_store_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_id text not null unique,
  notification_type text not null,
  subtype text,
  environment text not null
    check (environment in ('Production', 'Sandbox', 'Xcode')),
  transaction_id text,
  original_transaction_id text,
  product_id text,
  signed_at timestamptz not null,
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists premium_store_notifications_original_idx
  on public.premium_store_notifications(original_transaction_id, signed_at desc);

alter table public.premium_store_notifications enable row level security;
-- Notifications are server-only audit records. No client select policy.

create or replace function public.record_storekit_notification(
  p_notification_id text,
  p_notification_type text,
  p_subtype text,
  p_environment text,
  p_transaction_id text,
  p_original_transaction_id text,
  p_product_id text,
  p_signed_at timestamptz
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_row public.premium_store_notifications%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user not in ('service_role', 'postgres') then
    raise exception 'storekit_notification_forbidden' using errcode = '42501';
  end if;
  if p_notification_id is null
     or length(trim(p_notification_id)) = 0
     or p_notification_type is null
     or p_environment not in ('Production', 'Sandbox', 'Xcode')
     or p_signed_at is null then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  insert into public.premium_store_notifications (
    notification_id, notification_type, subtype, environment,
    transaction_id, original_transaction_id, product_id, signed_at, accepted
  ) values (
    trim(p_notification_id), trim(p_notification_type), nullif(trim(p_subtype), ''),
    p_environment, nullif(trim(p_transaction_id), ''),
    nullif(trim(p_original_transaction_id), ''), nullif(trim(p_product_id), ''),
    p_signed_at, false
  )
  on conflict (notification_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
      from public.premium_store_notifications n
     where n.notification_id = trim(p_notification_id);
    if v_row.notification_type is distinct from trim(p_notification_type)
       or v_row.subtype is distinct from nullif(trim(p_subtype), '')
       or v_row.environment is distinct from p_environment
       or v_row.transaction_id is distinct from nullif(trim(p_transaction_id), '')
       or v_row.original_transaction_id is distinct from nullif(trim(p_original_transaction_id), '')
       or v_row.product_id is distinct from nullif(trim(p_product_id), '')
       or v_row.signed_at is distinct from p_signed_at then
      return json_build_object(
        'ok', false, 'error', 'notification_payload_mismatch'
      );
    end if;
    return json_build_object(
      'ok', true, 'duplicate', true, 'accepted', v_row.accepted,
      'signedAt', v_row.signed_at
    );
  end if;

  return json_build_object('ok', true, 'duplicate', false, 'accepted', false);
end;
$$;

revoke all on function public.record_storekit_notification(
  text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_storekit_notification(
  text, text, text, text, text, text, text, timestamptz
) to service_role;

-- Mark a notification accepted only after the transaction RPC has returned a
-- durable ledger row. A crash between the two RPCs leaves accepted=false;
-- replaying the same notification safely re-runs the idempotent transaction
-- apply and then retries this mark.
create or replace function public.accept_storekit_notification(
  p_notification_id text,
  p_transaction_id text,
  p_original_transaction_id text,
  p_product_id text,
  p_signed_at timestamptz
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_notification public.premium_store_notifications%rowtype;
  v_transaction public.premium_store_transactions%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user not in ('service_role', 'postgres') then
    raise exception 'storekit_notification_forbidden' using errcode = '42501';
  end if;

  select * into v_notification
    from public.premium_store_notifications n
   where n.notification_id = trim(p_notification_id)
   for update;
  if v_notification.id is null then
    return json_build_object('ok', false, 'error', 'notification_missing');
  end if;
  if v_notification.notification_type is null
     or v_notification.transaction_id is distinct from nullif(trim(p_transaction_id), '')
     or v_notification.original_transaction_id is distinct from nullif(trim(p_original_transaction_id), '')
     or v_notification.product_id is distinct from nullif(trim(p_product_id), '')
     or v_notification.signed_at is distinct from p_signed_at then
    return json_build_object('ok', false, 'error', 'notification_payload_mismatch');
  end if;

  -- The transaction must exist in the same database transaction boundary as
  -- the projection grant. This prevents a caller from accepting an audit row
  -- without a durable entitlement apply.
  select * into v_transaction
    from public.premium_store_transactions t
   where t.transaction_id = trim(p_transaction_id)
   for share;
  if v_transaction.id is null
     or v_transaction.original_transaction_id is distinct from nullif(trim(p_original_transaction_id), '')
     or v_transaction.product_id is distinct from nullif(trim(p_product_id), '') then
    return json_build_object('ok', false, 'error', 'transaction_not_durable');
  end if;

  if v_notification.accepted then
    return json_build_object('ok', true, 'accepted', true, 'duplicate', true);
  end if;

  update public.premium_store_notifications
     set accepted = true
   where id = v_notification.id;
  return json_build_object('ok', true, 'accepted', true, 'duplicate', false);
end;
$$;

revoke all on function public.accept_storekit_notification(
  text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.accept_storekit_notification(
  text, text, text, text, timestamptz
) to service_role;

create or replace function public.apply_storekit_transaction(
  p_user_id uuid,
  p_transaction_id text,
  p_original_transaction_id text,
  p_product_id text,
  p_subscription_group_id text,
  p_environment text,
  p_ownership_type text,
  p_app_account_token uuid,
  p_status text,
  p_purchase_date timestamptz,
  p_expires_at timestamptz,
  p_revocation_date timestamptz,
  p_signed_at timestamptz,
  p_jws_sha256 text,
  p_source_version text default null
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_existing public.premium_store_transactions%rowtype;
  v_row public.premium_store_transactions%rowtype;
  v_token uuid;
  v_status text := p_status;
  v_grant json;
  v_external_key text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user not in ('service_role', 'postgres') then
    raise exception 'storekit_transaction_forbidden' using errcode = '42501';
  end if;
  if p_user_id is null
     or p_transaction_id is null
     or length(trim(p_transaction_id)) = 0
     or p_product_id is null
     or p_environment not in ('Production', 'Sandbox', 'Xcode')
     or p_ownership_type <> 'PURCHASED'
     or p_app_account_token is null
     or p_status not in ('pending', 'active', 'expired', 'refunded', 'revoked', 'rejected')
     or p_purchase_date is null
     or p_expires_at is null
     or p_expires_at <= p_purchase_date
     or p_signed_at is null
     or p_jws_sha256 is null then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  select app_account_token into v_token
    from public.premium_app_account_tokens
   where user_id = p_user_id;
  if v_token is null or v_token <> p_app_account_token then
    return json_build_object('ok', false, 'error', 'account_token_mismatch');
  end if;

  if v_status = 'active' and p_expires_at is not null and p_expires_at <= now() then
    v_status := 'expired';
  end if;

  select * into v_existing
    from public.premium_store_transactions
   where transaction_id = trim(p_transaction_id)
   for update;

  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id
       or v_existing.product_id <> p_product_id
       or v_existing.app_account_token <> p_app_account_token then
      return json_build_object('ok', false, 'error', 'transaction_binding_mismatch');
    end if;
    if v_existing.signed_at >= p_signed_at then
      return json_build_object(
        'ok', true, 'duplicate', true, 'durable', true,
        'status', v_existing.status, 'transactionId', v_existing.transaction_id
      );
    end if;
  end if;

  insert into public.premium_store_transactions (
    user_id, transaction_id, original_transaction_id, product_id,
    subscription_group_id, app_account_token, environment, ownership_type,
    status, purchase_date, expires_at, revocation_date, signed_at,
    jws_sha256, source_version, updated_at
  ) values (
    p_user_id, trim(p_transaction_id), nullif(trim(p_original_transaction_id), ''),
    trim(p_product_id), nullif(trim(p_subscription_group_id), ''),
    p_app_account_token, p_environment, p_ownership_type, v_status,
    p_purchase_date, p_expires_at, p_revocation_date, p_signed_at,
    trim(p_jws_sha256), p_source_version, now()
  )
  on conflict (transaction_id) do update
    set original_transaction_id = excluded.original_transaction_id,
        product_id = excluded.product_id,
        subscription_group_id = excluded.subscription_group_id,
        environment = excluded.environment,
        ownership_type = excluded.ownership_type,
        status = excluded.status,
        purchase_date = excluded.purchase_date,
        expires_at = excluded.expires_at,
        revocation_date = excluded.revocation_date,
        signed_at = excluded.signed_at,
        jws_sha256 = excluded.jws_sha256,
        source_version = excluded.source_version,
        updated_at = now()
  returning * into v_row;

  if v_status in ('active', 'expired', 'refunded', 'revoked') then
    v_external_key := 'apple:transaction:' || v_row.transaction_id;
    v_grant := public.apply_personal_premium_projection(
      p_user_id,
      v_status,
      v_row.product_id,
      v_row.expires_at,
      'app_store',
      coalesce(v_row.source_version, v_row.transaction_id),
      v_external_key,
      v_row.app_account_token,
      v_row.signed_at
    );
  end if;

  return json_build_object(
    'ok', true, 'duplicate', false, 'durable', true,
    'status', v_row.status, 'transactionId', v_row.transaction_id,
    'entitlement', v_grant
  );
end;
$$;

revoke all on function public.apply_storekit_transaction(
  uuid, text, text, text, text, text, text, uuid, text,
  timestamptz, timestamptz, timestamptz, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.apply_storekit_transaction(
  uuid, text, text, text, text, text, text, uuid, text,
  timestamptz, timestamptz, timestamptz, timestamptz, text, text
) to service_role;

comment on table public.premium_store_transactions is
  'Server-verified StoreKit transaction ledger; raw JWS is never persisted.';
comment on table public.premium_store_notifications is
  'Server-verified App Store Server Notifications V2 replay/order ledger.';
