-- Rewarded Ads Token Store (2026-07-30)
-- Server-authoritative wallet, ledger, reward sessions, catalog, credits,
-- live-activity user entitlement, redeem RPC, SSV credit RPC, and restore of
-- Free Plan gathering-point limits (closed_at IS NULL, credit-aware).
-- Client JWT has SELECT-only on own wallet/ledger; no client write policies.

-- ============================================================
-- Extend trip_entitlements.source for token day-pass redemption
-- ============================================================

alter table public.trip_entitlements
  drop constraint if exists trip_entitlements_source_check;

alter table public.trip_entitlements
  add constraint trip_entitlements_source_check
  check (source in ('purchase', 'restore', 'promo', 'grant', 'token_redemption'));

-- ============================================================
-- token_wallets
-- ============================================================

create table if not exists public.token_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table public.token_wallets enable row level security;

drop policy if exists "token_wallets: select own" on public.token_wallets;
create policy "token_wallets: select own"
  on public.token_wallets for select to authenticated
  using (user_id = (select auth.uid()));
-- No insert/update/delete policies → client writes denied.

-- ============================================================
-- token_ledger (append-only)
-- ============================================================

create table if not exists public.token_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  reason text not null
    check (reason in (
      'rewarded_ad',
      'redeem_product',
      'admin_adjust',
      'account_cleanup'
    )),
  external_ref text,
  product_code text,
  group_id uuid references public.groups(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists token_ledger_external_ref_uidx
  on public.token_ledger (external_ref)
  where external_ref is not null;

create index if not exists idx_token_ledger_user_created
  on public.token_ledger (user_id, created_at desc);

alter table public.token_ledger enable row level security;

drop policy if exists "token_ledger: select own" on public.token_ledger;
create policy "token_ledger: select own"
  on public.token_ledger for select to authenticated
  using (user_id = (select auth.uid()));
-- No client write policies.

-- ============================================================
-- reward_sessions
-- ============================================================

create table if not exists public.reward_sessions (
  id uuid primary key default gen_random_uuid(),
  session_ref text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  ad_unit text not null,
  status text not null default 'active'
    check (status in ('active', 'verifying', 'credited', 'failed', 'expired')),
  google_transaction_id text,
  expires_at timestamptz not null,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists reward_sessions_google_txn_uidx
  on public.reward_sessions (google_transaction_id)
  where google_transaction_id is not null;

-- One unfinished session per user: active (loading/showing) OR verifying (SSV pending).
-- failed / credited / expired free the slot for the next ad.
drop index if exists reward_sessions_one_active_per_user;
create unique index if not exists reward_sessions_one_unfinished_per_user
  on public.reward_sessions (user_id)
  where status in ('active', 'verifying');

create index if not exists idx_reward_sessions_ref
  on public.reward_sessions (session_ref);

create index if not exists idx_reward_sessions_user
  on public.reward_sessions (user_id, created_at desc);

alter table public.reward_sessions enable row level security;

drop policy if exists "reward_sessions: select own" on public.reward_sessions;
create policy "reward_sessions: select own"
  on public.reward_sessions for select to authenticated
  using (user_id = (select auth.uid()));
-- No client write policies.

-- ============================================================
-- store_product_catalog
-- ============================================================

create table if not exists public.store_product_catalog (
  code text primary key,
  display_name text not null,
  scope text not null check (scope in ('team', 'personal')),
  price_tokens integer not null check (price_tokens > 0),
  effect_json jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_product_catalog enable row level security;

drop policy if exists "store_product_catalog: select active or any authenticated"
  on public.store_product_catalog;
create policy "store_product_catalog: select authenticated"
  on public.store_product_catalog for select to authenticated
  using (true);
-- No client write policies.

insert into public.store_product_catalog
  (code, display_name, scope, price_tokens, effect_json, sort_order, active)
values
  ('team_premium_1d', 'Premium 一日卡', 'team', 5,
    '{"kind":"team_premium_days","days":1}'::jsonb, 10, true),
  ('team_premium_3d', 'Premium 三日卡', 'team', 12,
    '{"kind":"team_premium_days","days":3}'::jsonb, 20, true),
  ('team_premium_7d', 'Premium 七日卡', 'team', 25,
    '{"kind":"team_premium_days","days":7}'::jsonb, 30, true),
  ('team_extra_points_3', '額外 3 個集合點', 'team', 4,
    '{"kind":"team_extra_points","credits":3}'::jsonb, 40, true),
  ('team_extra_points_10', '額外 10 個集合點', 'team', 12,
    '{"kind":"team_extra_points","credits":10}'::jsonb, 50, true),
  ('personal_live_activity_lifetime', '即時動態永久解鎖', 'personal', 10,
    '{"kind":"personal_live_activity_lifetime"}'::jsonb, 60, true)
on conflict (code) do update
set display_name = excluded.display_name,
    scope = excluded.scope,
    price_tokens = excluded.price_tokens,
    effect_json = excluded.effect_json,
    sort_order = excluded.sort_order,
    active = excluded.active,
    updated_at = now();

-- ============================================================
-- trip_extra_point_credits (team-scoped one-shot credits)
-- ============================================================

create table if not exists public.trip_extra_point_credits (
  group_id uuid primary key references public.groups(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table public.trip_extra_point_credits enable row level security;

drop policy if exists "trip_extra_point_credits: select if member"
  on public.trip_extra_point_credits;
create policy "trip_extra_point_credits: select if member"
  on public.trip_extra_point_credits for select to authenticated
  using (extensions.is_member(group_id));
-- No client write policies.

-- ============================================================
-- user_entitlements (personal grants e.g. live activity lifetime)
-- ============================================================

create table if not exists public.user_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_code text not null
    check (entitlement_code in ('personal_live_activity_lifetime')),
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  source text not null
    check (source in ('token_redemption', 'grant', 'promo')),
  granted_at timestamptz not null default now(),
  transaction_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_entitlements_active_code_uidx
  on public.user_entitlements (user_id, entitlement_code)
  where status = 'active';

create unique index if not exists user_entitlements_transaction_ref_uidx
  on public.user_entitlements (transaction_ref)
  where transaction_ref is not null;

alter table public.user_entitlements enable row level security;

drop policy if exists "user_entitlements: select own" on public.user_entitlements;
create policy "user_entitlements: select own"
  on public.user_entitlements for select to authenticated
  using (user_id = (select auth.uid()));
-- No client write policies.

-- ============================================================
-- Constants: allow-listed ad units
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

revoke all on function public.rewarded_ad_unit_for_platform(text) from public, anon;
grant execute on function public.rewarded_ad_unit_for_platform(text) to authenticated, service_role;

-- ============================================================
-- Helpers: wallet ensure + debit/credit (security definer only)
-- ============================================================

create or replace function public.ensure_token_wallet(p_user_id uuid)
returns public.token_wallets
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_row public.token_wallets%rowtype;
begin
  insert into public.token_wallets (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_row from public.token_wallets where user_id = p_user_id for update;
  return v_row;
end;
$$;

revoke all on function public.ensure_token_wallet(uuid) from public, anon, authenticated;
grant execute on function public.ensure_token_wallet(uuid) to service_role;

create or replace function public.expire_stale_reward_sessions(p_user_id uuid default null)
returns void
language plpgsql
security definer
volatile
set search_path = ''
as $$
begin
  -- Expire any unfinished session past TTL (active load OR verifying SSV delay).
  update public.reward_sessions
  set status = 'expired',
      updated_at = now()
  where status in ('active', 'verifying')
    and expires_at < now()
    and (p_user_id is null or user_id = p_user_id);
end;
$$;

revoke all on function public.expire_stale_reward_sessions(uuid) from public, anon, authenticated;
grant execute on function public.expire_stale_reward_sessions(uuid) to service_role;

create or replace function public.user_has_live_activity_lifetime(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.user_entitlements ue
    where ue.user_id = p_user_id
      and ue.entitlement_code = 'personal_live_activity_lifetime'
      and ue.status = 'active'
  );
$$;

revoke all on function public.user_has_live_activity_lifetime(uuid) from public, anon;
grant execute on function public.user_has_live_activity_lifetime(uuid) to authenticated, service_role;

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
  if p_group_id is not null and public.group_has_active_premium(p_group_id) then
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.effective_live_activity_entitlement(uuid, uuid) from public, anon;
grant execute on function public.effective_live_activity_entitlement(uuid, uuid) to authenticated, service_role;

-- ============================================================
-- RPC: get_store_snapshot
-- ============================================================

create or replace function public.get_store_snapshot(p_group_id uuid default null)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_anonymous boolean := false;
  v_balance integer := 0;
  v_catalog json;
  v_is_member boolean := false;
  v_group_name text := null;
  v_premium json := null;
  v_extra_credits integer := 0;
  v_live_personal boolean := false;
  v_live_effective boolean := false;
  v_active_session json := null;
  v_member_count integer := 0;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_anonymous := public.is_auth_user_anonymous(v_uid);
  perform public.expire_stale_reward_sessions(v_uid);
  if p_group_id is not null then
    perform public.expire_stale_entitlements(p_group_id);
  end if;

  -- Ensure wallet row exists for registered users (readable cache).
  if not v_anonymous then
    insert into public.token_wallets (user_id, balance)
    values (v_uid, 0)
    on conflict (user_id) do nothing;
    select balance into v_balance from public.token_wallets where user_id = v_uid;
  end if;

  select coalesce(json_agg(row_to_json(c) order by c.sort_order), '[]'::json)
  into v_catalog
  from (
    select code, display_name, scope, price_tokens, effect_json, sort_order, active
    from public.store_product_catalog
    where active = true
    order by sort_order
  ) c;

  v_live_personal := public.user_has_live_activity_lifetime(v_uid);
  -- Personal lifetime always counts; team Premium only when member of p_group_id.
  v_live_effective := v_live_personal;

  if p_group_id is not null then
    select exists(
      select 1 from public.memberships m
      where m.group_id = p_group_id and m.user_id = v_uid
    ) into v_is_member;

    if v_is_member then
      select g.name into v_group_name from public.groups g where g.id = p_group_id;
      v_member_count := public.group_member_count(p_group_id);
      v_premium := public.get_trip_entitlement(p_group_id);
      select coalesce(c.balance, 0) into v_extra_credits
      from public.trip_extra_point_credits c
      where c.group_id = p_group_id;
      if not found then
        v_extra_credits := 0;
      end if;
      -- effective = personal OR team premium (personal already set above).
      if not v_live_effective then
        v_live_effective := public.effective_live_activity_entitlement(v_uid, p_group_id);
      end if;
    end if;
  end if;

  select json_build_object(
    'session_ref', s.session_ref,
    'platform', s.platform,
    'status', s.status,
    'expires_at', s.expires_at,
    'created_at', s.created_at
  )
  into v_active_session
  from public.reward_sessions s
  where s.user_id = v_uid
    and s.status in ('active', 'verifying')
  order by s.created_at desc
  limit 1;

  if v_anonymous then
    return json_build_object(
      'ok', true,
      'anonymous', true,
      'registration_required', true,
      'balance', 0,
      'catalog', v_catalog,
      'can_create_reward_session', false,
      'can_redeem', false,
      'group_id', p_group_id,
      'group_name', v_group_name,
      'is_member', v_is_member,
      'member_count', v_member_count,
      'trip_premium', v_premium,
      'extra_point_credits', v_extra_credits,
      'live_activity_personal', false,
      'live_activity_effective', false,
      'active_reward_session', null
    );
  end if;

  return json_build_object(
    'ok', true,
    'anonymous', false,
    'registration_required', false,
    'balance', coalesce(v_balance, 0),
    'catalog', v_catalog,
    'can_create_reward_session', true,
    'can_redeem', true,
    'group_id', p_group_id,
    'group_name', v_group_name,
    'is_member', v_is_member,
    'member_count', v_member_count,
    'trip_premium', v_premium,
    'extra_point_credits', coalesce(v_extra_credits, 0),
    'live_activity_personal', v_live_personal,
    'live_activity_effective', v_live_effective,
    'active_reward_session', v_active_session
  );
end;
$$;

revoke all on function public.get_store_snapshot(uuid) from public, anon;
grant execute on function public.get_store_snapshot(uuid) to authenticated;

-- ============================================================
-- RPC: create_reward_session
-- ============================================================

create or replace function public.create_reward_session(p_platform text)
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

  v_ad_unit := public.rewarded_ad_unit_for_platform(v_platform);
  if v_ad_unit is null then
    return json_build_object('ok', false, 'error', 'invalid_platform');
  end if;

  perform public.expire_stale_reward_sessions(v_uid);

  -- Block create while any unfinished session exists (active OR verifying).
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

  -- Opaque session ref — never a Supabase JWT.
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
      -- Concurrent create raced the one-unfinished-per-user index.
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

revoke all on function public.create_reward_session(text) from public, anon;
grant execute on function public.create_reward_session(text) to authenticated;

-- ============================================================
-- RPC: update_reward_session_status (client fail / verifying)
-- ============================================================
-- Authenticated owner may move own active session to verifying or failed.
-- Completes the Spec lifecycle so no-fill / dismiss does not strand the
-- one-active-per-user slot for 30 minutes.

create or replace function public.update_reward_session_status(
  p_session_ref text,
  p_status text
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.reward_sessions%rowtype;
  v_next text;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_next := lower(trim(coalesce(p_status, '')));
  if v_next not in ('failed', 'verifying') then
    return json_build_object('ok', false, 'error', 'invalid_status');
  end if;

  if p_session_ref is null or length(trim(p_session_ref)) = 0 then
    return json_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select * into v_row
  from public.reward_sessions
  where session_ref = p_session_ref
    and user_id = v_uid
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'session_not_found');
  end if;

  -- Terminal states are immutable from the client.
  if v_row.status in ('credited', 'failed', 'expired') then
    return json_build_object(
      'ok', true,
      'already', true,
      'status', v_row.status,
      'session_ref', v_row.session_ref
    );
  end if;

  -- verifying → failed allowed (dismiss after earn is rare; fail is ok).
  -- active → verifying | failed allowed.
  if v_row.status = 'verifying' and v_next = 'verifying' then
    return json_build_object(
      'ok', true,
      'already', true,
      'status', 'verifying',
      'session_ref', v_row.session_ref
    );
  end if;

  if v_row.status not in ('active', 'verifying') then
    return json_build_object('ok', false, 'error', 'session_' || v_row.status);
  end if;

  update public.reward_sessions
  set status = v_next,
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return json_build_object(
    'ok', true,
    'status', v_row.status,
    'session_ref', v_row.session_ref
  );
end;
$$;

revoke all on function public.update_reward_session_status(text, text) from public, anon;
grant execute on function public.update_reward_session_status(text, text) to authenticated;

-- ============================================================
-- RPC: credit_rewarded_ad_transaction (service_role / Edge only)
-- ============================================================

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

  -- Allow-list ad units only.
  if p_ad_unit is distinct from 'ca-app-pub-8135109277557342/7899053731'
     and p_ad_unit is distinct from 'ca-app-pub-8135109277557342/7100977386'
  then
    return json_build_object('ok', false, 'error', 'invalid_ad_unit');
  end if;

  v_amount_ok := trim(coalesce(p_reward_amount, '')) in ('1', '1.0', '1.00');
  v_item_ok := lower(trim(coalesce(p_reward_item, ''))) in ('hither_token', 'hither token');
  if not v_amount_ok or not v_item_ok then
    return json_build_object('ok', false, 'error', 'invalid_reward');
  end if;

  -- Idempotency: same Google transaction already credited.
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

  -- Platform match via ad unit (primary); optional hint.
  if p_platform_hint is not null
     and lower(trim(p_platform_hint)) in ('ios', 'android')
     and lower(trim(p_platform_hint)) is distinct from v_session.platform
  then
    return json_build_object('ok', false, 'error', 'platform_mismatch');
  end if;

  -- Credit wallet + ledger in one transaction (function is already transactional).
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
    -- Concurrent credit of same transaction/session — treat as success idempotent.
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

revoke all on function public.credit_rewarded_ad_transaction(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.credit_rewarded_ad_transaction(text, text, text, text, text, text)
  to service_role;

-- ============================================================
-- RPC: redeem_store_product
-- ============================================================

create or replace function public.redeem_store_product(
  p_product_code text,
  p_group_id uuid default null
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_product public.store_product_catalog%rowtype;
  v_wallet public.token_wallets%rowtype;
  v_is_member boolean;
  v_member_count integer;
  v_kind text;
  v_days integer;
  v_credits integer;
  v_redemption_id text;
  v_ent public.trip_entitlements%rowtype;
  v_blocking public.trip_entitlements%rowtype;
  v_started timestamptz;
  v_expires timestamptz;
  v_new_balance integer;
  v_ue public.user_entitlements%rowtype;
  v_credit_bal integer;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public.is_auth_user_anonymous(v_uid) then
    return json_build_object('ok', false, 'error', 'registration_required');
  end if;

  -- Fixed product-code allow-list for grant behavior (Spec: not catalog DSL).
  -- Catalog supplies price / active / display only.
  case p_product_code
    when 'team_premium_1d' then
      v_kind := 'team_premium_days'; v_days := 1; v_credits := 0;
    when 'team_premium_3d' then
      v_kind := 'team_premium_days'; v_days := 3; v_credits := 0;
    when 'team_premium_7d' then
      v_kind := 'team_premium_days'; v_days := 7; v_credits := 0;
    when 'team_extra_points_3' then
      v_kind := 'team_extra_points'; v_days := 0; v_credits := 3;
    when 'team_extra_points_10' then
      v_kind := 'team_extra_points'; v_days := 0; v_credits := 10;
    when 'personal_live_activity_lifetime' then
      v_kind := 'personal_live_activity_lifetime'; v_days := 0; v_credits := 0;
    else
      return json_build_object('ok', false, 'error', 'product_unavailable');
  end case;

  select * into v_product
  from public.store_product_catalog
  where code = p_product_code
  for share;
  if not found or not v_product.active then
    return json_build_object('ok', false, 'error', 'product_unavailable');
  end if;

  v_redemption_id := 'redeem:' || replace(gen_random_uuid()::text, '-', '');

  -- Lock wallet first for atomic debit.
  v_wallet := public.ensure_token_wallet(v_uid);
  if v_wallet.balance < v_product.price_tokens then
    return json_build_object(
      'ok', false,
      'error', 'insufficient_balance',
      'balance', v_wallet.balance,
      'price', v_product.price_tokens,
      'shortfall', v_product.price_tokens - v_wallet.balance
    );
  end if;

  -- Team-scoped products require membership + group.
  if v_product.scope = 'team' then
    if p_group_id is null then
      return json_build_object('ok', false, 'error', 'group_required');
    end if;

    perform 1 from public.groups where id = p_group_id for update;

    select exists(
      select 1 from public.memberships m
      where m.group_id = p_group_id and m.user_id = v_uid
    ) into v_is_member;
    if not v_is_member then
      return json_build_object('ok', false, 'error', 'not_member');
    end if;

    perform public.expire_stale_entitlements(p_group_id);
    v_member_count := public.group_member_count(p_group_id);
  end if;

  if v_kind = 'team_premium_days' then
    if v_days not in (1, 3, 7) then
      return json_build_object('ok', false, 'error', 'invalid');
    end if;
    if v_member_count < 2 or v_member_count > 5 then
      return json_build_object(
        'ok', false,
        'error', 'not_applicable',
        'message', 'Premium day pass requires 2–5 members'
      );
    end if;

    -- Lifetime (leader) or non-token active premium blocks day-pass redemption.
    if public.group_has_active_premium(p_group_id) then
      select * into v_blocking
      from public.trip_entitlements e
      where e.group_id = p_group_id
        and e.status = 'active'
        and (e.expires_at is null or e.expires_at > now())
      order by e.created_at desc
      limit 1;

      if not found then
        -- Premium via leader lifetime profile — not applicable.
        return json_build_object(
          'ok', false,
          'error', 'not_applicable',
          'message', 'team already has lifetime or non-token premium'
        );
      end if;

      if v_blocking.source is distinct from 'token_redemption' then
        return json_build_object(
          'ok', false,
          'error', 'not_applicable',
          'message', 'team already has purchase/promo/grant premium',
          'source', v_blocking.source
        );
      end if;

      -- Stack token day pass from existing expires_at.
      v_started := v_blocking.started_at;
      v_expires := coalesce(v_blocking.expires_at, now()) + make_interval(days => v_days);

      update public.token_wallets
      set balance = balance - v_product.price_tokens,
          updated_at = now()
      where user_id = v_uid
        and balance >= v_product.price_tokens
      returning balance into v_new_balance;
      if not found then
        return json_build_object(
          'ok', false,
          'error', 'insufficient_balance',
          'price', v_product.price_tokens
        );
      end if;

      insert into public.token_ledger (
        user_id, delta, balance_after, reason, external_ref, product_code, group_id, metadata
      ) values (
        v_uid, -v_product.price_tokens, v_new_balance, 'redeem_product',
        v_redemption_id, v_product.code, p_group_id,
        jsonb_build_object('days', v_days, 'stacked', true)
      );

      update public.trip_entitlements
      set expires_at = v_expires,
          updated_at = now()
      where id = v_blocking.id
      returning * into v_ent;

      return json_build_object(
        'ok', true,
        'product_code', v_product.code,
        'balance', v_new_balance,
        'redemption_id', v_redemption_id,
        'entitlement_id', v_ent.id,
        'started_at', v_ent.started_at,
        'expires_at', v_ent.expires_at,
        'source', 'token_redemption',
        'stacked', true
      );
    end if;

    -- Fresh token day pass.
    v_started := now();
    v_expires := now() + make_interval(days => v_days);

    update public.token_wallets
    set balance = balance - v_product.price_tokens,
        updated_at = now()
    where user_id = v_uid
      and balance >= v_product.price_tokens
    returning balance into v_new_balance;
    if not found then
      return json_build_object(
        'ok', false,
        'error', 'insufficient_balance',
        'price', v_product.price_tokens
      );
    end if;

    insert into public.token_ledger (
      user_id, delta, balance_after, reason, external_ref, product_code, group_id, metadata
    ) values (
      v_uid, -v_product.price_tokens, v_new_balance, 'redeem_product',
      v_redemption_id, v_product.code, p_group_id,
      jsonb_build_object('days', v_days, 'stacked', false)
    );

    insert into public.trip_entitlements (
      group_id, owner_user_id, plan_code, status, source,
      started_at, expires_at, transaction_id
    ) values (
      p_group_id, v_uid, 'small_trip_pass', 'active', 'token_redemption',
      v_started, v_expires, v_redemption_id
    )
    returning * into v_ent;

    return json_build_object(
      'ok', true,
      'product_code', v_product.code,
      'balance', v_new_balance,
      'redemption_id', v_redemption_id,
      'entitlement_id', v_ent.id,
      'started_at', v_ent.started_at,
      'expires_at', v_ent.expires_at,
      'source', 'token_redemption',
      'stacked', false
    );
  end if;

  if v_kind = 'team_extra_points' then
    if v_credits not in (3, 10) then
      return json_build_object('ok', false, 'error', 'invalid');
    end if;

    update public.token_wallets
    set balance = balance - v_product.price_tokens,
        updated_at = now()
    where user_id = v_uid
      and balance >= v_product.price_tokens
    returning balance into v_new_balance;
    if not found then
      return json_build_object(
        'ok', false,
        'error', 'insufficient_balance',
        'price', v_product.price_tokens
      );
    end if;

    insert into public.token_ledger (
      user_id, delta, balance_after, reason, external_ref, product_code, group_id, metadata
    ) values (
      v_uid, -v_product.price_tokens, v_new_balance, 'redeem_product',
      v_redemption_id, v_product.code, p_group_id,
      jsonb_build_object('credits', v_credits)
    );

    insert into public.trip_extra_point_credits (group_id, balance)
    values (p_group_id, v_credits)
    on conflict (group_id) do update
    set balance = public.trip_extra_point_credits.balance + excluded.balance,
        updated_at = now()
    returning balance into v_credit_bal;

    return json_build_object(
      'ok', true,
      'product_code', v_product.code,
      'balance', v_new_balance,
      'redemption_id', v_redemption_id,
      'extra_point_credits', v_credit_bal
    );
  end if;

  if v_kind = 'personal_live_activity_lifetime' then
    if public.user_has_live_activity_lifetime(v_uid) then
      return json_build_object(
        'ok', false,
        'error', 'not_applicable',
        'message', 'live activity already unlocked'
      );
    end if;

    update public.token_wallets
    set balance = balance - v_product.price_tokens,
        updated_at = now()
    where user_id = v_uid
      and balance >= v_product.price_tokens
    returning balance into v_new_balance;
    if not found then
      return json_build_object(
        'ok', false,
        'error', 'insufficient_balance',
        'price', v_product.price_tokens
      );
    end if;

    insert into public.token_ledger (
      user_id, delta, balance_after, reason, external_ref, product_code, metadata
    ) values (
      v_uid, -v_product.price_tokens, v_new_balance, 'redeem_product',
      v_redemption_id, v_product.code,
      jsonb_build_object('kind', 'personal_live_activity_lifetime')
    );

    insert into public.user_entitlements (
      user_id, entitlement_code, status, source, transaction_ref
    ) values (
      v_uid, 'personal_live_activity_lifetime', 'active', 'token_redemption', v_redemption_id
    )
    returning * into v_ue;

    return json_build_object(
      'ok', true,
      'product_code', v_product.code,
      'balance', v_new_balance,
      'redemption_id', v_redemption_id,
      'live_activity_personal', true,
      'entitlement_id', v_ue.id
    );
  end if;

  return json_build_object('ok', false, 'error', 'invalid');
exception
  when unique_violation then
    return json_build_object('ok', false, 'error', 'conflict');
  -- Balance is pre-checked above; other CHECKs must not map to insufficient_balance.
  when check_violation then
    return json_build_object('ok', false, 'error', 'invalid');
end;
$$;

revoke all on function public.redeem_store_product(text, uuid) from public, anon;
grant execute on function public.redeem_store_product(text, uuid) to authenticated;

-- ============================================================
-- Restore Free Plan gathering-point limit (credit-aware, open points only)
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
  v_credits integer := 0;
begin
  -- Serialize concurrent inserts for this group.
  perform 1 from public.groups where id = new.group_id for update;

  v_premium := public.group_has_active_premium(new.group_id);
  if v_premium then
    return new;
  end if;

  -- Free cap counts only unfinished points (closed_at IS NULL).
  select count(*)::integer into v_count
  from public.itinerary_items i
  where i.group_id = new.group_id
    and i.closed_at is null
    and (
      (new.subgroup_id is null and i.subgroup_id is null)
      or i.subgroup_id = new.subgroup_id
    );

  if v_count < 5 then
    return new;
  end if;

  -- Need one credit for the 6th+ open point.
  select coalesce(c.balance, 0) into v_credits
  from public.trip_extra_point_credits c
  where c.group_id = new.group_id
  for update;
  if not found then
    v_credits := 0;
  end if;

  if v_credits > 0 then
    update public.trip_extra_point_credits
    set balance = balance - 1,
        updated_at = now()
    where group_id = new.group_id
      and balance > 0;
    if found then
      return new;
    end if;
  end if;

  raise exception 'itinerary_point_limit'
    using errcode = 'P0004',
          detail = 'Free plan allows at most 5 open itinerary points per itinerary';
end;
$$;

-- Ensure trigger still attached (idempotent).
drop trigger if exists trg_enforce_itinerary_point_limit on public.itinerary_items;
create trigger trg_enforce_itinerary_point_limit
  before insert on public.itinerary_items
  for each row
  execute function public.enforce_itinerary_point_limit();

-- ============================================================
-- Expand diagnostic_events allow-list for store outcomes
-- ============================================================

alter table public.diagnostic_events
  drop constraint if exists diagnostic_events_event_check;

alter table public.diagnostic_events
  add constraint diagnostic_events_event_check
  check (event in (
    'location_task_registered','location_task_unregistered','location_callback',
    'location_valid','location_rejected_accuracy','location_rejected_distance',
    'location_rejected_time','location_rejected_sharing_disabled',
    'location_outbox_enqueued','location_upload_started','location_upload_succeeded',
    'location_upload_failed','location_upload_discarded',
    'tracking_mode_changed','app_foreground','app_background',
    'app_inactive','team_navigation_received','team_navigation_acknowledged',
    'live_activity_start_requested','live_activity_started','live_activity_updated',
    'live_activity_ended','live_activity_token_register',
    'arrival_candidate','arrival_confirmed',
    'high_accuracy_started','high_accuracy_stopped','refresh_request_received',
    'refresh_request_completed','refresh_request_timeout','permission_changed',
    'metric_payload_received','metric_payload_classified',
    'background_op_timeline','background_op_near_watchdog',
    'previous_launch_incomplete','navigation_terminal_conflict',
    'diagnostic_error',
    -- Store / rewarded ads (outcome + latency only; no signatures / raw session)
    'store_ad_load','store_ad_show','store_ad_dismiss','store_ad_reward_client',
    'store_ssv_verified','store_ssv_rejected','store_ledger_credit',
    'store_redemption_success','store_redemption_failure'
  ));

comment on constraint diagnostic_events_event_check on public.diagnostic_events is
  'Allow-listed diagnostic event names. Expand via migration when clients emit new events.';
