-- Align Live Activity entitlement with Premium projection rules.
-- Fixes: Premium active (promo lifetime / app_store with null-safe expiry)
-- still showed "unlock Live Activity" in Tools because
-- group_has_active_subscription_premium only matched source=app_store
-- AND expires_at > now() (null lifetime never matched).

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
    cross join lateral (
      select e.status, e.expires_at
        from public.personal_premium_entitlements e
       where e.user_id = m.user_id
         and e.source in ('app_store', 'promo')
         and e.status = 'active'
         and (e.expires_at is null or e.expires_at > now())
       order by
         case when e.expires_at is null then 0 else 1 end,
         coalesce(e.source_signed_at, e.updated_at) desc,
         e.updated_at desc
       limit 1
    ) e
    where m.group_id = p_group_id
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
  );
$$;

revoke all on function public.group_has_active_subscription_premium(uuid)
  from public, anon, authenticated;
grant execute on function public.group_has_active_subscription_premium(uuid)
  to service_role;

-- Team projection recomputation: same source/expiry rules as subscription check.
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
         and e.source in ('app_store', 'promo')
         and e.status = 'active'
         and (e.expires_at is null or e.expires_at > now())
       order by
         case when e.expires_at is null then 0 else 1 end,
         coalesce(e.source_signed_at, e.updated_at) desc,
         e.updated_at desc
       limit 1
    ) e
   where m.group_id = p_group_id
     and e.status = 'active'
     and (e.expires_at is null or e.expires_at > now());

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

-- Live Activity: personal lifetime product OR personal Premium OR group premium.
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

  -- Personal Premium (IAP or promo) grants Live Activity for the account.
  if exists(
    select 1
      from public.personal_premium_entitlements e
     where e.user_id = p_user_id
       and e.source in ('app_store', 'promo')
       and e.status = 'active'
       and (e.expires_at is null or e.expires_at > now())
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

comment on function public.group_has_active_subscription_premium(uuid) is
  'True when any group member has active app_store or promo personal Premium (lifetime null expiry allowed).';
comment on function public.effective_live_activity_entitlement(uuid, uuid) is
  'Personal LA lifetime, personal Premium, or group premium unlocks Live Activity.';

-- Set daily accommodation: free-plan point limit must not fail the whole upsert.
-- Auto-add of two stay cards can hit itinerary_point_limit (P0004) when near cap;
-- save the daily row and soft-skip auto-add instead of "操作失敗".
create or replace function extensions.set_daily_accommodation_with_auto_add(
  p_group_id uuid,
  p_stay_date date,
  p_title text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_source_destination_id uuid default null,
  p_day int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_leader boolean;
  v_auto_add boolean;
  v_previous_exists boolean;
  v_row public.daily_accommodations%rowtype;
  v_day int;
  v_min_pos int;
  v_max_pos int;
  v_first_id uuid;
  v_last_id uuid;
  v_auto_added boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if not extensions.is_member(p_group_id) then
    raise exception 'not_leader';
  end if;

  select exists(
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
      and m.role = 'leader'
  ) into v_is_leader;

  if not v_is_leader then
    raise exception 'not_leader';
  end if;

  select coalesce(g.accommodation_auto_add, true)
    into v_auto_add
  from public.groups g
  where g.id = p_group_id
  for update;

  if not found then
    raise exception 'group_not_found';
  end if;

  select exists(
    select 1 from public.daily_accommodations d
    where d.group_id = p_group_id and d.stay_date = p_stay_date
  ) into v_previous_exists;

  insert into public.daily_accommodations as d (
    group_id, stay_date, title, address, latitude, longitude,
    source_destination_id, created_by, updated_at
  ) values (
    p_group_id, p_stay_date, p_title, p_address, p_latitude, p_longitude,
    p_source_destination_id, v_uid, now()
  )
  on conflict (group_id, stay_date) do update set
    title = excluded.title,
    address = excluded.address,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    source_destination_id = excluded.source_destination_id,
    updated_at = now()
  returning * into v_row;

  v_day := coalesce(p_day, 1);

  if v_previous_exists then
    update public.itinerary_items i
      set stay_anchor = false
    where i.group_id = p_group_id
      and i.subgroup_id is null
      and coalesce(i.day, 1) = v_day
      and i.kind = 'accommodation'
      and i.stay_anchor = true;
  end if;

  if (not v_previous_exists) and v_auto_add then
    begin
      select coalesce(min(i.position), 0), coalesce(max(i.position), -1)
        into v_min_pos, v_max_pos
      from public.itinerary_items i
      where i.group_id = p_group_id
        and i.subgroup_id is null
        and coalesce(i.day, 1) = v_day;

      update public.itinerary_items i
        set position = i.position + 1
      where i.group_id = p_group_id
        and i.subgroup_id is null
        and i.position >= v_min_pos;

      insert into public.itinerary_items (
        group_id, title, address, latitude, longitude, position, day, kind, stay_anchor
      ) values (
        p_group_id, p_title, p_address, p_latitude, p_longitude, v_min_pos, v_day, 'accommodation', true
      ) returning id into v_first_id;

      select coalesce(max(i.position), v_min_pos)
        into v_max_pos
      from public.itinerary_items i
      where i.group_id = p_group_id
        and i.subgroup_id is null
        and coalesce(i.day, 1) = v_day;

      update public.itinerary_items i
        set position = i.position + 1
      where i.group_id = p_group_id
        and i.subgroup_id is null
        and i.position > v_max_pos;

      insert into public.itinerary_items (
        group_id, title, address, latitude, longitude, position, day, kind, stay_anchor
      ) values (
        p_group_id, p_title, p_address, p_latitude, p_longitude, v_max_pos + 1, v_day, 'accommodation', true
      ) returning id into v_last_id;

      v_auto_added := true;
    exception
      when sqlstate 'P0004' then
        -- Free-plan open-point cap: keep daily row, skip auto-add cards.
        v_first_id := null;
        v_last_id := null;
        v_auto_added := false;
    end;
  end if;

  return jsonb_build_object(
    'daily', to_jsonb(v_row),
    'auto_added', v_auto_added,
    'first_card_id', v_first_id,
    'last_card_id', v_last_id
  );
end;
$$;
