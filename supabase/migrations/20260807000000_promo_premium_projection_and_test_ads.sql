-- Promo codes + rewarded ads alignment with premium projection.
-- 1) Lifetime promo grants personal_premium_entitlements (source=promo).
-- 2) get_premium_projection honors promo + legacy profiles.pro lifetime + trip pass team unlock.
-- 3) create_reward_session accepts client ad unit (prod or Google sample test units).
-- 4) credit_rewarded_ad_transaction allow-lists test units for session match.

-- ============================================================
-- Backfill lifetime profile Pro → personal_premium (idempotent)
-- ============================================================

insert into public.personal_premium_entitlements (
  user_id, status, product_id, source, source_version,
  expires_at, external_key, granted_at, updated_at
)
select
  p.id,
  'active',
  coalesce(nullif(trim(p.pro_plan), ''), 'Lifetime Premium'),
  'promo',
  'legacy-profile-pro-v1',
  null,
  'promo:legacy-profile:' || p.id::text,
  coalesce(p.pro_purchased_at, now()),
  now()
from public.profiles p
where p.pro = true
  and p.pro_expires_at is null
  and not exists (
    select 1
    from public.personal_premium_entitlements e
    where e.user_id = p.id
      and e.source = 'promo'
      and e.status = 'active'
      and e.expires_at is null
  )
on conflict (external_key) do nothing;
-- ============================================================
-- get_premium_projection: promo + legacy lifetime + trip team
-- ============================================================

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
begin
  if v_uid is null then
    return json_build_object(
      'personalPremiumActive', false,
      'teamPremiumActive', false,
      'status', 'none',
      'productId', null,
      'expiresAt', null,
      'sourceVersion', null
    );
  end if;

  -- Expire timed personal rows only (lifetime expires_at IS NULL stays active).
  update public.personal_premium_entitlements
     set status = 'expired', updated_at = now()
   where user_id = v_uid
     and status = 'active'
     and expires_at is not null
     and expires_at <= now();

  -- Prefer active app_store or promo grant (lifetime first, then latest).
  select * into v_row
    from public.personal_premium_entitlements e
   where e.user_id = v_uid
     and e.source in ('app_store', 'promo')
     and e.status = 'active'
     and (e.expires_at is null or e.expires_at > now())
   order by
     case when e.expires_at is null then 0 else 1 end,
     coalesce(e.source_signed_at, e.updated_at) desc,
     e.updated_at desc
   limit 1;

  if v_row.id is not null then
    v_status := v_row.status;
    v_product_id := v_row.product_id;
    v_expires_at := v_row.expires_at;
    v_source_version := v_row.source_version;
    v_personal := true;
  elsif public.profile_has_lifetime_premium(v_uid) then
    -- Bridge for redemptions that only wrote profiles.pro before this migration.
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
    -- Subscription team view OR historical trip-pass / any active group premium.
    v_team := coalesce(v_projection.team_premium_active, false)
      or public.group_has_active_premium(p_group_id);
  end if;

  return json_build_object(
    'personalPremiumActive', v_personal,
    'teamPremiumActive', v_team,
    'status', v_status,
    'productId', v_product_id,
    'expiresAt', v_expires_at,
    'sourceVersion', v_source_version
  );
end;
$$;
revoke all on function public.get_premium_projection(uuid) from public, anon;
grant execute on function public.get_premium_projection(uuid) to authenticated;
-- ============================================================
-- redeem_promo_code: write personal_premium for lifetime
-- ============================================================

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
    -- Lifetime: profiles.pro + personal_premium projection row.
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
    on conflict (external_key) do update
      set status = 'active',
          product_id = excluded.product_id,
          source_version = excluded.source_version,
          expires_at = null,
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
-- ============================================================
-- Rewarded ads: allow Google sample units + client-declared unit
-- ============================================================

create or replace function public.rewarded_ad_unit_for_platform(p_platform text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_platform
    when 'ios' then 'ca-app-pub-8135109277557342/7899053731'
    when 'android' then 'ca-app-pub-8135109277557342/7100977386'
    else null
  end;
$$;
create or replace function public.is_allowed_rewarded_ad_unit(p_ad_unit text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_ad_unit in (
    -- Production
    'ca-app-pub-8135109277557342/7899053731',
    'ca-app-pub-8135109277557342/7100977386',
    -- Google official sample rewarded (Test Mode / __DEV__)
    'ca-app-pub-3940256099942544/1712485313',
    'ca-app-pub-3940256099942544/5224354917'
  );
$$;
revoke all on function public.is_allowed_rewarded_ad_unit(text) from public, anon;
grant execute on function public.is_allowed_rewarded_ad_unit(text) to authenticated, service_role;
-- Replace 1-arg overload; client may declare the unit it will actually load.
drop function if exists public.create_reward_session(text);
drop function if exists public.create_reward_session(text, text);
create or replace function public.create_reward_session(
  p_platform text,
  p_ad_unit text default null
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_platform text;
  v_ad_unit text;
  v_ref text;
  v_row public.reward_sessions%rowtype;
  v_active public.reward_sessions%rowtype;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public.is_auth_user_anonymous(v_uid) then
    return json_build_object('ok', false, 'error', 'registration_required');
  end if;

  v_platform := lower(trim(coalesce(p_platform, '')));
  if v_platform not in ('ios', 'android') then
    return json_build_object('ok', false, 'error', 'invalid_platform');
  end if;

  v_ad_unit := nullif(trim(coalesce(p_ad_unit, '')), '');
  if v_ad_unit is null then
    v_ad_unit := public.rewarded_ad_unit_for_platform(v_platform);
  end if;
  if v_ad_unit is null or not public.is_allowed_rewarded_ad_unit(v_ad_unit) then
    return json_build_object('ok', false, 'error', 'invalid_ad_unit');
  end if;

  perform public.expire_stale_reward_sessions(v_uid);

  select * into v_active
  from public.reward_sessions
  where user_id = v_uid and status in ('active', 'verifying')
  for update;
  if found then
    return json_build_object(
      'ok', false,
      'error', 'session_active',
      'session_ref', v_active.session_ref,
      'expires_at', v_active.expires_at,
      'status', v_active.status
    );
  end if;

  v_ref := replace(gen_random_uuid()::text, '-', '')
        || replace(gen_random_uuid()::text, '-', '');

  begin
    insert into public.reward_sessions (
      session_ref, user_id, platform, ad_unit, status, expires_at
    ) values (
      v_ref, v_uid, v_platform, v_ad_unit, 'active', now() + interval '30 minutes'
    )
    returning * into v_row;
  exception
    when unique_violation then
      select * into v_active
      from public.reward_sessions
      where user_id = v_uid and status in ('active', 'verifying')
      order by created_at desc
      limit 1;
      if found then
        return json_build_object(
          'ok', false,
          'error', 'session_active',
          'session_ref', v_active.session_ref,
          'expires_at', v_active.expires_at,
          'status', v_active.status
        );
      end if;
      return json_build_object('ok', false, 'error', 'conflict');
  end;

  return json_build_object(
    'ok', true,
    'session_ref', v_row.session_ref,
    'platform', v_row.platform,
    'ad_unit', v_row.ad_unit,
    'status', v_row.status,
    'expires_at', v_row.expires_at,
    'reward_amount', 1,
    'reward_item', 'hither_token'
  );
end;
$$;
revoke all on function public.create_reward_session(text, text) from public, anon;
grant execute on function public.create_reward_session(text, text) to authenticated;
create or replace function public.credit_rewarded_ad_transaction(
  p_session_ref text,
  p_google_transaction_id text,
  p_ad_unit text,
  p_reward_amount text,
  p_reward_item text,
  p_platform_hint text default null
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_session public.reward_sessions%rowtype;
  v_wallet public.token_wallets%rowtype;
  v_ledger public.token_ledger%rowtype;
  v_amount_ok boolean;
  v_item_ok boolean;
begin
  if p_session_ref is null or length(trim(p_session_ref)) = 0 then
    return json_build_object('ok', false, 'error', 'invalid_session');
  end if;
  if p_google_transaction_id is null or length(trim(p_google_transaction_id)) = 0 then
    return json_build_object('ok', false, 'error', 'invalid_transaction');
  end if;

  if not public.is_allowed_rewarded_ad_unit(p_ad_unit) then
    return json_build_object('ok', false, 'error', 'invalid_ad_unit');
  end if;

  -- Production units require exact reward metadata; Google sample ads often use
  -- "Reward" / amount 10 — accept any positive amount for allow-listed test units.
  if p_ad_unit in (
    'ca-app-pub-3940256099942544/1712485313',
    'ca-app-pub-3940256099942544/5224354917'
  ) then
    v_amount_ok := true;
    v_item_ok := true;
  else
    v_amount_ok := trim(coalesce(p_reward_amount, '')) in ('1', '1.0', '1.00');
    v_item_ok := lower(trim(coalesce(p_reward_item, ''))) in ('hither_token', 'hither token');
  end if;
  if not v_amount_ok or not v_item_ok then
    return json_build_object('ok', false, 'error', 'invalid_reward');
  end if;

  select * into v_ledger
  from public.token_ledger
  where external_ref = 'gtxn:' || p_google_transaction_id
  limit 1;
  if found then
    return json_build_object(
      'ok', true,
      'already_credited', true,
      'balance', (
        select balance from public.token_wallets where user_id = v_ledger.user_id
      ),
      'user_id', v_ledger.user_id
    );
  end if;

  select * into v_session
  from public.reward_sessions
  where session_ref = p_session_ref
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'session_not_found');
  end if;

  if v_session.status = 'credited' then
    return json_build_object(
      'ok', true,
      'already_credited', true,
      'balance', (
        select balance from public.token_wallets where user_id = v_session.user_id
      ),
      'user_id', v_session.user_id
    );
  end if;

  if v_session.status not in ('active', 'verifying') then
    return json_build_object('ok', false, 'error', 'session_' || v_session.status);
  end if;

  if v_session.expires_at < now() then
    update public.reward_sessions
    set status = 'expired', updated_at = now()
    where id = v_session.id;
    return json_build_object('ok', false, 'error', 'session_expired');
  end if;

  if v_session.ad_unit is distinct from p_ad_unit then
    return json_build_object('ok', false, 'error', 'ad_unit_mismatch');
  end if;

  if p_platform_hint is not null
     and lower(trim(p_platform_hint)) in ('ios', 'android')
     and lower(trim(p_platform_hint)) is distinct from v_session.platform
  then
    return json_build_object('ok', false, 'error', 'platform_mismatch');
  end if;

  v_wallet := public.ensure_token_wallet(v_session.user_id);
  update public.token_wallets
  set balance = balance + 1,
      updated_at = now()
  where user_id = v_session.user_id
  returning * into v_wallet;

  insert into public.token_ledger (
    user_id, delta, balance_after, reason, external_ref, metadata
  ) values (
    v_session.user_id,
    1,
    v_wallet.balance,
    'rewarded_ad',
    'gtxn:' || p_google_transaction_id,
    jsonb_build_object(
      'session_id', v_session.id,
      'platform', v_session.platform,
      'ad_unit_suffix', right(p_ad_unit, 8)
    )
  )
  returning * into v_ledger;

  update public.reward_sessions
  set status = 'credited',
      google_transaction_id = p_google_transaction_id,
      credited_at = now(),
      updated_at = now()
  where id = v_session.id;

  return json_build_object(
    'ok', true,
    'already_credited', false,
    'balance', v_wallet.balance,
    'user_id', v_session.user_id,
    'ledger_id', v_ledger.id
  );
exception
  when unique_violation then
    select * into v_ledger
    from public.token_ledger
    where external_ref = 'gtxn:' || p_google_transaction_id
    limit 1;
    if found then
      return json_build_object(
        'ok', true,
        'already_credited', true,
        'balance', (
          select balance from public.token_wallets where user_id = v_ledger.user_id
        ),
        'user_id', v_ledger.user_id
      );
    end if;
    return json_build_object('ok', false, 'error', 'conflict');
end;
$$;
revoke all on function public.credit_rewarded_ad_transaction(
  text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.credit_rewarded_ad_transaction(
  text, text, text, text, text, text
) to service_role;
