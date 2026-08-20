-- #223 / #230: versioned personal Premium grant, originalTransactionId owner
-- binding with delete tombstone, live statuses (billing_retry / grace_period),
-- projection subscription_required, and anonymous cleanup skip.
-- Additive. One current grant row per user. Raw JWS is never stored.

-- ---------------------------------------------------------------------------
-- Columns, statuses, unique current grant
-- ---------------------------------------------------------------------------

alter table public.personal_premium_entitlements
  add column if not exists entitlement_version integer not null default 1;
alter table public.personal_premium_entitlements
  add column if not exists original_transaction_id text;
alter table public.personal_premium_entitlements
  add column if not exists latest_transaction_id text;
alter table public.personal_premium_entitlements
  add column if not exists environment text;

alter table public.personal_premium_entitlements
  drop constraint if exists personal_premium_entitlements_status_check;
alter table public.personal_premium_entitlements
  add constraint personal_premium_entitlements_status_check
  check (status in (
    'active', 'expired', 'refunded', 'revoked', 'none',
    'billing_retry', 'grace_period'
  ));

alter table public.personal_premium_entitlements
  drop constraint if exists personal_premium_entitlements_environment_check;
alter table public.personal_premium_entitlements
  add constraint personal_premium_entitlements_environment_check
  check (environment is null or environment in ('Production', 'Sandbox', 'Xcode'));

alter table public.premium_store_transactions
  drop constraint if exists premium_store_transactions_status_check;
alter table public.premium_store_transactions
  add constraint premium_store_transactions_status_check
  check (status in (
    'pending', 'active', 'expired', 'refunded', 'revoked', 'rejected',
    'billing_retry', 'grace_period'
  ));

comment on column public.personal_premium_entitlements.entitlement_version is
  'Increments on refund/revoke/expire/ban so cached UI blobs are immediately stale.';

-- Collapse duplicate grant rows: keep the latest live-or-newest per user.
delete from public.personal_premium_entitlements e
 using (
   select id
     from (
       select id,
              row_number() over (
                partition by user_id
                order by
                  case
                    when status in ('active', 'grace_period', 'billing_retry')
                     and (expires_at is null or expires_at > now()) then 0
                    else 1
                  end,
                  case when expires_at is null then 0 else 1 end,
                  coalesce(source_signed_at, updated_at) desc,
                  updated_at desc
              ) as rn
         from public.personal_premium_entitlements
     ) ranked
    where rn > 1
 ) extra
 where e.id = extra.id;

create unique index if not exists personal_premium_entitlements_user_uidx
  on public.personal_premium_entitlements(user_id);

-- Backfill StoreKit identity onto the surviving grant row.
update public.personal_premium_entitlements e
   set original_transaction_id = t.original_transaction_id,
       latest_transaction_id = t.transaction_id,
       environment = t.environment,
       updated_at = e.updated_at
  from (
    select distinct on (user_id)
           user_id, original_transaction_id, transaction_id, environment
      from public.premium_store_transactions
     where original_transaction_id is not null
     order by user_id, signed_at desc, updated_at desc
  ) t
 where e.user_id = t.user_id
   and e.source = 'app_store'
   and e.original_transaction_id is null;

-- ---------------------------------------------------------------------------
-- Owner binding (tombstone on user delete) + security events
-- ---------------------------------------------------------------------------

create table if not exists public.premium_transaction_bindings (
  environment text not null
    check (environment in ('Production', 'Sandbox', 'Xcode')),
  original_transaction_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  app_account_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (environment, original_transaction_id)
);

comment on table public.premium_transaction_bindings is
  'Unique (environment, originalTransactionId) owner. User delete SET NULL tombstones the Apple sub; no auto-rebind.';

alter table public.premium_transaction_bindings enable row level security;

insert into public.premium_transaction_bindings (
  environment, original_transaction_id, user_id, app_account_token
)
select distinct on (t.environment, t.original_transaction_id)
       t.environment, t.original_transaction_id, t.user_id, t.app_account_token
  from public.premium_store_transactions t
 where t.original_transaction_id is not null
   and t.environment in ('Production', 'Sandbox', 'Xcode')
 order by t.environment, t.original_transaction_id, t.signed_at desc
on conflict (environment, original_transaction_id) do nothing;

create table if not exists public.premium_security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id uuid,
  other_user_id uuid,
  original_transaction_id text,
  environment text,
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.premium_security_events is
  'Premium binding mismatches. Never store JWS, JWT, P8, or full tokens.';

alter table public.premium_security_events enable row level security;

create or replace function public.record_premium_security_event(
  p_event_type text,
  p_user_id uuid,
  p_other_user_id uuid,
  p_original_transaction_id text,
  p_environment text,
  p_reason text
)
returns void
language plpgsql
security definer
volatile
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user not in ('service_role', 'postgres') then
    raise exception 'premium_security_event_forbidden' using errcode = '42501';
  end if;
  insert into public.premium_security_events (
    event_type, user_id, other_user_id, original_transaction_id, environment, reason
  ) values (
    coalesce(nullif(trim(p_event_type), ''), 'unknown'),
    p_user_id,
    p_other_user_id,
    nullif(trim(p_original_transaction_id), ''),
    nullif(trim(p_environment), ''),
    left(coalesce(p_reason, ''), 200)
  );
end;
$$;

revoke all on function public.record_premium_security_event(
  text, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_premium_security_event(
  text, uuid, uuid, text, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Live helper — single predicate for projection, team, LA, join/itinerary
-- ---------------------------------------------------------------------------

create or replace function public.personal_premium_is_live(
  p_status text,
  p_expires_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_status in ('active', 'grace_period', 'billing_retry')
    and (p_expires_at is null or p_expires_at > now()),
    false
  );
$$;

revoke all on function public.personal_premium_is_live(text, timestamptz)
  from public, anon;
grant execute on function public.personal_premium_is_live(text, timestamptz)
  to authenticated, service_role;

comment on function public.personal_premium_is_live(text, timestamptz) is
  'Personal grant is entitled: active/grace_period/billing_retry and unexpired (null expiry = lifetime).';

create or replace function public.group_has_active_subscription_premium(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
      from public.memberships m
      join public.personal_premium_entitlements e on e.user_id = m.user_id
     where m.group_id = p_group_id
       and e.source in ('app_store', 'promo')
       and public.personal_premium_is_live(e.status, e.expires_at)
  );
$$;

revoke all on function public.group_has_active_subscription_premium(uuid)
  from public, anon, authenticated;
grant execute on function public.group_has_active_subscription_premium(uuid)
  to service_role;

create or replace function public.recompute_team_premium_projection(p_group_id uuid)
returns public.premium_team_projections
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_active boolean;
  v_source_version text;
  v_projection public.premium_team_projections%rowtype;
begin
  if p_group_id is null then
    return null;
  end if;

  v_active := public.group_has_active_subscription_premium(p_group_id);
  select max(e.source_version)
    into v_source_version
    from public.memberships m
    join public.personal_premium_entitlements e on e.user_id = m.user_id
   where m.group_id = p_group_id
     and e.source in ('app_store', 'promo')
     and public.personal_premium_is_live(e.status, e.expires_at);

  v_source_version := coalesce(v_source_version, 'premium-free-v1');

  insert into public.premium_team_projections (
    group_id, team_premium_active, source_version, updated_at
  ) values (
    p_group_id, v_active, v_source_version, now()
  )
  on conflict (group_id) do update
    set team_premium_active = excluded.team_premium_active,
        source_version = excluded.source_version,
        updated_at = excluded.updated_at
  returning * into v_projection;
  return v_projection;
end;
$$;

revoke all on function public.recompute_team_premium_projection(uuid)
  from public, anon;
grant execute on function public.recompute_team_premium_projection(uuid)
  to service_role;

create or replace function public.effective_live_activity_entitlement(
  p_user_id uuid,
  p_group_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.user_has_live_activity_lifetime(p_user_id) then
    return true;
  end if;

  if exists(
    select 1
      from public.personal_premium_entitlements e
     where e.user_id = p_user_id
       and e.source in ('app_store', 'promo')
       and public.personal_premium_is_live(e.status, e.expires_at)
  ) then
    return true;
  end if;

  if p_group_id is not null and public.group_has_active_premium(p_group_id) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.effective_live_activity_entitlement(uuid, uuid)
  from public, anon;
grant execute on function public.effective_live_activity_entitlement(uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grant upsert + StoreKit apply with owner binding
-- ---------------------------------------------------------------------------

create or replace function public.apply_personal_premium_projection(
  p_user_id uuid,
  p_status text,
  p_product_id text default null,
  p_expires_at timestamptz default null,
  p_source text default 'app_store',
  p_source_version text default null,
  p_external_key text default null,
  p_app_account_token uuid default null,
  p_source_signed_at timestamptz default null
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_row public.personal_premium_entitlements%rowtype;
  v_status text := p_status;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user not in ('service_role', 'postgres') then
    raise exception 'premium_projection_write_forbidden' using errcode = '42501';
  end if;
  if p_user_id is null
     or v_status not in (
          'active', 'expired', 'refunded', 'revoked', 'none',
          'billing_retry', 'grace_period'
        )
     or coalesce(nullif(trim(p_source), ''), 'app_store') <> 'app_store'
     or p_expires_at is null
     or p_external_key is null
     or length(trim(p_external_key)) = 0 then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  select * into v_row
    from public.personal_premium_entitlements
   where user_id = p_user_id
   for update;

  if v_row.user_id is not null
     and v_row.source_signed_at is not null
     and p_source_signed_at is not null
     and v_row.source_signed_at >= p_source_signed_at then
    return json_build_object(
      'ok', true,
      'duplicate', true,
      'entitlement_id', v_row.id,
      'user_id', v_row.user_id,
      'status', v_row.status,
      'product_id', v_row.product_id,
      'expires_at', v_row.expires_at,
      'source_version', v_row.source_version,
      'entitlement_version', v_row.entitlement_version
    );
  end if;

  if v_row.user_id is not null
     and v_row.status in ('refunded', 'revoked')
     and v_row.source_signed_at is not null
     and (p_source_signed_at is null or v_row.source_signed_at >= p_source_signed_at) then
    return json_build_object(
      'ok', true,
      'duplicate', true,
      'entitlement_id', v_row.id,
      'user_id', v_row.user_id,
      'status', v_row.status,
      'product_id', v_row.product_id,
      'expires_at', v_row.expires_at,
      'source_version', v_row.source_version,
      'entitlement_version', v_row.entitlement_version
    );
  end if;

  insert into public.personal_premium_entitlements (
    user_id, status, product_id, source, source_version, expires_at,
    external_key, app_account_token, source_signed_at, granted_at, updated_at
  ) values (
    p_user_id, v_status, p_product_id, 'app_store',
    p_source_version, p_expires_at, trim(p_external_key), p_app_account_token,
    p_source_signed_at, now(), now()
  )
  on conflict (user_id) do update
    set status = excluded.status,
        product_id = excluded.product_id,
        source = excluded.source,
        source_version = excluded.source_version,
        expires_at = excluded.expires_at,
        external_key = excluded.external_key,
        app_account_token = coalesce(excluded.app_account_token,
                                     public.personal_premium_entitlements.app_account_token),
        source_signed_at = coalesce(excluded.source_signed_at,
                                    public.personal_premium_entitlements.source_signed_at),
        entitlement_version = case
          when excluded.status in ('expired', 'refunded', 'revoked')
           and public.personal_premium_entitlements.status is distinct from excluded.status
          then public.personal_premium_entitlements.entitlement_version + 1
          else public.personal_premium_entitlements.entitlement_version
        end,
        updated_at = now()
  returning * into v_row;

  return json_build_object(
    'ok', true,
    'entitlement_id', v_row.id,
    'user_id', v_row.user_id,
    'status', v_row.status,
    'product_id', v_row.product_id,
    'expires_at', v_row.expires_at,
    'source_version', v_row.source_version,
    'entitlement_version', v_row.entitlement_version
  );
end;
$$;

revoke all on function public.apply_personal_premium_projection(
  uuid, text, text, timestamptz, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_personal_premium_projection(
  uuid, text, text, timestamptz, text, text, text, uuid, timestamptz
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
  v_original text := nullif(trim(p_original_transaction_id), '');
  v_bind public.premium_transaction_bindings%rowtype;
  v_grant_row public.personal_premium_entitlements%rowtype;
  v_grant_duplicate boolean := false;
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
     or p_status not in (
          'pending', 'active', 'expired', 'refunded', 'revoked', 'rejected',
          'billing_retry', 'grace_period'
        )
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
    perform public.record_premium_security_event(
      'account_token_mismatch', p_user_id, null, v_original, p_environment,
      'appAccountToken does not match the current user'
    );
    return json_build_object('ok', false, 'error', 'account_token_mismatch');
  end if;

  if v_original is not null then
    select * into v_bind
      from public.premium_transaction_bindings
     where environment = p_environment
       and original_transaction_id = v_original
     for update;

    if v_bind.original_transaction_id is not null then
      if v_bind.user_id is null or v_bind.user_id <> p_user_id then
        if v_bind.user_id is not null then
          update public.personal_premium_entitlements
             set entitlement_version = entitlement_version + 1,
                 updated_at = now()
           where user_id = v_bind.user_id;
        end if;
        perform public.record_premium_security_event(
          'transaction_binding_mismatch',
          p_user_id,
          v_bind.user_id,
          v_original,
          p_environment,
          case
            when v_bind.user_id is null then 'originalTransactionId is tombstoned'
            else 'originalTransactionId already bound to another user'
          end
        );
        return json_build_object('ok', false, 'error', 'transaction_binding_mismatch');
      end if;
    else
      insert into public.premium_transaction_bindings (
        environment, original_transaction_id, user_id, app_account_token
      ) values (
        p_environment, v_original, p_user_id, p_app_account_token
      )
      on conflict (environment, original_transaction_id) do nothing;

      select * into v_bind
        from public.premium_transaction_bindings
       where environment = p_environment
         and original_transaction_id = v_original
       for update;

      if v_bind.user_id is null or v_bind.user_id <> p_user_id then
        perform public.record_premium_security_event(
          'transaction_binding_mismatch', p_user_id, v_bind.user_id,
          v_original, p_environment, 'originalTransactionId binding race'
        );
        return json_build_object('ok', false, 'error', 'transaction_binding_mismatch');
      end if;
    end if;
  end if;

  if v_status in ('active', 'grace_period', 'billing_retry')
     and p_expires_at is not null and p_expires_at <= now() then
    v_status := 'expired';
  end if;

  select * into v_existing
    from public.premium_store_transactions
   where transaction_id = trim(p_transaction_id)
   for update;

  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id
       or v_existing.product_id <> p_product_id
       or v_existing.app_account_token <> p_app_account_token
       or v_existing.environment <> p_environment then
      perform public.record_premium_security_event(
        'transaction_binding_mismatch', p_user_id, v_existing.user_id,
        v_original, p_environment, 'transaction_id already bound'
      );
      return json_build_object('ok', false, 'error', 'transaction_binding_mismatch');
    end if;
    if v_existing.signed_at >= p_signed_at then
      select * into v_grant_row
        from public.personal_premium_entitlements
       where user_id = p_user_id;
      return json_build_object(
        'ok', true, 'duplicate', true, 'durable', true,
        'status', v_existing.status,
        'transactionId', v_existing.transaction_id,
        'entitlementVersion', coalesce(v_grant_row.entitlement_version, 1),
        'personalPremiumActive', public.personal_premium_is_live(
          v_grant_row.status, v_grant_row.expires_at
        )
      );
    end if;
  end if;

  insert into public.premium_store_transactions (
    user_id, transaction_id, original_transaction_id, product_id,
    subscription_group_id, app_account_token, environment, ownership_type,
    status, purchase_date, expires_at, revocation_date, signed_at,
    jws_sha256, source_version, updated_at
  ) values (
    p_user_id, trim(p_transaction_id), v_original,
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

  if v_status in ('active', 'expired', 'refunded', 'revoked', 'billing_retry', 'grace_period') then
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
    v_grant_duplicate := coalesce((v_grant->>'duplicate')::boolean, false);
    if not v_grant_duplicate then
      update public.personal_premium_entitlements
         set original_transaction_id = coalesce(v_original, original_transaction_id),
             latest_transaction_id = v_row.transaction_id,
             environment = p_environment,
             updated_at = now()
       where user_id = p_user_id
       returning * into v_grant_row;
    else
      select * into v_grant_row
        from public.personal_premium_entitlements
       where user_id = p_user_id;
    end if;
  else
    select * into v_grant_row
      from public.personal_premium_entitlements
     where user_id = p_user_id;
  end if;

  return json_build_object(
    'ok', true,
    'duplicate', v_grant_duplicate,
    'durable', true,
    'status', coalesce(v_grant_row.status, v_row.status),
    'transactionId', v_row.transaction_id,
    'entitlement', v_grant,
    'entitlementVersion', coalesce(v_grant_row.entitlement_version, 1),
    'personalPremiumActive', public.personal_premium_is_live(
      v_grant_row.status, v_grant_row.expires_at
    )
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

-- ---------------------------------------------------------------------------
-- Projection: version + subscription_required
-- ---------------------------------------------------------------------------

create or replace function public.get_premium_projection(p_group_id uuid default null)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.personal_premium_entitlements%rowtype;
  v_team boolean := false;
  v_projection public.premium_team_projections%rowtype;
  v_status text := 'none';
  v_product_id text;
  v_expires_at timestamptz;
  v_source_version text;
  v_personal boolean := false;
  v_version integer := 1;
  v_synced timestamptz := now();
begin
  if v_uid is null then
    return json_build_object(
      'ok', false,
      'error', 'subscription_required',
      'personalPremiumActive', false,
      'teamPremiumActive', false,
      'status', 'none',
      'productId', null,
      'expiresAt', null,
      'sourceVersion', null,
      'entitlementVersion', null,
      'lastSyncedAt', v_synced
    );
  end if;

  update public.personal_premium_entitlements
     set status = 'expired',
         entitlement_version = entitlement_version + 1,
         updated_at = now()
   where user_id = v_uid
     and status in ('active', 'grace_period', 'billing_retry')
     and expires_at is not null
     and expires_at <= now();

  select * into v_row
    from public.personal_premium_entitlements e
   where e.user_id = v_uid;

  if v_row.id is not null
     and v_row.source in ('app_store', 'promo')
     and public.personal_premium_is_live(v_row.status, v_row.expires_at) then
    v_status := v_row.status;
    v_product_id := v_row.product_id;
    v_expires_at := v_row.expires_at;
    v_source_version := v_row.source_version;
    v_version := v_row.entitlement_version;
    v_personal := true;
  elsif v_row.id is not null then
    v_status := v_row.status;
    v_product_id := v_row.product_id;
    v_expires_at := v_row.expires_at;
    v_source_version := v_row.source_version;
    v_version := v_row.entitlement_version;
  elsif public.profile_has_lifetime_premium(v_uid) then
    v_status := 'active';
    v_product_id := 'lifetime_premium';
    v_expires_at := null;
    v_source_version := 'legacy-profile-pro';
    v_personal := true;
  end if;

  if p_group_id is not null then
    if not exists (
      select 1 from public.memberships m
       where m.group_id = p_group_id and m.user_id = v_uid
    ) then
      raise exception 'not_member' using errcode = '42501';
    end if;
    v_projection := public.recompute_team_premium_projection(p_group_id);
    v_team := coalesce(v_projection.team_premium_active, false)
      or public.group_has_active_premium(p_group_id);
  end if;

  if v_personal then
    return json_build_object(
      'ok', true,
      'personalPremiumActive', true,
      'teamPremiumActive', v_team,
      'status', v_status,
      'productId', v_product_id,
      'expiresAt', v_expires_at,
      'sourceVersion', v_source_version,
      'entitlementVersion', v_version,
      'lastSyncedAt', v_synced
    );
  end if;

  return json_build_object(
    'ok', false,
    'error', 'subscription_required',
    'personalPremiumActive', false,
    'teamPremiumActive', v_team,
    'status', v_status,
    'productId', v_product_id,
    'expiresAt', v_expires_at,
    'sourceVersion', v_source_version,
    'entitlementVersion', v_version,
    'lastSyncedAt', v_synced
  );
end;
$$;

revoke all on function public.get_premium_projection(uuid) from public, anon;
grant execute on function public.get_premium_projection(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Anonymous: no StoreKit token; cleanup skips live personal grants
-- ---------------------------------------------------------------------------

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
  v_anonymous boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select coalesce(u.is_anonymous, false) into v_anonymous
    from auth.users u
   where u.id = v_uid;
  if coalesce(v_anonymous, false) then
    raise exception 'anonymous_upgrade_required' using errcode = '42501';
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

create or replace function public.cleanup_expired_anonymous_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
  v_still_anonymous boolean;
begin
  for r in
    select distinct u.id as uid
    from auth.users u
    join public.profiles p on p.id = u.id
    left join lateral (
      select min(m.created_at) as first_joined
      from public.memberships m
      where m.user_id = u.id
    ) mj on true
    where coalesce(u.is_anonymous, false) = true
      and (
        (p.anonymous_expires_at is not null and p.anonymous_expires_at <= now())
        or (
          p.anonymous_expires_at is null
          and mj.first_joined is not null
          and mj.first_joined + interval '14 days' <= now()
        )
      )
      and not exists (
        select 1
          from public.personal_premium_entitlements e
         where e.user_id = u.id
           and e.source in ('app_store', 'promo')
           and public.personal_premium_is_live(e.status, e.expires_at)
      )
  loop
    begin
      select coalesce(u.is_anonymous, false) into v_still_anonymous
      from auth.users u
      where u.id = r.uid;

      if not coalesce(v_still_anonymous, false) then
        perform public.allow_anonymous_expiry_write();
        update public.profiles
        set anonymous_expires_at = null
        where id = r.uid;
        continue;
      end if;

      delete from public.subgroup_invites where inviter_id = r.uid or invitee_id = r.uid;
      delete from public.commands where sender_id = r.uid;
      delete from public.member_locations where user_id = r.uid;
      delete from public.memberships where user_id = r.uid;
      delete from public.activity_logs where user_id = r.uid;
      delete from public.feedback_reports where user_id = r.uid;
      delete from public.visited_waypoints where user_id = r.uid;
      delete from public.push_tokens where user_id = r.uid;
      delete from public.notification_preferences where user_id = r.uid;
      delete from public.navigation_sessions where started_by = r.uid;

      update public.groups set created_by = null where created_by = r.uid;
      update public.subgroups set leader_id = null where leader_id = r.uid;
      update public.itinerary_items set created_by = null where created_by = r.uid;
      update public.daily_accommodations set created_by = null where created_by = r.uid;

      delete from auth.users
      where id = r.uid
        and coalesce(is_anonymous, false) = true;

      if found then
        n := n + 1;
      end if;
    exception
      when others then
        raise notice 'cleanup_expired_anonymous_accounts skipped %: %', r.uid, sqlerrm;
    end;
  end loop;

  return n;
end;
$$;

revoke all on function public.cleanup_expired_anonymous_accounts()
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_anonymous_accounts()
  to service_role;

-- Promo lifetime grant upserts the single current row per user.
create or replace function public.redeem_promo_code(
  p_code text,
  p_group_id uuid default null
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid;
  v_is_anonymous boolean;
  v_promo public.promo_codes%rowtype;
  v_plan_code text;
  v_started timestamptz := now();
  v_expires timestamptz;
  v_entitlement_id uuid;
  v_count integer;
  v_existing_redeem public.promo_redemptions%rowtype;
  v_days integer;
  v_external_key text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    return json_build_object('success', false, 'error', 'not_authenticated', 'code', 'not_authenticated');
  end if;

  v_is_anonymous := coalesce(
    (current_setting('request.jwt.claims', true)::json->>'is_anonymous')::boolean,
    false
  );
  if v_is_anonymous then
    return json_build_object(
      'success', false,
      'error', 'not_applicable',
      'code', 'not_applicable',
      'message', 'Anonymous accounts cannot redeem. Please register first.'
    );
  end if;

  select * into v_promo
  from public.promo_codes
  where code = upper(trim(p_code));
  if not found then
    select * into v_promo from public.promo_codes where code = trim(p_code);
  end if;
  if not found then
    return json_build_object('success', false, 'error', 'invalid', 'code', 'invalid');
  end if;

  if v_promo.expires_at is not null and v_promo.expires_at < now() then
    return json_build_object('success', false, 'error', 'expired', 'code', 'expired');
  end if;

  if v_promo.remaining_uses is not null and v_promo.remaining_uses <= 0 then
    return json_build_object('success', false, 'error', 'already_used', 'code', 'already_used');
  end if;

  select * into v_existing_redeem
  from public.promo_redemptions
  where code = v_promo.code and user_id = v_uid;
  if found then
    return json_build_object('success', false, 'error', 'already_used', 'code', 'already_used');
  end if;

  v_plan_code := coalesce(v_promo.plan_code, 'lifetime_premium');
  v_days := v_promo.duration_days;

  if v_plan_code = 'small_trip_pass' or (v_days is not null and v_days > 0) then
    if p_group_id is null then
      return json_build_object(
        'success', false,
        'error', 'not_applicable',
        'code', 'not_applicable',
        'message', 'Timed Premium requires an active trip'
      );
    end if;

    if not exists(
      select 1 from public.memberships m
      where m.group_id = p_group_id and m.user_id = v_uid and m.role = 'leader'
    ) then
      return json_build_object('success', false, 'error', 'not_applicable', 'code', 'not_applicable');
    end if;

    perform public.expire_stale_entitlements(p_group_id);
    perform 1 from public.groups where id = p_group_id for update;

    if public.group_has_active_premium(p_group_id) then
      return json_build_object('success', false, 'error', 'duplicate', 'code', 'duplicate');
    end if;

    v_count := public.group_member_count(p_group_id);
    if v_count < 1 or v_count > 5 then
      return json_build_object(
        'success', false,
        'error', 'not_applicable',
        'code', 'not_applicable',
        'message', 'Premium pass requires 1–5 members including the leader'
      );
    end if;

    v_days := coalesce(nullif(v_days, 0), 7);
    v_expires := v_started + make_interval(days => v_days);

    insert into public.trip_entitlements (
      group_id, owner_user_id, plan_code, status, source,
      started_at, expires_at, promo_code
    ) values (
      p_group_id, v_uid, 'small_trip_pass', 'active', 'promo',
      v_started, v_expires, v_promo.code
    )
    returning id into v_entitlement_id;

  else
    v_expires := null;

    perform public.allow_entitlement_profile_write();
    update public.profiles
    set pro = true,
        pro_plan = coalesce(v_promo.plan_name, 'Lifetime Premium'),
        pro_purchased_at = v_started,
        pro_expires_at = null
    where id = v_uid;

    v_external_key := 'promo:' || v_promo.code || ':' || v_uid::text;
    insert into public.personal_premium_entitlements (
      user_id, status, product_id, source, source_version,
      expires_at, external_key, granted_at, updated_at
    ) values (
      v_uid, 'active',
      coalesce(v_promo.plan_code, 'lifetime_premium'),
      'promo',
      'promo-v1',
      null,
      v_external_key,
      v_started,
      now()
    )
    on conflict (user_id) do update
      set status = 'active',
          product_id = excluded.product_id,
          source = 'promo',
          source_version = excluded.source_version,
          expires_at = null,
          external_key = excluded.external_key,
          updated_at = now();

    if p_group_id is not null and exists(
      select 1 from public.memberships m
      where m.group_id = p_group_id and m.user_id = v_uid
    ) then
      insert into public.trip_entitlements (
        group_id, owner_user_id, plan_code, status, source,
        started_at, expires_at, promo_code
      ) values (
        p_group_id, v_uid, 'lifetime_premium', 'active', 'promo',
        v_started, null, v_promo.code
      )
      returning id into v_entitlement_id;
      perform public.recompute_team_premium_projection(p_group_id);
    end if;
  end if;

  if v_promo.remaining_uses is not null then
    update public.promo_codes
    set remaining_uses = remaining_uses - 1
    where code = v_promo.code;
  end if;

  insert into public.promo_redemptions (code, user_id, group_id, entitlement_id)
  values (v_promo.code, v_uid, p_group_id, v_entitlement_id);

  return json_build_object(
    'success', true,
    'plan_name', coalesce(v_promo.plan_name, v_plan_code),
    'plan_code', v_plan_code,
    'status', 'active',
    'started_at', v_started,
    'expires_at', v_expires,
    'duration_days', v_days,
    'entitlement_id', v_entitlement_id
  );
end;
$$;

revoke all on function public.redeem_promo_code(text, uuid) from public, anon;
grant execute on function public.redeem_promo_code(text, uuid) to authenticated;

grant select, insert, update, delete on table public.personal_premium_entitlements
  to service_role;
grant select, insert, update, delete on table public.premium_transaction_bindings
  to service_role;
grant select, insert, update, delete on table public.premium_security_events
  to service_role;
grant select, insert, update, delete on table public.premium_store_transactions
  to service_role;
