-- Security scan #285: serialize promo use, revoke invite access, bound imports,
-- restrict leader commands, and require live membership for arrival projections.
-- NOT VALID preserves legacy negative counters without allowing new negatives.
alter table public.promo_codes add constraint promo_codes_remaining_uses_nonnegative
  check (remaining_uses is null or remaining_uses >= 0) not valid;


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
  where code = upper(trim(p_code)) for update;
  if not found then
    select * into v_promo from public.promo_codes where code = trim(p_code) for update;
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

-- create_group already creates its leader membership in the same transaction.
-- Historical created_by is provenance, never ongoing authorization.
drop policy if exists "groups: select if member or creator" on public.groups;
create policy "groups: select if member" on public.groups for select to authenticated
  using (extensions.is_member(id));

-- All leave/kick/account-cleanup paths revoke the old shared join capability.
create or replace function public.rotate_invite_after_membership_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
begin
  for v_attempt in 1..8 loop
    v_bytes := extensions.gen_random_bytes(6);
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_chars, 1 + (get_byte(v_bytes, i) % 32), 1);
    end loop;
    begin
      update public.groups set invite_code = v_code
      where id = old.group_id and invite_code <> v_code;
      if found or not exists (select 1 from public.groups where id = old.group_id) then
        return old;
      end if;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'invite code collision' using errcode = '23505';
end;
$$;
revoke all on function public.rotate_invite_after_membership_delete() from public, anon, authenticated;
create trigger memberships_revoke_invite_after_delete after delete on public.memberships
  for each row execute function public.rotate_invite_after_membership_delete();


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
  v_first_joined timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- (1) Anonymous expiry (profile column, with membership.created_at fallback).
  if public.is_auth_user_anonymous(v_uid) then
    select p.anonymous_expires_at into v_expires_at
    from public.profiles p
    where p.id = v_uid;

    if v_expires_at is null then
      select min(m.created_at) into v_first_joined
      from public.memberships m
      where m.user_id = v_uid;
      if v_first_joined is not null then
        v_expires_at := v_first_joined + interval '14 days';
      end if;
    end if;

    if v_expires_at is not null and v_expires_at <= now() then
      raise exception 'anonymous access expired'
        using errcode = 'P0401';
    end if;
  end if;

  select * into g from public.groups where invite_code = upper(p_code) limit 1 for update;
  if not found then
    raise exception 'group not found for code %', p_code using errcode = 'P0002';
  end if;

  if exists(
    select 1 from public.memberships
    where group_id = g.id and user_id = v_uid
  ) then
    return g;
  end if;

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

    -- (2) OTA-05: anonymous Leader must register before the 6th member.
    if public.is_auth_user_anonymous(v_leader_id) then
      raise exception 'leader registration required before adding member 6'
        using errcode = 'P0406';
    end if;

    -- (3) OTA-08 Free Plan hard cap for registered Leaders.
    raise exception 'member_limit'
      using errcode = 'P0003',
            detail = 'Free plan allows at most 5 members including the leader';
  end if;

  insert into public.memberships (group_id, user_id, role, status)
  values (g.id, v_uid, 'follower', 'active')
  on conflict (group_id, user_id) do nothing;

  -- (4) Stamp first-join anonymous expiry.
  perform public.ensure_anonymous_expiry(v_uid);

  return g;
end;
$$;

create or replace function public.kick_group_member(p_group_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_target_role text;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_group_id is null or p_user_id is null then
    raise exception 'group and user required' using errcode = '22023';
  end if;
  if p_user_id = v_caller then
    raise exception 'cannot kick self' using errcode = '22023';
  end if;

  -- Expiry-aware membership first (anonymous 14-day gate via is_member).
  if not extensions.is_member(p_group_id) then
    raise exception 'not a group member' using errcode = '42501';
  end if;

  -- Caller must be active leader of this group.
  if not exists (
    select 1
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_caller
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  select m.role into v_target_role
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = p_user_id
  for update;

  if not found then
    raise exception 'target membership not found' using errcode = 'P0002';
  end if;
  if v_target_role = 'leader' then
    raise exception 'cannot kick leader' using errcode = '22023';
  end if;

  delete from public.memberships
  where group_id = p_group_id
    and user_id = p_user_id;

  -- The membership DELETE trigger rotates once for every revocation path.
  return (select invite_code from public.groups where id = p_group_id);
end;
$$;

alter table public.account_import_quotas
  add column rate_window_started_at timestamptz not null default now(),
  add column rate_window_count integer not null default 0 check (rate_window_count between 0 and 1000);


create or replace function public.import_itinerary_batch(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_day integer,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_day integer := p_day;
  v_count integer;
  v_insert_pos integer;
  v_item jsonb;
  v_idx integer := 0;
  v_title text;
  v_lat double precision;
  v_lng double precision;
  v_is_premium boolean := false;
  v_quota_used integer;
  v_rate_started timestamptz;
  v_rate_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_subgroup_id is not null and not exists (
    select 1 from public.subgroups s
    where s.id = p_subgroup_id and s.group_id = p_group_id
  ) then
    raise exception 'subgroup does not belong to group' using errcode = '22023';
  end if;
  if not public.can_manage_itinerary_scope(p_group_id, p_subgroup_id, v_uid) then
    raise exception 'scope leader membership required' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid import batch' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 100 or octet_length(p_items::text) > 1048576 then
    raise exception 'import batch limit exceeded' using errcode = '22023';
  end if;
  if v_count = 0 then return 0; end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_title := nullif(trim(coalesce(v_item->>'title', '')), '');
    if v_title is null or length(v_title) > 512
      or length(coalesce(v_item->>'address', '')) > 2048 then
      raise exception 'invalid import item title' using errcode = '22023';
    end if;
    begin
      v_lat := (v_item->>'latitude')::double precision;
      v_lng := (v_item->>'longitude')::double precision;
    exception when others then
      raise exception 'invalid import item coordinates' using errcode = '22023';
    end;
    if v_lat is null or v_lng is null
      or v_lat < -90 or v_lat > 90
      or v_lng < -180 or v_lng > 180 then
      raise exception 'invalid import item coordinates' using errcode = '22023';
    end if;
  end loop;

  -- This lock serializes quota consumption for the account. The group lock
  -- below separately serializes itinerary positions.
  insert into public.account_import_quotas (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;
  select q.used_count, q.rate_window_started_at, q.rate_window_count
  into v_quota_used, v_rate_started, v_rate_count
  from public.account_import_quotas q
  where q.user_id = v_uid
  for update;

  if v_rate_started <= v_now - interval '1 hour' then
    v_rate_started := v_now;
    v_rate_count := 0;
  end if;
  if v_rate_count + v_count > 1000 then
    raise exception 'import rate limit exceeded' using errcode = 'P0004';
  end if;

  v_is_premium := public.profile_has_lifetime_premium(v_uid)
    or exists (
      select 1
      from public.personal_premium_entitlements e
      where e.user_id = v_uid
        and public.personal_premium_is_live(e.status, e.expires_at)
    )
    or public.group_has_active_premium(p_group_id);
  if not v_is_premium and v_quota_used + v_count > 5 then
    raise exception 'kml import quota exceeded' using errcode = 'P0004';
  end if;

  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  if (select count(*) from public.itinerary_items where group_id = p_group_id) + v_count > 1000 then
    raise exception 'group import limit exceeded' using errcode = 'P0004';
  end if;

  select coalesce(max(i.position), -1) + 1 into v_insert_pos
  from public.itinerary_items i
  where i.group_id = p_group_id
    and ((p_subgroup_id is null and i.subgroup_id is null) or i.subgroup_id = p_subgroup_id)
    and i.day is not distinct from v_day;
  if not exists (
    select 1 from public.itinerary_items i
    where i.group_id = p_group_id
      and ((p_subgroup_id is null and i.subgroup_id is null) or i.subgroup_id = p_subgroup_id)
      and i.day is not distinct from v_day
  ) then
    select coalesce(max(i.position), -1) + 1 into v_insert_pos
    from public.itinerary_items i
    where i.group_id = p_group_id
      and ((p_subgroup_id is null and i.subgroup_id is null) or i.subgroup_id = p_subgroup_id)
      and coalesce(i.day, 0) < coalesce(v_day, 0);
  end if;
  v_insert_pos := coalesce(v_insert_pos, 0);

  update public.itinerary_items i
  set position = i.position + v_count
  where i.group_id = p_group_id
    and ((p_subgroup_id is null and i.subgroup_id is null) or i.subgroup_id = p_subgroup_id)
    and i.position >= v_insert_pos;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.itinerary_items (
      group_id, subgroup_id, title, address, day, latitude, longitude, position
    ) values (
      p_group_id, p_subgroup_id,
      nullif(trim(coalesce(v_item->>'title', '')), ''),
      nullif(trim(coalesce(v_item->>'address', '')), ''),
      v_day,
      (v_item->>'latitude')::double precision,
      (v_item->>'longitude')::double precision,
      v_insert_pos + v_idx
    );
    v_idx := v_idx + 1;
  end loop;

  if not v_is_premium then
    update public.account_import_quotas
    set used_count = used_count + v_count, updated_at = now()
    where user_id = v_uid;
  end if;
  update public.account_import_quotas
  set rate_window_started_at = v_rate_started, rate_window_count = v_rate_count + v_count
  where user_id = v_uid;
  return v_count;
end;
$$;

-- Requests and role-dependent custom messages remain available to followers.
drop policy if exists "commands: insert own if member" on public.commands;
create policy "commands: insert own if authorized" on public.commands
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and extensions.is_member(group_id)
    and (type in ('need_restroom','need_break','need_help','found_something','request_start','custom')
      or exists (select 1 from public.memberships m where m.group_id = commands.group_id
        and m.user_id = (select auth.uid()) and m.role = 'leader'))
  );


-- Extend the effective v3 body in place, retaining later daily-accommodation
-- branches and their completion validation added by 20261001115316.
do $migration$
declare
  definition text;
  anchor text := $anchor$  select exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = v_uid
  ) into v_is_member;
  if not v_is_member and p_operation_type <> 'record_arrival' then$anchor$;
begin
  definition := replace(pg_get_functiondef(
    'public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamptz)'::regprocedure
  ), E'\r\n', E'\n');
  anchor := replace(anchor, E'\r\n', E'\n');
  if strpos(definition, anchor) = 0 then raise exception 'v3 membership anchor missing'; end if;
  execute replace(definition, anchor, $replacement$  -- Keep current-member offline arrivals, including closed-session uploads.
  -- Hold membership through the write so revocation cannot pass this check.
  perform 1 from public.memberships m
  where m.group_id = p_group_id and m.user_id = v_uid for key share;
  v_is_member := found and public.anonymous_access_is_active(v_uid);
  if not v_is_member then$replacement$);
end;
$migration$;
