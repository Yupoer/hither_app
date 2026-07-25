-- OTA-08: Formal Free Plan + Small Trip Premium Pass entitlement model.
-- Server is authoritative for member-count limits, itinerary-point limits,
-- entitlement status, start time, and expiry time.
--
-- Free Plan: max 5 members INCLUDING leader; max 5 itinerary points per
-- (group_id, subgroup_id) itinerary scope.
-- Small Trip Premium Pass: trip-scoped ONLY (never via profiles.pro fallback),
-- 2–5 person trips, 7-day expiry.
-- Promo redemption writes the same entitlement model (no separate Early Access).
--
-- SECURITY: apply_verified_purchase is service_role only. Authenticated clients
-- must not invent transaction_ids. BUILD-02 Edge Function verifies store
-- receipts then calls this RPC with the service role.

-- ============================================================
-- TABLE: trip_entitlements (trip-scoped Small Trip Pass + audit)
-- ============================================================

create table if not exists public.trip_entitlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null
    check (plan_code in ('small_trip_pass', 'lifetime_premium')),
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked', 'refunded', 'invalid')),
  source text not null
    check (source in ('purchase', 'restore', 'promo', 'grant')),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  transaction_id text,
  promo_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists trip_entitlements_transaction_id_uidx
  on public.trip_entitlements (transaction_id)
  where transaction_id is not null;

create unique index if not exists trip_entitlements_one_active_pass_per_group
  on public.trip_entitlements (group_id)
  where status = 'active' and plan_code = 'small_trip_pass';

create index if not exists idx_trip_entitlements_group_id
  on public.trip_entitlements (group_id);
create index if not exists idx_trip_entitlements_owner
  on public.trip_entitlements (owner_user_id);
create index if not exists idx_trip_entitlements_status
  on public.trip_entitlements (status);

alter table public.trip_entitlements enable row level security;

drop policy if exists "trip_entitlements: select if member or owner" on public.trip_entitlements;
create policy "trip_entitlements: select if member or owner"
  on public.trip_entitlements for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or extensions.is_member(group_id)
  );
-- No insert/update/delete policies → denied for authenticated under RLS.

-- ============================================================
-- TABLE: promo_redemptions
-- ============================================================

create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.promo_codes(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  entitlement_id uuid references public.trip_entitlements(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (code, user_id)
);

create index if not exists idx_promo_redemptions_user
  on public.promo_redemptions (user_id);

alter table public.promo_redemptions enable row level security;

drop policy if exists "promo_redemptions: select own" on public.promo_redemptions;
create policy "promo_redemptions: select own"
  on public.promo_redemptions for select to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- promo_codes.plan_code
-- ============================================================

alter table public.promo_codes
  add column if not exists plan_code text;

update public.promo_codes
set plan_code = case
  when lower(plan_name) like '%lifetime%' then 'lifetime_premium'
  when lower(plan_name) like '%small%trip%' then 'small_trip_pass'
  else 'lifetime_premium'
end
where plan_code is null;

insert into public.promo_codes (code, plan_name, plan_code, expires_at, remaining_uses)
values ('PROMO2026', 'Lifetime Premium', 'lifetime_premium', null, null)
on conflict (code) do update
set plan_name = excluded.plan_name,
    plan_code = coalesce(public.promo_codes.plan_code, excluded.plan_code);

-- ============================================================
-- HELPERS
-- ============================================================

-- Allow SECURITY DEFINER RPCs to update profiles.pro (trigger GUC).
create or replace function public.allow_entitlement_profile_write()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.entitlement_write', 'allowed', true);
end;
$$;

revoke all on function public.allow_entitlement_profile_write() from public, anon, authenticated;

-- Lazy expiry sweep. NOT granted to authenticated (maintenance helper only).
create or replace function public.expire_stale_entitlements(p_group_id uuid default null)
returns void
language plpgsql
security definer
volatile
set search_path = ''
as $$
begin
  update public.trip_entitlements
  set status = 'expired',
      updated_at = now()
  where status = 'active'
    and expires_at is not null
    and expires_at < now()
    and (p_group_id is null or group_id = p_group_id);

  -- Clear denormalized lifetime rows that somehow gained an expiry and lapsed.
  -- Trip-scoped passes do not write profiles.pro (see apply/redeem).
  perform public.allow_entitlement_profile_write();
  update public.profiles
  set pro = false
  where pro = true
    and pro_expires_at is not null
    and pro_expires_at < now();
end;
$$;

revoke all on function public.expire_stale_entitlements(uuid) from public, anon, authenticated;
-- Callable only by other SECURITY DEFINER functions (same owner) or service_role.
grant execute on function public.expire_stale_entitlements(uuid) to service_role;

-- Lifetime premium on profiles: pro = true AND pro_expires_at IS NULL.
-- Trip-scoped Small Trip Pass NEVER grants via profiles.pro fallback.
create or replace function public.profile_has_lifetime_premium(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.pro = true
      and p.pro_expires_at is null
  );
$$;

revoke all on function public.profile_has_lifetime_premium(uuid) from public, anon;
grant execute on function public.profile_has_lifetime_premium(uuid) to authenticated;

-- Pure read (VOLATILE so callers that also expire are free to call separately).
-- Does NOT mutate. Does NOT treat expiring profiles.pro as group premium.
create or replace function public.group_has_active_premium(p_group_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_has boolean;
  v_leader uuid;
begin
  -- Trip-scoped entitlement for THIS group only.
  select exists(
    select 1
    from public.trip_entitlements e
    where e.group_id = p_group_id
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
  ) into v_has;
  if v_has then
    return true;
  end if;

  -- Lifetime only (null expiry). Small Trip Pass must not unlock other trips.
  select m.user_id into v_leader
  from public.memberships m
  where m.group_id = p_group_id and m.role = 'leader'
  limit 1;

  if v_leader is null then
    select g.created_by into v_leader
    from public.groups g
    where g.id = p_group_id;
  end if;

  if v_leader is null then
    return false;
  end if;

  return public.profile_has_lifetime_premium(v_leader);
end;
$$;

revoke all on function public.group_has_active_premium(uuid) from public, anon;
grant execute on function public.group_has_active_premium(uuid) to authenticated;

create or replace function public.group_member_count(p_group_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.memberships m
  where m.group_id = p_group_id;
$$;

revoke all on function public.group_member_count(uuid) from public, anon;
grant execute on function public.group_member_count(uuid) to authenticated;

-- ============================================================
-- JOIN: OTA-05 anonymous gates + Free Plan cap 5 + row lock
-- ============================================================

create or replace function public.join_group(p_code text)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups;
  v_uid uuid := (select auth.uid());
  v_count integer;
  v_leader_id uuid;
  v_expires_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if public.is_auth_user_anonymous(v_uid) then
    select p.anonymous_expires_at into v_expires_at
    from public.profiles p
    where p.id = v_uid;

    if v_expires_at is not null and v_expires_at <= now() then
      raise exception 'anonymous access expired'
        using errcode = 'P0401';
    end if;
  end if;

  select * into g from public.groups where invite_code = upper(p_code) limit 1;
  if not found then
    raise exception 'group not found for code %', p_code using errcode = 'P0002';
  end if;

  if exists(
    select 1 from public.memberships
    where group_id = g.id and user_id = v_uid
  ) then
    return g;
  end if;

  -- Serialize concurrent joins on this group (prevents 6th under race).
  perform 1 from public.groups where id = g.id for update;

  select count(*)::integer into v_count
  from public.memberships
  where group_id = g.id;

  if v_count >= 5 then
    select m.user_id into v_leader_id
    from public.memberships m
    where m.group_id = g.id and m.role = 'leader'
    limit 1;

    if v_leader_id is null then
      v_leader_id := g.created_by;
    end if;

    -- OTA-05: anonymous Leader must register (still Free-capped at 5 after).
    if public.is_auth_user_anonymous(v_leader_id) then
      raise exception 'leader registration required before adding member 6'
        using errcode = 'P0406';
    end if;

    raise exception 'member_limit'
      using errcode = 'P0003',
            detail = 'Free plan allows at most 5 members including the leader';
  end if;

  insert into public.memberships (group_id, user_id, role, status)
  values (g.id, v_uid, 'follower', 'active')
  on conflict (group_id, user_id) do nothing;

  perform public.ensure_anonymous_expiry(v_uid);

  return g;
end;
$$;

revoke all on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;

-- ============================================================
-- ITINERARY: Free Plan max 5 points (locked, pure premium read)
-- ============================================================

create or replace function public.enforce_itinerary_point_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_premium boolean;
begin
  -- Serialize concurrent inserts for this group.
  perform 1 from public.groups where id = new.group_id for update;

  -- Pure time-aware check (no mutate). Trip isolation via group_has_active_premium.
  v_premium := public.group_has_active_premium(new.group_id);
  if v_premium then
    return new;
  end if;

  select count(*)::integer into v_count
  from public.itinerary_items i
  where i.group_id = new.group_id
    and (
      (new.subgroup_id is null and i.subgroup_id is null)
      or i.subgroup_id = new.subgroup_id
    );

  if v_count >= 5 then
    raise exception 'itinerary_point_limit'
      using errcode = 'P0004',
            detail = 'Free plan allows at most 5 itinerary points per itinerary';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_itinerary_point_limit on public.itinerary_items;
create trigger trg_enforce_itinerary_point_limit
  before insert on public.itinerary_items
  for each row
  execute function public.enforce_itinerary_point_limit();

-- ============================================================
-- Block direct client profiles.pro self-grant
-- ============================================================

create or replace function public.prevent_client_pro_self_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.pro is distinct from old.pro
     and new.pro = true
     and (select auth.uid()) is not null
     and new.id = (select auth.uid())
     and current_setting('request.jwt.claims', true) is not null
     and coalesce(current_setting('app.entitlement_write', true), '') <> 'allowed'
  then
    raise exception 'entitlement_write_forbidden'
      using errcode = '42501',
            detail = 'Premium must be granted via verified purchase or promo redemption';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_client_pro_self_grant on public.profiles;
create trigger trg_prevent_client_pro_self_grant
  before update of pro, pro_plan, pro_purchased_at, pro_expires_at on public.profiles
  for each row
  execute function public.prevent_client_pro_self_grant();

-- ============================================================
-- RPC: get_trip_entitlement
-- ============================================================

create or replace function public.get_trip_entitlement(p_group_id uuid)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid;
  v_row public.trip_entitlements%rowtype;
  v_member_count integer;
  v_is_member boolean;
  v_lifetime boolean;
  v_user_plan text;
  v_user_purchased timestamptz;
  v_effective boolean;
  v_eligible boolean;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- Sweep only this group (definer-only helper; not granted to clients).
  perform public.expire_stale_entitlements(p_group_id);

  select exists(
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = v_uid
  ) into v_is_member;

  if not v_is_member then
    return json_build_object('ok', false, 'error', 'not_member');
  end if;

  v_member_count := public.group_member_count(p_group_id);
  -- Spec: Small Trip Pass for 2–5 person trips.
  v_eligible := v_member_count between 2 and 5;

  select * into v_row
  from public.trip_entitlements e
  where e.group_id = p_group_id
  order by
    case e.status when 'active' then 0 when 'expired' then 1 else 2 end,
    e.created_at desc
  limit 1;

  select p.pro_plan, p.pro_purchased_at
  into v_user_plan, v_user_purchased
  from public.profiles p
  where p.id = v_uid;

  v_lifetime := public.profile_has_lifetime_premium(v_uid);
  v_effective := public.group_has_active_premium(p_group_id);

  if v_row.id is null then
    -- Align status with is_premium: group premium (incl. leader lifetime)
    -- reports active even when the caller themselves is not lifetime.
    return json_build_object(
      'ok', true,
      'is_premium', v_effective,
      'status', case when v_effective then 'active' else 'none' end,
      'plan_code', case
        when v_lifetime then coalesce(v_user_plan, 'lifetime_premium')
        when v_effective then 'lifetime_premium'
        else 'free'
      end,
      'source', case
        when v_lifetime then 'user_profile'
        when v_effective then 'leader_lifetime'
        else null
      end,
      'started_at', case when v_lifetime then v_user_purchased else null end,
      'expires_at', null,
      'member_count', v_member_count,
      'member_limit', 5,
      'destination_limit', case when v_effective then null else 5 end,
      'trip_applicable', v_eligible,
      'small_trip_eligible', v_eligible and not v_effective
    );
  end if;

  -- When group is still premium (e.g. leader lifetime) but the selected trip
  -- row is expired/revoked, report status active so client is_premium/status align.
  return json_build_object(
    'ok', true,
    'is_premium', v_effective,
    'status', case
      when v_effective and v_row.status = 'active' then 'active'
      when v_effective then 'active'
      else v_row.status
    end,
    'plan_code', case
      when v_row.status = 'active' then v_row.plan_code
      when v_effective and v_lifetime then coalesce(v_user_plan, 'lifetime_premium')
      when v_effective then coalesce(v_row.plan_code, 'lifetime_premium')
      else v_row.plan_code
    end,
    'source', case
      when v_row.status = 'active' then v_row.source
      when v_effective and v_lifetime then 'user_profile'
      when v_effective then 'leader_lifetime'
      else v_row.source
    end,
    'started_at', case
      when v_row.status = 'active' then v_row.started_at
      when v_lifetime then v_user_purchased
      else v_row.started_at
    end,
    'expires_at', case
      when v_row.status = 'active' then v_row.expires_at
      when v_effective then null
      else v_row.expires_at
    end,
    'member_count', v_member_count,
    'member_limit', 5,
    'destination_limit', case when v_effective then null else 5 end,
    'trip_applicable', v_eligible,
    'small_trip_eligible', v_eligible and not v_effective,
    'entitlement_id', v_row.id
  );
end;
$$;

revoke all on function public.get_trip_entitlement(uuid) from public, anon;
grant execute on function public.get_trip_entitlement(uuid) to authenticated;

-- ============================================================
-- RPC: apply_verified_purchase — service_role ONLY (BUILD-02 verifier)
-- ============================================================
-- Authenticated end-users must NOT call this with a client-invented
-- transaction_id. The BUILD-02 Edge Function verifies Apple/Google receipts
-- then invokes this RPC with the service role.

create or replace function public.apply_verified_purchase(
  p_group_id uuid,
  p_transaction_id text,
  p_product_id text default 'small_trip_pass'
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid;
  v_count integer;
  v_existing public.trip_entitlements%rowtype;
  v_row public.trip_entitlements%rowtype;
  v_started timestamptz := now();
  v_expires timestamptz := now() + interval '7 days';
  v_plan text;
begin
  -- Trust boundary: EXECUTE is granted to service_role only (see grants below).
  -- Authenticated clients cannot invent transaction_ids. BUILD-02 Edge Function
  -- verifies store receipts then invokes this RPC with the service role.
  -- Owner is the current group leader (trip-scoped grant).
  select m.user_id into v_uid
  from public.memberships m
  where m.group_id = p_group_id and m.role = 'leader'
  limit 1;

  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_applicable');
  end if;

  if p_transaction_id is null or length(trim(p_transaction_id)) = 0 then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  -- Allow-list product ids (single product for OTA-08).
  v_plan := case lower(trim(coalesce(p_product_id, '')))
    when 'small_trip_pass' then 'small_trip_pass'
    when 'hither.small_trip_pass' then 'small_trip_pass'
    when '' then 'small_trip_pass'
    else null
  end;
  if v_plan is null then
    return json_build_object('ok', false, 'error', 'invalid', 'message', 'unknown product_id');
  end if;

  select * into v_existing
  from public.trip_entitlements
  where transaction_id = p_transaction_id
  limit 1;
  if found then
    return json_build_object(
      'ok', false,
      'error', 'duplicate',
      'status', v_existing.status,
      'entitlement_id', v_existing.id,
      'started_at', v_existing.started_at,
      'expires_at', v_existing.expires_at
    );
  end if;

  perform public.expire_stale_entitlements(p_group_id);

  if public.group_has_active_premium(p_group_id) then
    select * into v_existing
    from public.trip_entitlements e
    where e.group_id = p_group_id and e.status = 'active'
    order by e.created_at desc
    limit 1;
    return json_build_object(
      'ok', false,
      'error', 'duplicate',
      'status', coalesce(v_existing.status, 'active'),
      'message', 'trip already has active premium'
    );
  end if;

  -- Lock group while counting / inserting entitlement.
  perform 1 from public.groups where id = p_group_id for update;

  v_count := public.group_member_count(p_group_id);
  -- Spec: 2–5 people only.
  if v_count < 2 or v_count > 5 then
    return json_build_object(
      'ok', false,
      'error', 'not_applicable',
      'member_count', v_count,
      'message', 'Small Trip Pass requires 2–5 members including the leader'
    );
  end if;

  insert into public.trip_entitlements (
    group_id, owner_user_id, plan_code, status, source,
    started_at, expires_at, transaction_id
  ) values (
    p_group_id, v_uid, v_plan, 'active', 'purchase',
    v_started, v_expires, p_transaction_id
  )
  returning * into v_row;

  -- Do NOT write profiles.pro for trip-scoped passes (prevents cross-trip leak).

  return json_build_object(
    'ok', true,
    'status', 'active',
    'plan_code', v_row.plan_code,
    'entitlement_id', v_row.id,
    'started_at', v_row.started_at,
    'expires_at', v_row.expires_at,
    'is_premium', true
  );
end;
$$;

revoke all on function public.apply_verified_purchase(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_verified_purchase(uuid, text, text) to service_role;

-- ============================================================
-- RPC: restore_entitlements — reinstall via server (no local trust)
-- ============================================================

create or replace function public.restore_entitlements(p_group_id uuid default null)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid;
  v_lifetime boolean;
  v_user_plan text;
  v_user_purchased timestamptz;
  v_trip json;
  v_any_active boolean := false;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_group_id is not null then
    perform public.expire_stale_entitlements(p_group_id);
  end if;

  v_lifetime := public.profile_has_lifetime_premium(v_uid);
  select p.pro_plan, p.pro_purchased_at
  into v_user_plan, v_user_purchased
  from public.profiles p
  where p.id = v_uid;

  if v_lifetime then
    v_any_active := true;
  end if;

  -- Clear any stale expiring denorm left from older builds (trip passes).
  if exists(
    select 1 from public.profiles p
    where p.id = v_uid and p.pro = true and p.pro_expires_at is not null
  ) then
    perform public.allow_entitlement_profile_write();
    update public.profiles
    set pro = false, pro_expires_at = null, pro_plan = null
    where id = v_uid
      and pro_expires_at is not null;
  end if;

  if p_group_id is not null then
    v_trip := public.get_trip_entitlement(p_group_id);
    if coalesce((v_trip->>'is_premium')::boolean, false) then
      v_any_active := true;
    end if;
  else
    -- Any still-active owned trip entitlement counts as restorable premium for UI.
    if exists(
      select 1 from public.trip_entitlements e
      where e.owner_user_id = v_uid
        and e.status = 'active'
        and (e.expires_at is null or e.expires_at > now())
    ) then
      v_any_active := true;
    end if;
  end if;

  return json_build_object(
    'ok', true,
    'is_premium', v_any_active,
    'user_pro', v_lifetime,
    'plan_code', case when v_lifetime then coalesce(v_user_plan, 'lifetime_premium') else 'free' end,
    'started_at', v_user_purchased,
    'expires_at', null,
    'trip', v_trip
  );
end;
$$;

revoke all on function public.restore_entitlements(uuid) from public, anon;
grant execute on function public.restore_entitlements(uuid) to authenticated;

-- ============================================================
-- RPC: revoke_trip_entitlement
-- ============================================================

create or replace function public.revoke_trip_entitlement(
  p_entitlement_id uuid,
  p_reason text default 'revoked'
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid;
  v_row public.trip_entitlements%rowtype;
  v_status text;
  v_role text;
begin
  v_uid := (select auth.uid());
  v_role := coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    ''
  );

  select * into v_row
  from public.trip_entitlements
  where id = p_entitlement_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  -- Owner or service_role (refund webhook).
  if v_role is distinct from 'service_role'
     and (v_uid is null or v_row.owner_user_id <> v_uid)
  then
    return json_build_object('ok', false, 'error', 'not_applicable');
  end if;

  if v_row.status <> 'active' then
    return json_build_object('ok', false, 'error', v_row.status, 'status', v_row.status);
  end if;

  v_status := case
    when p_reason = 'refunded' then 'refunded'
    when p_reason = 'invalid' then 'invalid'
    else 'revoked'
  end;

  update public.trip_entitlements
  set status = v_status, updated_at = now()
  where id = p_entitlement_id;

  return json_build_object('ok', true, 'status', v_status, 'entitlement_id', p_entitlement_id);
end;
$$;

revoke all on function public.revoke_trip_entitlement(uuid, text) from public, anon;
grant execute on function public.revoke_trip_entitlement(uuid, text) to authenticated;
grant execute on function public.revoke_trip_entitlement(uuid, text) to service_role;

-- ============================================================
-- RPC: redeem_promo_code
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

  if v_plan_code = 'small_trip_pass' then
    if p_group_id is null then
      return json_build_object(
        'success', false,
        'error', 'not_applicable',
        'code', 'not_applicable',
        'message', 'Small Trip Pass requires an active trip'
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
    if v_count < 2 or v_count > 5 then
      return json_build_object(
        'success', false,
        'error', 'not_applicable',
        'code', 'not_applicable',
        'message', 'Small Trip Pass requires 2–5 members including the leader'
      );
    end if;

    v_expires := v_started + interval '7 days';

    insert into public.trip_entitlements (
      group_id, owner_user_id, plan_code, status, source,
      started_at, expires_at, promo_code
    ) values (
      p_group_id, v_uid, 'small_trip_pass', 'active', 'promo',
      v_started, v_expires, v_promo.code
    )
    returning id into v_entitlement_id;

    -- Trip-scoped only: do not write profiles.pro.
  else
    -- Lifetime: user-scoped profiles.pro with NULL expiry (never trip denorm).
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
