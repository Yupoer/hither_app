-- OTA-05 P1 fix: 14-day anonymous expiry must gate ongoing membership access,
-- not only join/create. Shared choke-point is extensions.is_member (RLS + many RPCs).
-- Cleanup remains data hygiene; this is authorization.

-- ============================================================
-- Shared active-access helper (registered unchanged; anonymous must be unexpired)
-- ============================================================

create or replace function public.anonymous_access_is_active(p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expires_at timestamptz;
  v_first_joined timestamptz;
begin
  if p_uid is null then
    return false;
  end if;

  -- Registered / upgraded identities: membership alone is enough.
  if not public.is_auth_user_anonymous(p_uid) then
    return true;
  end if;

  select p.anonymous_expires_at into v_expires_at
  from public.profiles p
  where p.id = p_uid;

  -- Fallback when profile column was never stamped (legacy rows).
  if v_expires_at is null then
    select min(m.created_at) into v_first_joined
    from public.memberships m
    where m.user_id = p_uid;
    if v_first_joined is not null then
      v_expires_at := v_first_joined + interval '14 days';
    end if;
  end if;

  -- Null after fallback: access has not started (no membership) → treat as active
  -- for non-membership checks; is_member still requires a memberships row.
  if v_expires_at is null then
    return true;
  end if;

  -- At and after expiry → inactive (matches client isAnonymousAccessExpired).
  return v_expires_at > now();
end;
$$;

revoke all on function public.anonymous_access_is_active(uuid) from public, anon;
grant execute on function public.anonymous_access_is_active(uuid) to authenticated, service_role;

comment on function public.anonymous_access_is_active(uuid) is
  'OTA-05: true for registered users; for anonymous, true only while anonymous_expires_at (or memberships.created_at+14d fallback) is still in the future.';

-- ============================================================
-- extensions.is_member — expiry-aware membership predicate
-- ============================================================

create or replace function extensions.is_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.memberships m
    where m.group_id = gid
      and m.user_id = (select auth.uid())
  )
  and public.anonymous_access_is_active((select auth.uid()));
$$;

revoke execute on function extensions.is_member(uuid) from public;
grant execute on function extensions.is_member(uuid) to authenticated;

comment on function extensions.is_member(uuid) is
  'True when auth.uid() has a memberships row for gid and (if anonymous) access has not expired.';

-- ============================================================
-- groups SELECT: creator bypass must not outlive anonymous expiry
-- ============================================================
-- Prior policy: is_member OR created_by. Expired anonymous creators still
-- matched created_by after is_member became false. Restrict creator path to
-- active access (registered always; anonymous only while unexpired).

drop policy if exists "groups: select if member or creator" on public.groups;
create policy "groups: select if member or creator"
  on public.groups for select to authenticated
  using (
    extensions.is_member(id)
    or (
      created_by = (select auth.uid())
      and public.anonymous_access_is_active((select auth.uid()))
    )
  );

-- Own location updates previously only checked user_id (membership not required).
-- Require active membership so expired anonymous users cannot keep writing.
drop policy if exists "member_locations: update own" on public.member_locations;
create policy "member_locations: update own"
  on public.member_locations for update to authenticated
  using (user_id = (select auth.uid()) and extensions.is_member(group_id))
  with check (user_id = (select auth.uid()) and extensions.is_member(group_id));

-- ============================================================
-- DEFINER RPCs that re-checked memberships without is_member
-- ============================================================

-- set_solo: previously updated any own membership row without expiry check.
create or replace function public.set_solo(p_group uuid, p_solo boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not extensions.is_member(p_group) then
    raise exception 'not a member of group %', p_group
      using errcode = '42501';
  end if;

  update public.memberships
     set solo = p_solo
   where group_id = p_group
     and user_id = (select auth.uid());
end;
$$;

revoke all on function public.set_solo(uuid, boolean) from public, anon;
grant execute on function public.set_solo(uuid, boolean) to authenticated;

-- self_split / self_merge (latest bodies from subgroup_itineraries) + active membership.
create or replace function public.self_split(p_group uuid, p_name text)
returns public.subgroups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  v_sub public.subgroups;
begin
  if not extensions.is_member(p_group) then
    raise exception 'not a member of group %', p_group;
  end if;

  select subgroup_id into v_parent
    from public.memberships
   where group_id = p_group
     and user_id = (select auth.uid());
  if not found then
    raise exception 'not a member of group %', p_group;
  end if;

  if v_parent is not null then
    raise exception 'already in a subgroup — nested splits are not allowed';
  end if;

  insert into public.subgroups (group_id, parent_subgroup_id, name, mode, leader_id)
  values (p_group, null, p_name, 'led', (select auth.uid()))
  returning * into v_sub;

  update public.memberships
     set subgroup_id = v_sub.id
   where group_id = p_group
     and user_id = (select auth.uid());

  return v_sub;
end;
$$;

create or replace function public.self_merge(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_parent uuid;
begin
  if not extensions.is_member(p_group) then
    raise exception 'not a member of group %', p_group;
  end if;

  select subgroup_id into v_current
    from public.memberships
   where group_id = p_group
     and user_id = (select auth.uid());
  if not found then
    raise exception 'not a member of group %', p_group;
  end if;

  if v_current is null then
    return;
  end if;

  select parent_subgroup_id into v_parent
    from public.subgroups
   where id = v_current;

  update public.memberships
     set subgroup_id = v_parent
   where group_id = p_group
     and user_id = (select auth.uid());

  delete from public.subgroups s
   where s.id = v_current
     and not exists (
       select 1 from public.memberships m where m.subgroup_id = s.id
     )
     and not exists (
       select 1 from public.subgroups c where c.parent_subgroup_id = s.id
     );
end;
$$;

revoke all on function public.self_split(uuid, text) from public, anon;
grant execute on function public.self_split(uuid, text) to authenticated;

revoke all on function public.self_merge(uuid) from public, anon;
grant execute on function public.self_merge(uuid) to authenticated;

-- get_trip_entitlement: use expiry-aware is_member for authz.
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

  perform public.expire_stale_entitlements(p_group_id);

  v_is_member := extensions.is_member(p_group_id);

  if not v_is_member then
    return json_build_object('ok', false, 'error', 'not_member');
  end if;

  v_member_count := public.group_member_count(p_group_id);
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

-- apply_core_operation: patch membership check to expiry-aware is_member without
-- re-embedding the full body (source may grow in later migrations).
do $patch$
declare
  def text;
  def2 text;
  oid regprocedure := 'public.apply_core_operation(uuid,uuid,text,text,integer,text,jsonb,timestamptz)'::regprocedure;
begin
  select pg_get_functiondef(oid) into def;

  if def is null or def = '' then
    raise notice 'apply_core_operation not found; skip membership patch';
    return;
  end if;

  if position('extensions.is_member(p_group_id)' in def) > 0
     and position('select exists' in def) = 0 then
    raise notice 'apply_core_operation already uses extensions.is_member';
    return;
  end if;

  -- Tolerate whitespace drift from catalog pretty-print.
  def2 := regexp_replace(
    def,
    'select\s+exists\s*\(\s*select\s+1\s+from\s+public\.memberships\s+m\s+where\s+m\.group_id\s*=\s*p_group_id\s+and\s+m\.user_id\s*=\s*v_uid\s*\)\s+into\s+v_is_member\s*;',
    'v_is_member := extensions.is_member(p_group_id);',
    'i'
  );

  if def2 = def then
    raise exception
      'apply_core_operation membership check pattern not found; update OTA-05 is_member patch';
  end if;

  -- Ensure replace form (pg_get_functiondef may emit CREATE or CREATE OR REPLACE).
  def2 := regexp_replace(def2, '^CREATE\s+FUNCTION', 'CREATE OR REPLACE FUNCTION', 'i');
  execute def2;
end;
$patch$;
