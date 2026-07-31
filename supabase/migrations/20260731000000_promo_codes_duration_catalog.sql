-- Promo / redeem code catalog with duration tiers.
-- duration_days NULL = permanent (lifetime). 7 / 30 = timed trip Premium.
-- Redeem activates the same server entitlement model (trip_entitlements / profiles.pro).
-- Also widen apply_verified_purchase product allow-list for App Store SKU.

alter table public.promo_codes
  add column if not exists duration_days integer;

comment on column public.promo_codes.duration_days is
  'Premium length after redeem: NULL = lifetime, 7 = week, 30 = month, etc.';

-- Seed redeem codes (idempotent). remaining_uses null = unlimited.
insert into public.promo_codes (code, plan_name, plan_code, duration_days, expires_at, remaining_uses)
values
  ('HITHER7D', 'Premium 7 天', 'small_trip_pass', 7, null, null),
  ('HITHER30D', 'Premium 30 天', 'small_trip_pass', 30, null, null),
  ('HITHER1M', 'Premium 一個月', 'small_trip_pass', 30, null, null),
  ('HITHERLIFE', 'Lifetime Premium', 'lifetime_premium', null, null, null),
  ('PREMIUM7D', 'Premium 7 天', 'small_trip_pass', 7, null, null),
  ('PREMIUM30D', 'Premium 30 天', 'small_trip_pass', 30, null, null),
  ('PREMIUM-LIFE', 'Lifetime Premium', 'lifetime_premium', null, null, null),
  ('PROMO2026', 'Lifetime Premium', 'lifetime_premium', null, null, null)
on conflict (code) do update
set
  plan_name = excluded.plan_name,
  plan_code = coalesce(excluded.plan_code, public.promo_codes.plan_code),
  duration_days = excluded.duration_days;

-- ============================================================
-- redeem_promo_code: honor duration_days for timed Premium
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

  -- Timed plans (duration set, or classic small_trip_pass) → trip-scoped Premium.
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

    -- Timed promo codes: allow 1–5 members (solo leader OK for redeem).
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
    -- Lifetime: user-scoped profiles.pro with NULL expiry.
    v_expires := null;

    perform public.allow_entitlement_profile_write();
    update public.profiles
    set pro = true,
        pro_plan = coalesce(v_promo.plan_name, 'Lifetime Premium'),
        pro_purchased_at = v_started,
        pro_expires_at = null
    where id = v_uid;

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

create or replace function public.redeem_promo_code(p_code text)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
begin
  return public.redeem_promo_code(p_code, null);
end;
$$;

revoke all on function public.redeem_promo_code(text) from public, anon;
grant execute on function public.redeem_promo_code(text) to authenticated;
