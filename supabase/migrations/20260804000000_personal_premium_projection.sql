-- Ticket 5: account-owned Premium entitlement plus a server-owned team view.
-- The historical trip_entitlements Small Trip Pass remains readable for
-- compatibility, but this migration does not create any new trip pass rows.

create table if not exists public.personal_premium_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'none'
    check (status in ('active', 'expired', 'refunded', 'revoked', 'none')),
  product_id text,
  source text not null default 'app_store',
  source_version text,
  expires_at timestamptz,
  external_key text unique,
  app_account_token uuid,
  source_signed_at timestamptz,
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists personal_premium_entitlements_user_idx
  on public.personal_premium_entitlements(user_id, updated_at desc);
create index if not exists personal_premium_entitlements_active_idx
  on public.personal_premium_entitlements(user_id, status, expires_at);
-- A user keeps one appAccountToken across subscription renewals and
-- transactions. It is a binding attribute, not a per-entitlement key.
drop index if exists public.personal_premium_entitlements_account_token_idx;
create index if not exists personal_premium_entitlements_account_token_idx
  on public.personal_premium_entitlements(app_account_token)
  where app_account_token is not null;

alter table public.personal_premium_entitlements enable row level security;
drop policy if exists "personal_premium_entitlements: select own"
  on public.personal_premium_entitlements;
create policy "personal_premium_entitlements: select own"
  on public.personal_premium_entitlements for select to authenticated
  using (user_id = (select auth.uid()));
-- No authenticated insert/update/delete policy: grants come from server code.

create table if not exists public.premium_team_projections (
  group_id uuid primary key references public.groups(id) on delete cascade,
  team_premium_active boolean not null default false,
  source_version text not null,
  updated_at timestamptz not null default now()
);

alter table public.premium_team_projections enable row level security;
drop policy if exists "premium_team_projections: select if member"
  on public.premium_team_projections;
create policy "premium_team_projections: select if member"
  on public.premium_team_projections for select to authenticated
  using (extensions.is_member(group_id));
-- No authenticated insert/update/delete policy: projections are server-owned.

-- Subscription-only projection source. Historical profile Pro and trip-pass
-- rows are deliberately excluded from the new personal/team Premium view.
create function public.group_has_active_subscription_premium(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.memberships m
    cross join lateral (
      select e.status, e.expires_at
       from public.personal_premium_entitlements e
       where e.user_id = m.user_id
         and e.source = 'app_store'
       order by coalesce(e.source_signed_at, e.updated_at) desc,
                e.updated_at desc
       limit 1
    ) e
    where m.group_id = p_group_id
      and e.status = 'active'
      and e.expires_at > now()
  );
$$;

revoke all on function public.group_has_active_subscription_premium(uuid)
  from public, anon, authenticated;
grant execute on function public.group_has_active_subscription_premium(uuid)
  to service_role;

-- Compatibility facade for the historical get_trip_entitlement RPC. A
-- seven-day trip row remains readable as a trip-scoped result, but the team
-- Premium projection never calls this facade and therefore never treats that
-- old row as an auto-renewable subscription.
create or replace function public.group_has_active_premium(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.group_has_active_subscription_premium(p_group_id)
  or exists(
    select 1
      from public.trip_entitlements e
     where e.group_id = p_group_id
       and e.status = 'active'
       and (e.expires_at is null or e.expires_at > now())
  );
$$;

revoke all on function public.group_has_active_premium(uuid) from public, anon;
grant execute on function public.group_has_active_premium(uuid) to authenticated;

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
    cross join lateral (
      select e.status, e.expires_at, e.source_version
       from public.personal_premium_entitlements e
       where e.user_id = m.user_id
         and e.source = 'app_store'
       order by coalesce(e.source_signed_at, e.updated_at) desc,
                e.updated_at desc
       limit 1
    ) e
   where m.group_id = p_group_id
     and e.status = 'active'
     and e.expires_at > now();

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
  from public, anon, authenticated;
grant execute on function public.recompute_team_premium_projection(uuid) to service_role;

create or replace function public.trg_recompute_premium_for_membership()
returns trigger
language plpgsql
security definer
volatile
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_team_premium_projection(old.group_id);
    return old;
  end if;
  perform public.recompute_team_premium_projection(new.group_id);
  if tg_op = 'UPDATE' and old.group_id is distinct from new.group_id then
    perform public.recompute_team_premium_projection(old.group_id);
  end if;
  return new;
end;
$$;

revoke all on function public.trg_recompute_premium_for_membership()
  from public, anon, authenticated;

drop trigger if exists trg_recompute_premium_membership on public.memberships;
create trigger trg_recompute_premium_membership
  after insert or update or delete on public.memberships
  for each row execute function public.trg_recompute_premium_for_membership();

create or replace function public.trg_recompute_premium_for_entitlement()
returns trigger
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_user_id uuid := coalesce(new.user_id, old.user_id);
  v_group_id uuid;
begin
  for v_group_id in
    select distinct m.group_id
      from public.memberships m
     where m.user_id = v_user_id
  loop
    perform public.recompute_team_premium_projection(v_group_id);
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_recompute_premium_for_entitlement()
  from public, anon, authenticated;

drop trigger if exists trg_recompute_premium_entitlement
  on public.personal_premium_entitlements;
create trigger trg_recompute_premium_entitlement
  after insert or update or delete on public.personal_premium_entitlements
  for each row execute function public.trg_recompute_premium_for_entitlement();

-- Service-side grant/revoke seam. The Edge Function/notification worker is
-- the only caller; its external key makes retries idempotent.
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
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user <> 'service_role' then
    raise exception 'premium_projection_write_forbidden' using errcode = '42501';
  end if;
  if p_user_id is null
     or p_status not in ('active', 'expired', 'refunded', 'revoked', 'none')
     or coalesce(nullif(trim(p_source), ''), 'app_store') <> 'app_store'
     or p_expires_at is null
     or p_external_key is null
     or length(trim(p_external_key)) = 0 then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  insert into public.personal_premium_entitlements (
    user_id, status, product_id, source, source_version, expires_at,
    external_key, app_account_token, source_signed_at, granted_at, updated_at
  ) values (
    p_user_id, p_status, p_product_id, coalesce(nullif(trim(p_source), ''), 'app_store'),
    p_source_version, p_expires_at, trim(p_external_key), p_app_account_token,
    p_source_signed_at, now(), now()
  )
  on conflict (external_key) do update
    set status = excluded.status,
        product_id = excluded.product_id,
        source = excluded.source,
        source_version = excluded.source_version,
        expires_at = excluded.expires_at,
        app_account_token = coalesce(excluded.app_account_token,
                                     public.personal_premium_entitlements.app_account_token),
        source_signed_at = coalesce(excluded.source_signed_at,
                                    public.personal_premium_entitlements.source_signed_at),
        updated_at = now()
  returning * into v_row;

  return json_build_object(
    'ok', true,
    'entitlement_id', v_row.id,
    'user_id', v_row.user_id,
    'status', v_row.status,
    'product_id', v_row.product_id,
    'expires_at', v_row.expires_at,
    'source_version', v_row.source_version
  );
end;
$$;

revoke all on function public.apply_personal_premium_projection(
  uuid, text, text, timestamptz, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_personal_premium_projection(
  uuid, text, text, timestamptz, text, text, text, uuid, timestamptz
) to service_role;

-- Fixed transport shape for the app. `p_group_id` may be null when a user is
-- restoring a personal grant outside a team.
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

  update public.personal_premium_entitlements
     set status = 'expired', updated_at = now()
   where user_id = v_uid
     and status = 'active'
     and expires_at is not null
     and expires_at <= now();

  select * into v_row
   from public.personal_premium_entitlements e
   where e.user_id = v_uid
     and e.source = 'app_store'
   order by coalesce(e.source_signed_at, e.updated_at) desc,
            e.updated_at desc
   limit 1;

  if v_row.id is not null then
    v_status := v_row.status;
    v_product_id := v_row.product_id;
    v_expires_at := v_row.expires_at;
    v_source_version := v_row.source_version;
  end if;

  if p_group_id is not null then
    if not exists (
      select 1 from public.memberships m
       where m.group_id = p_group_id and m.user_id = v_uid
    ) then
      raise exception 'not_member' using errcode = '42501';
    end if;
    v_projection := public.recompute_team_premium_projection(p_group_id);
    v_team := v_projection.team_premium_active;
  end if;

  return json_build_object(
    'personalPremiumActive', (v_status = 'active' and v_expires_at > now()),
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

comment on table public.personal_premium_entitlements is
  'Account-owned Premium grants; never transfer ownership to a group leader.';
comment on table public.premium_team_projections is
  'Server-recomputed team Premium projection from current member entitlements.';
