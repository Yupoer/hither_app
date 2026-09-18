-- NULL day is an unscheduled place. Existing days and RPC grants are preserved.
-- Deploy only with the compatible client; old clients coalesce NULL to day 1.
begin;
alter table public.itinerary_items alter column day drop not null;
alter table public.itinerary_items add constraint itinerary_valid_scheduled_day
  check (day is null or day >= 1);
alter table public.itinerary_items add constraint itinerary_accommodation_scheduled
  check (kind <> 'accommodation' or day is not null);

-- Pool records retain identity/permissions but cannot participate in navigation.
create or replace function public.guard_itinerary_pool()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.day is null then
    if exists (select 1 from public.navigation_sessions s
      where s.destination_id = new.id and s.status = 'active') then
      raise exception 'end navigation before unscheduling' using errcode = '22023';
    end if;
    if new.closed_at is not null then
      raise exception 'cannot unschedule a closed destination' using errcode = '22023';
    end if;
    new.meet_at := null;
    new.stay_anchor := false;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_itinerary_pool() from public, anon, authenticated;
create trigger aa_guard_itinerary_pool before insert or update on public.itinerary_items
  for each row execute function public.guard_itinerary_pool();

create or replace function public.guard_pool_arrival()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.itinerary_items i where i.id = new.destination_id and i.day is null) then
    raise exception 'unscheduled destination cannot be arrived' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_pool_arrival() from public, anon, authenticated;
create trigger aa_guard_pool_arrival before insert or update on public.destination_arrivals
  for each row execute function public.guard_pool_arrival();
create or replace function public.add_itinerary_item(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_title text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_day integer default 1,
  p_kind text default 'stop',
  p_stay_anchor boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_day integer := p_day;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_kind text := coalesce(p_kind, 'stop');
  v_insert_pos integer;
  v_tail_pos integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if v_title is null then
    raise exception 'invalid itinerary title' using errcode = '22023';
  end if;

  if v_kind not in ('stop', 'accommodation') then
    raise exception 'invalid itinerary kind' using errcode = '22023';
  end if;

  if p_latitude is null or p_longitude is null
    or p_latitude < -90 or p_latitude > 90
    or p_longitude < -180 or p_longitude > 180
  then
    raise exception 'invalid itinerary coordinates' using errcode = '22023';
  end if;

  if p_subgroup_id is not null and not exists (
    select 1 from public.subgroups s
    where s.id = p_subgroup_id
      and s.group_id = p_group_id
  ) then
    raise exception 'subgroup does not belong to group' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
      and (
        m.role = 'leader'
        or (
          p_subgroup_id is not null
          and m.subgroup_id = p_subgroup_id
        )
      )
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  select coalesce(max(i.position), -1) + 1 into v_insert_pos
  from public.itinerary_items i
  where i.group_id = p_group_id
    and (
      (p_subgroup_id is null and i.subgroup_id is null)
      or i.subgroup_id = p_subgroup_id
    )
    and i.day is not distinct from v_day;

  if v_insert_pos is null then
    v_insert_pos := 0;
  end if;

  if not exists (
    select 1 from public.itinerary_items i
    where i.group_id = p_group_id
      and (
        (p_subgroup_id is null and i.subgroup_id is null)
        or i.subgroup_id = p_subgroup_id
      )
      and i.day is not distinct from v_day
  ) then
    select coalesce(max(i.position), -1) + 1 into v_insert_pos
    from public.itinerary_items i
    where i.group_id = p_group_id
      and (
        (p_subgroup_id is null and i.subgroup_id is null)
        or i.subgroup_id = p_subgroup_id
      )
      and coalesce(i.day, 0) < coalesce(v_day, 0);
    if v_insert_pos is null then
      v_insert_pos := 0;
    end if;
  end if;

  if v_kind = 'accommodation' then
    select tail.position into v_tail_pos
    from (
      select i.position, i.kind, i.stay_anchor
      from public.itinerary_items i
      where i.group_id = p_group_id
        and (
          (p_subgroup_id is null and i.subgroup_id is null)
          or i.subgroup_id = p_subgroup_id
        )
        and i.day is not distinct from v_day
      order by i.position desc
      limit 1
    ) tail
    where tail.kind = 'accommodation'
      and tail.stay_anchor;

    if found then
      v_insert_pos := v_tail_pos;
    end if;
  end if;

  update public.itinerary_items i
  set position = i.position + 1
  where i.group_id = p_group_id
    and (
      (p_subgroup_id is null and i.subgroup_id is null)
      or i.subgroup_id = p_subgroup_id
    )
    and i.position >= v_insert_pos;

  insert into public.itinerary_items (
    group_id,
    subgroup_id,
    title,
    address,
    day,
    latitude,
    longitude,
    position,
    kind,
    stay_anchor
  ) values (
    p_group_id,
    p_subgroup_id,
    v_title,
    nullif(trim(coalesce(p_address, '')), ''),
    v_day,
    p_latitude,
    p_longitude,
    v_insert_pos,
    v_kind,
    case when v_kind = 'accommodation' then coalesce(p_stay_anchor, false) else false end
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.reorder_itinerary_items(
  p_group_id uuid,
  p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_leader boolean := false;
  v_member_subgroup uuid;
  v_input_count integer;
  v_id uuid;
  v_day integer;
  v_meet_at text;
  v_has_meet boolean;
  v_stay_anchor boolean;
  v_has_stay_anchor boolean;
  v_ids uuid[] := array[]::uuid[];
  v_days integer[] := array[]::integer[];
  v_has_meets boolean[] := array[]::boolean[];
  v_meets text[] := array[]::text[];
  v_has_stay_anchors boolean[] := array[]::boolean[];
  v_stay_anchors boolean[] := array[]::boolean[];
  v_slots integer[] := array[]::integer[];
  v_found integer;
  v_closed integer;
  v_unauthorized integer;
  v_item jsonb;
  v_idx integer;
  v_updated integer := 0;
  v_row_count integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select
    exists (
      select 1 from public.memberships m
      where m.group_id = p_group_id
        and m.user_id = v_uid
        and m.role = 'leader'
    ),
    (
      select m.subgroup_id from public.memberships m
      where m.group_id = p_group_id
        and m.user_id = v_uid
      limit 1
    )
  into v_is_leader, v_member_subgroup;

  if not v_is_leader and not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
  ) then
    raise exception 'membership required' using errcode = '42501';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'invalid reorder batch' using errcode = '22023';
  end if;

  v_input_count := jsonb_array_length(p_updates);
  if v_input_count = 0 then
    return 0;
  end if;

  for v_item in select * from jsonb_array_elements(p_updates)
  loop
    begin
      v_id := (v_item->>'id')::uuid;
      v_day := case when v_item ? 'day' then (v_item->>'day')::integer else 1 end;
    exception when others then
      raise exception 'invalid reorder item' using errcode = '22023';
    end;

    if v_id is null then
      raise exception 'invalid reorder item' using errcode = '22023';
    end if;

    if v_id = any (v_ids) then
      raise exception 'duplicate reorder id' using errcode = '22023';
    end if;

    v_has_meet := v_item ? 'meet_at';
    v_meet_at := v_item->>'meet_at';
    v_has_stay_anchor := v_item ? 'stay_anchor';
    v_stay_anchor := coalesce((v_item->>'stay_anchor')::boolean, false);

    v_ids := array_append(v_ids, v_id);
    v_days := array_append(v_days, v_day);
    v_has_meets := array_append(v_has_meets, v_has_meet);
    v_meets := array_append(v_meets, v_meet_at);
    v_has_stay_anchors := array_append(v_has_stay_anchors, v_has_stay_anchor);
    v_stay_anchors := array_append(v_stay_anchors, v_stay_anchor);
  end loop;

  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  select count(*)::integer into v_found
  from public.itinerary_items i
  where i.group_id = p_group_id
    and i.id = any (v_ids);

  if v_found <> v_input_count then
    raise exception 'reorder ids missing or out of scope' using errcode = '22023';
  end if;

  select count(*)::integer into v_closed
  from public.itinerary_items i
  where i.group_id = p_group_id
    and i.id = any (v_ids)
    and i.closed_at is not null;

  if v_closed > 0 then
    raise exception 'cannot reorder closed itinerary items' using errcode = '22023';
  end if;

  if not v_is_leader then
    select count(*)::integer into v_unauthorized
    from public.itinerary_items i
    where i.group_id = p_group_id
      and i.id = any (v_ids)
      and (
        i.subgroup_id is null
        or v_member_subgroup is null
        or i.subgroup_id is distinct from v_member_subgroup
      );

    if v_unauthorized > 0 then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  end if;

  select coalesce(array_agg(i.position order by i.position), array[]::integer[])
  into v_slots
  from public.itinerary_items i
  where i.group_id = p_group_id
    and i.id = any (v_ids);

  if coalesce(array_length(v_slots, 1), 0) <> v_input_count then
    raise exception 'reorder slot mismatch' using errcode = '22023';
  end if;

  for v_idx in 1 .. v_input_count
  loop
    if v_has_meets[v_idx] then
      update public.itinerary_items i
      set position = v_slots[v_idx],
          day = v_days[v_idx],
          meet_at = case
            when v_meets[v_idx] is null or v_meets[v_idx] = '' then null
            else (v_meets[v_idx])::timestamptz
          end,
          stay_anchor = case
            when v_has_stay_anchors[v_idx] then v_stay_anchors[v_idx]
            else i.stay_anchor
          end
      where i.id = v_ids[v_idx]
        and i.group_id = p_group_id;
    else
      update public.itinerary_items i
      set position = v_slots[v_idx],
          day = v_days[v_idx],
          stay_anchor = case
            when v_has_stay_anchors[v_idx] then v_stay_anchors[v_idx]
            else i.stay_anchor
          end
      where i.id = v_ids[v_idx]
        and i.group_id = p_group_id;
    end if;

    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then
      raise exception 'reorder update failed' using errcode = '40001';
    end if;
    v_updated := v_updated + 1;
  end loop;

  if v_updated <> v_input_count then
    raise exception 'reorder incomplete' using errcode = '40001';
  end if;

  return v_updated;
end;
$$;

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
  if v_count = 0 then return 0; end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_title := nullif(trim(coalesce(v_item->>'title', '')), '');
    if v_title is null then
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
  select q.used_count into v_quota_used
  from public.account_import_quotas q
  where q.user_id = v_uid
  for update;

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
  return v_count;
end;
$$;

create or replace function public.resolve_gather_point_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.gather_point_requests;
  v_item jsonb;
  v_position integer;
  v_inserted integer := 0;
begin
  select * into v_request from public.gather_point_requests r where r.id = p_request_id for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then raise exception 'request already resolved' using errcode = '23505'; end if;
  if not public.can_manage_itinerary_scope(v_request.group_id, v_request.subgroup_id) then
    raise exception 'scope leader membership required' using errcode = '42501';
  end if;
  if p_approve then
    perform 1 from public.groups g where g.id = v_request.group_id for update;
    if not found then raise exception 'group not found' using errcode = 'P0002'; end if;
    select coalesce(max(i.position), -1) into v_position
    from public.itinerary_items i
    where i.group_id = v_request.group_id
      and i.subgroup_id is not distinct from v_request.subgroup_id;
    for v_item in select value from jsonb_array_elements(v_request.items)
    loop
      v_position := v_position + 1;
      insert into public.itinerary_items(
        group_id, subgroup_id, title, address, day, latitude, longitude, position, created_by
      ) values (
        v_request.group_id, v_request.subgroup_id, btrim(v_item->>'title'),
        nullif(v_item->>'address', ''), null,
        (v_item->>'latitude')::double precision, (v_item->>'longitude')::double precision,
        v_position, (select auth.uid())
      );
      v_inserted := v_inserted + 1;
    end loop;
  end if;
  update public.gather_point_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_request_id;
  return jsonb_build_object(
    'status', case when p_approve then 'approved' else 'rejected' end,
    'inserted_count', v_inserted
  );
end;
$$;

create or replace function public.promote_navigation_destination()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_target public.itinerary_items;
  v_updates jsonb;
begin
  if new.status <> 'active' then return new; end if;
  perform 1 from public.groups where id = new.group_id for update;
  select * into v_target from public.itinerary_items
    where id = new.destination_id and group_id = new.group_id;
  if not found or v_target.closed_at is not null or v_target.day is null then
    raise exception 'navigation destination missing or closed' using errcode = '22023';
  end if;
  if exists (select 1 from public.itinerary_items i
    where i.group_id = new.group_id and i.subgroup_id is not distinct from v_target.subgroup_id
      and i.day = v_target.day and i.closed_at is null
      and i.position < v_target.position) then
    select jsonb_agg(jsonb_build_object('id', i.id, 'day', coalesce(i.day, 1), 'position', i.position)
      order by (i.id = v_target.id) desc, i.position, i.id)
    into v_updates from public.itinerary_items i
    where i.group_id = new.group_id and i.subgroup_id is not distinct from v_target.subgroup_id
      and i.day = v_target.day and i.closed_at is null;
    perform public.reorder_itinerary_items(new.group_id, v_updates);
  end if;
  return new;
end;
$$;

create or replace function public.set_destination_arrival(
  p_destination_id uuid,
  p_target_user_id uuid,
  p_arrived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destination public.itinerary_items;
  v_target_subgroup uuid;
  v_active_destination uuid;
  v_journey_status text;
  v_session_id uuid;
  v_departure date;
  v_trip_days integer;
  v_current_day integer;
begin
  select * into v_destination from public.itinerary_items where id = p_destination_id;
  if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;

  if p_target_user_id is distinct from (select auth.uid())
     and not public.can_manage_itinerary_scope(
       v_destination.group_id, v_destination.subgroup_id
     ) then
    raise exception 'cannot mark this member' using errcode = '42501';
  end if;

  select m.subgroup_id into v_target_subgroup from public.memberships m
  where m.group_id = v_destination.group_id and m.user_id = p_target_user_id;
  if not found or v_target_subgroup is distinct from v_destination.subgroup_id then
    raise exception 'destination outside member scope' using errcode = '42501';
  end if;

  select g.active_destination_id, g.journey_status, g.departure_date, g.trip_days
  into v_active_destination, v_journey_status, v_departure, v_trip_days
  from public.groups g where g.id = v_destination.group_id;
  if v_journey_status = 'paused' and not p_arrived and not exists (
    select 1 from public.destination_arrivals a
    where a.destination_id = p_destination_id
  ) then
    raise exception 'paused destination requires an existing arrival' using errcode = '22023';
  end if;

  if v_departure is not null and v_trip_days is not null and v_trip_days > 0 then
    v_current_day := (current_date - v_departure) + 1;
  else
    v_current_day := null;
  end if;

  -- A confirmed active navigation target is markable even before reordered rows reach clients.
  -- Scope/auth checks above still apply; ordinary future stops retain sequential rules.
  if p_arrived and not exists (
    select 1 from public.navigation_sessions s
    where s.group_id = v_destination.group_id and s.destination_id = p_destination_id
      and s.status = 'active' and s.expires_at > now()
  ) and exists (
    select 1
    from public.itinerary_items i
    where i.group_id = v_destination.group_id
      and i.subgroup_id is not distinct from v_destination.subgroup_id
      and i.position < v_destination.position
      and i.closed_at is null and i.day is not null
      and not exists (
        select 1 from public.destination_arrivals a
        where a.destination_id = i.id and a.user_id = p_target_user_id
      )
      and (
        v_current_day is null
        or v_current_day <= 0
        or (
          v_current_day <= v_trip_days
          and coalesce(i.day, 1) >= v_current_day
        )
      )
  ) then
    raise exception 'future destination cannot be completed' using errcode = '22023';
  end if;

  if p_arrived then
    perform public.record_destination_arrival(
      v_destination.group_id, p_destination_id, p_target_user_id,
      'manual', (select auth.uid())
    );
    if v_active_destination = p_destination_id then
      update public.memberships set status = 'arrived'
      where group_id = v_destination.group_id and user_id = p_target_user_id;
    end if;
    select s.id into v_session_id
    from public.navigation_sessions s
    where s.destination_id = p_destination_id
      and s.group_id = v_destination.group_id
      and s.status in ('active', 'completed')
    order by s.started_at desc
    limit 1;
    if v_session_id is not null then
      update public.navigation_member_states
      set local_status = 'arrived', arrived_at = coalesce(arrived_at, now()),
          acknowledged_at = coalesce(acknowledged_at, now()), updated_at = now()
      where navigation_session_id = v_session_id and user_id = p_target_user_id;
    end if;
  else
    delete from public.destination_arrivals
    where destination_id = p_destination_id and user_id = p_target_user_id;
    if v_active_destination = p_destination_id then
      update public.memberships set status = 'active'
      where group_id = v_destination.group_id and user_id = p_target_user_id;
    end if;
    select s.id into v_session_id
    from public.navigation_sessions s
    where s.destination_id = p_destination_id
      and s.group_id = v_destination.group_id
      and s.status in ('active', 'completed')
    order by s.started_at desc
    limit 1;
    if v_session_id is not null then
      update public.navigation_member_states
      set local_status = case when v_destination.closed_at is null then 'pending' else 'missed' end,
          updated_at = now()
      where navigation_session_id = v_session_id and user_id = p_target_user_id;
    end if;
  end if;
end;
$$;

create or replace function public.complete_gathering_stop(
  p_group_id uuid,
  p_destination_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.itinerary_items;
  v_cancelled integer := 0;
  v_uid uuid := (select auth.uid());
  v_closed_at timestamptz;
  v_member record;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_item from public.itinerary_items i
  where i.id = p_destination_id and i.group_id = p_group_id for update;
  if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;
  if not public.can_manage_itinerary_scope(p_group_id, v_item.subgroup_id, v_uid)
    and not (
      exists (select 1 from public.memberships caller where caller.group_id = p_group_id
        and caller.user_id = v_uid and caller.subgroup_id is not distinct from v_item.subgroup_id)
      and exists (select 1 from public.memberships m where m.group_id = p_group_id
        and m.subgroup_id is not distinct from v_item.subgroup_id)
      and not exists (
        select 1 from public.memberships m where m.group_id = p_group_id
          and m.subgroup_id is not distinct from v_item.subgroup_id
          and not exists (select 1 from public.destination_arrivals a
            where a.destination_id = p_destination_id and a.user_id = m.user_id)
      )
    ) then
    raise exception 'scope leader membership required' using errcode = '42501';
  end if;
  if v_item.day is null then raise exception 'unscheduled destination' using errcode = '22023'; end if;
  if v_item.closed_at is not null then return; end if;
  update public.itinerary_items set closed_at = coalesce(closed_at, now())
  where id = p_destination_id and group_id = p_group_id returning closed_at into v_closed_at;
  update public.navigation_sessions s
  set status = 'completed', ended_at = now(), version = s.version + 1, updated_at = now()
  where s.group_id = p_group_id and s.destination_id = p_destination_id and s.status = 'active';
  get diagnostics v_cancelled = row_count;
  if v_cancelled > 0 or exists (
    select 1 from public.groups g where g.id = p_group_id and g.active_destination_id = p_destination_id
  ) then
    update public.groups g
    set journey_status = 'paused', active_destination_id = null, journey_started_at = null
    where g.id = p_group_id;
  end if;
  insert into public.visited_waypoints (
    user_id, group_id, destination_id, arrival_id, name, latitude, longitude, arrived_at
  )
  select m.user_id, p_group_id, p_destination_id, a.id,
    coalesce(v_item.title, '集合點'), coalesce(v_item.latitude, 0), coalesce(v_item.longitude, 0),
    coalesce(a.arrived_at, v_closed_at, now())
  from public.memberships m
  left join public.destination_arrivals a
    on a.destination_id = p_destination_id and a.user_id = m.user_id
  where m.group_id = p_group_id
    and m.subgroup_id is not distinct from v_item.subgroup_id
  on conflict (group_id, destination_id, user_id)
    where destination_id is not null and group_id is not null
  do update set name = excluded.name, latitude = excluded.latitude, longitude = excluded.longitude,
    arrival_id = coalesce(public.visited_waypoints.arrival_id, excluded.arrival_id);
  for v_member in select m.user_id from public.memberships m
    where m.group_id = p_group_id and m.user_id is distinct from v_uid
      and m.subgroup_id is not distinct from v_item.subgroup_id
      and not exists (select 1 from public.destination_arrivals a
        where a.destination_id = p_destination_id and a.user_id = m.user_id)
  loop
    begin
      perform extensions.notify_push(jsonb_build_object(
        'category', 'journey', 'group_id', p_group_id, 'sender_id', v_uid,
        'target_user_id', v_member.user_id, 'destination_id', p_destination_id,
        'status', 'gathering_completed', 'title', v_item.title,
        'message', '隊長已完成此卡片，將前往下一個集合點'
      ));
    exception when others then null;
    end;
  end loop;
  begin
    perform extensions.notify_push(jsonb_build_object(
      'category', 'journey', 'group_id', p_group_id, 'sender_id', v_uid,
      'target_user_id', v_uid, 'destination_id', p_destination_id,
      'status', 'gathering_completed', 'title', v_item.title, 'message', '集合點已完成'
    ));
  exception when others then null;
  end;
end;
$$;

create or replace function public.on_itinerary_meet_at_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid;
begin
  if new.day is null then return new; end if;
  if new.meet_at is not distinct from old.meet_at
     and new.meet_red_minutes is not distinct from old.meet_red_minutes then
    return new;
  end if;

  -- Reset scheduled-push flags whenever the target time or red threshold changes.
  if new.meet_at is distinct from old.meet_at
     or new.meet_red_minutes is distinct from old.meet_red_minutes then
    new.meet_warn_pushed_at := null;
    new.meet_due_pushed_at := null;
  end if;

  -- Only announce set/clear when the absolute meet clock changes.
  if new.meet_at is distinct from old.meet_at then
    v_sender := coalesce(auth.uid(), new.meet_set_by, new.created_by);
    if new.meet_at is not null then
      new.meet_set_by := coalesce(auth.uid(), new.meet_set_by);
      if v_sender is not null then
        perform extensions.notify_push(jsonb_build_object(
          'category', 'meet_time_set',
          'group_id', new.group_id,
          'sender_id', v_sender,
          'destination_id', new.id,
          'title', new.title,
          'meet_at', new.meet_at,
          'minutes', new.meet_red_minutes
        ));
      end if;
    elsif old.meet_at is not null and v_sender is not null then
      perform extensions.notify_push(jsonb_build_object(
        'category', 'meet_time_cleared',
        'group_id', new.group_id,
        'sender_id', v_sender,
        'destination_id', new.id,
        'title', new.title
      ));
    end if;
  end if;

  return new;
end;
$$;
create or replace function public.apply_core_operation(
  p_operation_id uuid,
  p_group_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_entity_version integer,
  p_operation_type text,
  p_payload jsonb,
  p_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.core_operations%rowtype;
  v_row public.core_entity_versions%rowtype;
  v_server_version integer;
  v_next_version integer;
  v_result jsonb;
  v_state jsonb;
  v_is_member boolean;
  v_is_leader boolean;
  v_phase text;
  v_active text;
  v_point_statuses jsonb;
  v_next text;
  v_client_next text;
  v_legal_next text;
  v_item public.itinerary_items%rowtype;
  v_point_status text;
  v_uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_operation_id is null or p_group_id is null
     or p_entity_type is null or p_entity_id is null
     or p_entity_version is null or p_operation_type is null then
    raise exception 'invalid apply_core_operation arguments' using errcode = '22023';
  end if;

  -- Expiry-aware membership (OTA-05): anonymous past anonymous_expires_at is not a member.
  v_is_member := extensions.is_member(p_group_id);

  if not v_is_member then
    insert into public.core_operations (
      operation_id, group_id, actor_id, entity_type, entity_id,
      base_entity_version, operation_type, payload, result_entity_version, status, created_at
    ) values (
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type,
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
        '_conflict', jsonb_build_object(
          'code', 'unauthorized',
          'message', 'not a group member'
        )
      ),
      null, 'conflict', coalesce(p_created_at, now())
    )
    on conflict (operation_id) do nothing;

    return jsonb_build_object(
      'status', 'conflict',
      'operation_id', p_operation_id,
      'conflict', jsonb_build_object(
        'code', 'unauthorized',
        'message', 'not a group member'
      )
    );
  end if;

  -- Serialize first-write races for this entity.
  perform pg_advisory_xact_lock(
    hashtext(p_group_id::text || ':' || p_entity_type),
    hashtext(p_entity_id)
  );

  -- Idempotent replay: same operation id always returns the first result.
  select * into v_existing
  from public.core_operations
  where operation_id = p_operation_id;

  if found then
    select * into v_row
    from public.core_entity_versions
    where group_id = p_group_id
      and entity_type = p_entity_type
      and entity_id = p_entity_id;

    if v_existing.status = 'conflict' then
      return jsonb_build_object(
        'status', 'conflict',
        'operation_id', p_operation_id,
        'conflict', coalesce(
          v_existing.payload->'_conflict',
          jsonb_build_object(
            'code', 'stale_version',
            'message', 'previously conflicted operation',
            'server_entity_version', coalesce(v_row.entity_version, 0),
            'server_state', case
              when v_row.state ? 'journeyPhase' then v_row.state
              else null
            end
          )
        )
      );
    end if;

    return jsonb_build_object(
      'status', 'duplicate',
      'operation_id', p_operation_id,
      'entity_version', coalesce(v_existing.result_entity_version, v_row.entity_version, p_entity_version),
      'entity', v_row.state
    );
  end if;

  insert into public.core_entity_versions (
    group_id, entity_type, entity_id, entity_version, state, updated_at
  ) values (
    p_group_id, p_entity_type, p_entity_id, 0, '{}'::jsonb, now()
  )
  on conflict (group_id, entity_type, entity_id) do nothing;

  select * into v_row
  from public.core_entity_versions
  where group_id = p_group_id
    and entity_type = p_entity_type
    and entity_id = p_entity_id
  for update;

  v_server_version := coalesce(v_row.entity_version, 0);

  if v_server_version <> p_entity_version then
    insert into public.core_operations (
      operation_id, group_id, actor_id, entity_type, entity_id,
      base_entity_version, operation_type, payload, result_entity_version, status, created_at
    ) values (
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type,
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
        '_conflict', jsonb_build_object(
          'code', 'stale_version',
          'message', 'entity version mismatch',
          'server_entity_version', v_server_version,
          'server_state', case
            when v_row.state ? 'journeyPhase' or v_row.state ? 'response' then v_row.state
            else null
          end
        )
      ),
      v_server_version, 'conflict', coalesce(p_created_at, now())
    );

    return jsonb_build_object(
      'status', 'conflict',
      'operation_id', p_operation_id,
      'conflict', jsonb_build_object(
        'code', 'stale_version',
        'message', 'entity version mismatch',
        'server_entity_version', v_server_version,
        'server_state', case
          when v_row.state ? 'journeyPhase' or v_row.state ? 'response' then v_row.state
          else null
        end
      )
    );
  end if;

  -- Team gathering transitions: leader only.
  if p_entity_type = 'active_gathering'
     and p_operation_type in ('start_gathering', 'end_gathering') then
    select exists (
      select 1 from public.memberships m
      where m.group_id = p_group_id
        and m.user_id = v_uid
        and m.role = 'leader'
    ) into v_is_leader;

    if not v_is_leader then
      insert into public.core_operations (
        operation_id, group_id, actor_id, entity_type, entity_id,
        base_entity_version, operation_type, payload, result_entity_version, status, created_at
      ) values (
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type,
        coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
          '_conflict', jsonb_build_object(
            'code', 'unauthorized',
            'message', 'only leader may transition team gathering',
            'server_entity_version', v_server_version,
            'server_state', case
              when v_row.state ? 'journeyPhase' then v_row.state else null
            end
          )
        ),
        v_server_version, 'conflict', coalesce(p_created_at, now())
      );

      return jsonb_build_object(
        'status', 'conflict',
        'operation_id', p_operation_id,
        'conflict', jsonb_build_object(
          'code', 'unauthorized',
          'message', 'only leader may transition team gathering',
          'server_entity_version', v_server_version,
          'server_state', v_row.state
        )
      );
    end if;

    -- Serialize itinerary / legacy group columns with the gathering transition.
    perform 1 from public.groups g where g.id = p_group_id for update;
  end if;

  -- Navigation response must stay user-scoped (entity_id ends with :uid).
  if p_entity_type = 'navigation_response' then
    if p_entity_id is distinct from (
      coalesce(p_payload->>'sessionId', '') || ':' || v_uid::text
    ) and p_entity_id not like ('%:' || v_uid::text) then
      insert into public.core_operations (
        operation_id, group_id, actor_id, entity_type, entity_id,
        base_entity_version, operation_type, payload, result_entity_version, status, created_at
      ) values (
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, coalesce(p_payload, '{}'::jsonb),
        v_server_version, 'conflict', coalesce(p_created_at, now())
      );

      return jsonb_build_object(
        'status', 'conflict',
        'operation_id', p_operation_id,
        'conflict', jsonb_build_object(
          'code', 'unauthorized',
          'message', 'navigation response is user-scoped'
        )
      );
    end if;
  end if;

  v_next_version := v_server_version + 1;

  -- Server-side transition validation + recompute for gathering.
  if p_entity_type = 'active_gathering'
     and p_operation_type in ('start_gathering', 'end_gathering') then
    v_phase := coalesce(v_row.state->>'journeyPhase', 'staying');
    v_point_statuses := coalesce(v_row.state->'pointStatuses', '{}'::jsonb);

    if p_operation_type = 'start_gathering' then
      v_active := coalesce(nullif(p_payload->>'activeDestinationId', ''), '');

      if v_phase = 'en_route' and v_server_version > 0 then
        insert into public.core_operations (
          operation_id, group_id, actor_id, entity_type, entity_id,
          base_entity_version, operation_type, payload, result_entity_version, status, created_at
        ) values (
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            '_conflict', jsonb_build_object(
              'code', 'invalid_transition',
              'message', 'cannot start while already en_route',
              'server_entity_version', v_server_version,
              'server_state', case
                when v_row.state ? 'journeyPhase' then v_row.state else null
              end
            )
          ),
          v_server_version, 'conflict', coalesce(p_created_at, now())
        );
        return jsonb_build_object(
          'status', 'conflict',
          'operation_id', p_operation_id,
          'conflict', jsonb_build_object(
            'code', 'invalid_transition',
            'message', 'cannot start while already en_route',
            'server_entity_version', v_server_version,
            'server_state', v_row.state
          )
        );
      end if;

      if v_active = '' then
        insert into public.core_operations (
          operation_id, group_id, actor_id, entity_type, entity_id,
          base_entity_version, operation_type, payload, result_entity_version, status, created_at
        ) values (
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            '_conflict', jsonb_build_object(
              'code', 'invalid_transition',
              'message', 'start requires activeDestinationId',
              'server_entity_version', v_server_version,
              'server_state', case
                when v_row.state ? 'journeyPhase' then v_row.state else null
              end
            )
          ),
          v_server_version, 'conflict', coalesce(p_created_at, now())
        );
        return jsonb_build_object(
          'status', 'conflict',
          'operation_id', p_operation_id,
          'conflict', jsonb_build_object(
            'code', 'invalid_transition',
            'message', 'start requires activeDestinationId',
            'server_entity_version', v_server_version,
            'server_state', v_row.state
          )
        );
      end if;

      if v_active !~* v_uuid_re then
        insert into public.core_operations (
          operation_id, group_id, actor_id, entity_type, entity_id,
          base_entity_version, operation_type, payload, result_entity_version, status, created_at
        ) values (
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            '_conflict', jsonb_build_object(
              'code', 'invalid_transition',
              'message', 'activeDestinationId is not a valid itinerary item id',
              'server_entity_version', v_server_version,
              'server_state', case
                when v_row.state ? 'journeyPhase' then v_row.state else null
              end
            )
          ),
          v_server_version, 'conflict', coalesce(p_created_at, now())
        );
        return jsonb_build_object(
          'status', 'conflict',
          'operation_id', p_operation_id,
          'conflict', jsonb_build_object(
            'code', 'invalid_transition',
            'message', 'activeDestinationId is not a valid itinerary item id',
            'server_entity_version', v_server_version,
            'server_state', v_row.state
          )
        );
      end if;

      select i.* into v_item
      from public.itinerary_items i
      where i.id = v_active::uuid
        and i.group_id = p_group_id
      for update;

      if not found then
        insert into public.core_operations (
          operation_id, group_id, actor_id, entity_type, entity_id,
          base_entity_version, operation_type, payload, result_entity_version, status, created_at
        ) values (
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            '_conflict', jsonb_build_object(
              'code', 'invalid_transition',
              'message', 'activeDestinationId does not belong to group',
              'server_entity_version', v_server_version,
              'server_state', case
                when v_row.state ? 'journeyPhase' then v_row.state else null
              end
            )
          ),
          v_server_version, 'conflict', coalesce(p_created_at, now())
        );
        return jsonb_build_object(
          'status', 'conflict',
          'operation_id', p_operation_id,
          'conflict', jsonb_build_object(
            'code', 'invalid_transition',
            'message', 'activeDestinationId does not belong to group',
            'server_entity_version', v_server_version,
            'server_state', v_row.state
          )
        );
      end if;

      if v_item.closed_at is not null or v_item.day is null then
        insert into public.core_operations (
          operation_id, group_id, actor_id, entity_type, entity_id,
          base_entity_version, operation_type, payload, result_entity_version, status, created_at
        ) values (
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            '_conflict', jsonb_build_object(
              'code', 'invalid_transition',
              'message', 'destination is already closed',
              'server_entity_version', v_server_version,
              'server_state', case
                when v_row.state ? 'journeyPhase' then v_row.state else null
              end
            )
          ),
          v_server_version, 'conflict', coalesce(p_created_at, now())
        );
        return jsonb_build_object(
          'status', 'conflict',
          'operation_id', p_operation_id,
          'conflict', jsonb_build_object(
            'code', 'invalid_transition',
            'message', 'destination is already closed',
            'server_entity_version', v_server_version,
            'server_state', v_row.state
          )
        );
      end if;

      v_point_status := coalesce(v_point_statuses->>v_active, 'pending');
      if v_point_status is distinct from 'pending' then
        insert into public.core_operations (
          operation_id, group_id, actor_id, entity_type, entity_id,
          base_entity_version, operation_type, payload, result_entity_version, status, created_at
        ) values (
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            '_conflict', jsonb_build_object(
              'code', 'invalid_transition',
              'message', 'destination point is not pending',
              'server_entity_version', v_server_version,
              'server_state', case
                when v_row.state ? 'journeyPhase' then v_row.state else null
              end
            )
          ),
          v_server_version, 'conflict', coalesce(p_created_at, now())
        );
        return jsonb_build_object(
          'status', 'conflict',
          'operation_id', p_operation_id,
          'conflict', jsonb_build_object(
            'code', 'invalid_transition',
            'message', 'destination point is not pending',
            'server_entity_version', v_server_version,
            'server_state', v_row.state
          )
        );
      end if;

      -- Start only applies to the next open gathering point (day, position, id).
      select i.id::text into v_legal_next
      from public.itinerary_items i
      where i.group_id = p_group_id
        and i.closed_at is null and i.day is not null
        and i.subgroup_id is not distinct from v_item.subgroup_id
      order by coalesce(i.day, 1), i.position, i.id
      limit 1;

      if v_legal_next is distinct from v_active then
        insert into public.core_operations (
          operation_id, group_id, actor_id, entity_type, entity_id,
          base_entity_version, operation_type, payload, result_entity_version, status, created_at
        ) values (
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            '_conflict', jsonb_build_object(
              'code', 'invalid_transition',
              'message', 'start only allowed on next pending gathering point',
              'server_entity_version', v_server_version,
              'server_state', case
                when v_row.state ? 'journeyPhase' then v_row.state else null
              end
            )
          ),
          v_server_version, 'conflict', coalesce(p_created_at, now())
        );
        return jsonb_build_object(
          'status', 'conflict',
          'operation_id', p_operation_id,
          'conflict', jsonb_build_object(
            'code', 'invalid_transition',
            'message', 'start only allowed on next pending gathering point',
            'server_entity_version', v_server_version,
            'server_state', v_row.state
          )
        );
      end if;

      v_point_statuses := v_point_statuses || jsonb_build_object(v_active, 'en_route');
      v_state := jsonb_build_object(
        'groupId', p_group_id::text,
        'journeyPhase', 'en_route',
        'activeDestinationId', v_active,
        'pointStatuses', v_point_statuses,
        'phaseChangedAt', (extract(epoch from now()) * 1000)::bigint,
        'entityVersion', v_next_version
      );
    else
      -- end_gathering: require en_route regardless of entity version.
      if v_phase is distinct from 'en_route' then
        insert into public.core_operations (
          operation_id, group_id, actor_id, entity_type, entity_id,
          base_entity_version, operation_type, payload, result_entity_version, status, created_at
        ) values (
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            '_conflict', jsonb_build_object(
              'code', 'invalid_transition',
              'message', 'cannot end while not en_route',
              'server_entity_version', v_server_version,
              'server_state', case
                when v_row.state ? 'journeyPhase' then v_row.state else null
              end
            )
          ),
          v_server_version, 'conflict', coalesce(p_created_at, now())
        );
        return jsonb_build_object(
          'status', 'conflict',
          'operation_id', p_operation_id,
          'conflict', jsonb_build_object(
            'code', 'invalid_transition',
            'message', 'cannot end while not en_route',
            'server_entity_version', v_server_version,
            'server_state', case
              when v_row.state ? 'journeyPhase' then v_row.state else null
            end
          )
        );
      end if;

      -- End navigation = pause only. Revert active point to pending; do not
      -- complete / close itinerary (that is complete_gathering_stop).
      v_active := coalesce(v_row.state->>'activeDestinationId', '');
      if v_active <> '' then
        v_point_statuses := v_point_statuses || jsonb_build_object(v_active, 'pending');
      end if;

      -- Soft cursor: optional client nextDestinationId, else stay on paused point.
      v_client_next := nullif(p_payload->>'nextDestinationId', '');
      if v_client_next is null then
        v_next := nullif(v_active, '');
      else
        -- Client may only keep the paused point or name another still-open stop.
        if v_client_next = v_active then
          v_next := v_active;
        elsif exists (
          select 1 from public.itinerary_items i
          where i.group_id = p_group_id
            and i.id::text = v_client_next
            and i.closed_at is null and i.day is not null
        ) then
          v_next := v_client_next;
          v_point_statuses := v_point_statuses || jsonb_build_object(v_next, 'pending');
        else
          insert into public.core_operations (
            operation_id, group_id, actor_id, entity_type, entity_id,
            base_entity_version, operation_type, payload, result_entity_version, status, created_at
          ) values (
            p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
            p_entity_version, p_operation_type,
            coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
              '_conflict', jsonb_build_object(
                'code', 'invalid_transition',
                'message', 'nextDestinationId is not a legal next gathering point',
                'server_entity_version', v_server_version,
                'server_state', case
                  when v_row.state ? 'journeyPhase' then v_row.state else null
                end
              )
            ),
            v_server_version, 'conflict', coalesce(p_created_at, now())
          );
          return jsonb_build_object(
            'status', 'conflict',
            'operation_id', p_operation_id,
            'conflict', jsonb_build_object(
              'code', 'invalid_transition',
              'message', 'nextDestinationId is not a legal next gathering point',
              'server_entity_version', v_server_version,
              'server_state', case
                when v_row.state ? 'journeyPhase' then v_row.state else null
              end
            )
          );
        end if;
      end if;

      v_state := jsonb_build_object(
        'groupId', p_group_id::text,
        'journeyPhase', 'staying',
        'activeDestinationId', v_next,
        'pointStatuses', v_point_statuses,
        'phaseChangedAt', (extract(epoch from now()) * 1000)::bigint,
        'entityVersion', v_next_version
      );
    end if;
  elsif p_entity_type = 'navigation_response' then
    v_state := jsonb_build_object(
      'sessionId', p_payload->>'sessionId',
      'userId', v_uid::text,
      'groupId', p_group_id::text,
      'response', p_payload->'response',
      'entityVersion', v_next_version,
      'updatedAt', (extract(epoch from now()) * 1000)::bigint
    );
  else
    v_state := coalesce(p_payload->'result', p_payload, '{}'::jsonb);
    v_state := v_state || jsonb_build_object('entityVersion', v_next_version);
  end if;

  update public.core_entity_versions
  set entity_version = v_next_version,
      state = v_state,
      updated_at = now()
  where group_id = p_group_id
    and entity_type = p_entity_type
    and entity_id = p_entity_id
  returning * into v_row;

  -- Bridge onto legacy group columns only after itinerary validation passed.
  if p_entity_type = 'active_gathering' and p_operation_type = 'start_gathering' then
    update public.groups g
    set journey_status = 'going',
        active_destination_id = case
          when (v_state->>'activeDestinationId') ~* v_uuid_re
          then (v_state->>'activeDestinationId')::uuid
          else g.active_destination_id
        end,
        journey_started_at = now()
    where g.id = p_group_id;
  elsif p_entity_type = 'active_gathering' and p_operation_type = 'end_gathering' then
    -- Pause flock travel only. Never close itinerary here — complete_gathering_stop
    -- is the sole path that sets closed_at / moves a stop into history.
    update public.groups g
    set journey_status = 'paused',
        active_destination_id = case
          when (v_state->>'activeDestinationId') ~* v_uuid_re
          then (v_state->>'activeDestinationId')::uuid
          else null
        end,
        journey_started_at = null
    where g.id = p_group_id;
  end if;

  insert into public.core_operations (
    operation_id, group_id, actor_id, entity_type, entity_id,
    base_entity_version, operation_type, payload, result_entity_version, status, created_at
  ) values (
    p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
    p_entity_version, p_operation_type, coalesce(p_payload, '{}'::jsonb),
    v_next_version, 'accepted', coalesce(p_created_at, now())
  );

  v_result := jsonb_build_object(
    'status', 'accepted',
    'operation_id', p_operation_id,
    'entity_version', v_next_version,
    'entity', v_row.state
  );
  return v_result;
end;
$$;
create or replace function public.apply_leader_gathering_switch(
  p_operation_id uuid,
  p_group_id uuid,
  p_entity_id text,
  p_entity_version integer,
  p_destination_id text,
  p_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.core_operations%rowtype;
  v_row public.core_entity_versions%rowtype;
  v_server_version integer;
  v_next_version integer;
  v_target public.itinerary_items%rowtype;
  v_state jsonb;
  v_statuses jsonb;
  v_old text;
  v_target_status text;
  v_key text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_operation_id is null or p_group_id is null or p_entity_id is null
     or p_entity_version is null or p_destination_id is null then
    raise exception 'invalid gathering switch arguments' using errcode = '22023';
  end if;
  if not extensions.is_member(p_group_id) then
    return jsonb_build_object(
      'status', 'conflict',
      'operation_id', p_operation_id,
      'conflict', jsonb_build_object(
        'code', 'unauthorized',
        'message', 'not a group member'
      )
    );
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = v_uid and m.role = 'leader'
  ) then
    return jsonb_build_object(
      'status', 'conflict',
      'operation_id', p_operation_id,
      'conflict', jsonb_build_object(
        'code', 'unauthorized',
        'message', 'only leader may switch gathering'
      )
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_group_id::text || ':active_gathering'),
    hashtext(p_entity_id)
  );

  select * into v_existing
  from public.core_operations
  where operation_id = p_operation_id;
  if found then
    if v_existing.status = 'accepted' then
      select state into v_state
      from public.core_entity_versions
      where group_id = p_group_id
        and entity_type = 'active_gathering'
        and entity_id = p_entity_id;
      return jsonb_build_object(
        'status', 'duplicate',
        'operation_id', p_operation_id,
        'entity_version', coalesce(v_existing.result_entity_version, 0),
        'entity', v_state
      );
    end if;
    return jsonb_build_object(
      'status', 'conflict',
      'operation_id', p_operation_id,
      'conflict', coalesce(
        v_existing.payload->'_conflict',
        jsonb_build_object('code', 'stale_version', 'message', 'previously conflicted operation')
      )
    );
  end if;

  insert into public.core_entity_versions (
    group_id, entity_type, entity_id, entity_version, state, updated_at
  ) values (
    p_group_id, 'active_gathering', p_entity_id, 0, '{}'::jsonb, now()
  ) on conflict (group_id, entity_type, entity_id) do nothing;

  select * into v_row
  from public.core_entity_versions
  where group_id = p_group_id
    and entity_type = 'active_gathering'
    and entity_id = p_entity_id
  for update;
  v_server_version := coalesce(v_row.entity_version, 0);

  if v_server_version <> p_entity_version then
    insert into public.core_operations (
      operation_id, group_id, actor_id, entity_type, entity_id,
      base_entity_version, operation_type, payload, result_entity_version, status, created_at
    ) values (
      p_operation_id, p_group_id, v_uid, 'active_gathering', p_entity_id,
      p_entity_version, 'switch_gathering',
      jsonb_build_object(
        'activeDestinationId', p_destination_id,
        '_conflict', jsonb_build_object(
          'code', 'stale_version',
          'message', 'entity version mismatch',
          'server_entity_version', v_server_version,
          'server_state', case when v_row.state ? 'journeyPhase' then v_row.state else null end
        )
      ),
      v_server_version, 'conflict', coalesce(p_created_at, now())
    );
    return jsonb_build_object(
      'status', 'conflict',
      'operation_id', p_operation_id,
      'conflict', jsonb_build_object(
        'code', 'stale_version',
        'message', 'entity version mismatch',
        'server_entity_version', v_server_version,
        'server_state', case when v_row.state ? 'journeyPhase' then v_row.state else null end
      )
    );
  end if;

  if p_destination_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'destination id is not a valid itinerary item id' using errcode = '22023';
  end if;
  select * into v_target
  from public.itinerary_items i
  where i.id = p_destination_id::uuid and i.group_id = p_group_id
  for update;
  if not found then
    raise exception 'destination does not belong to group' using errcode = '23503';
  end if;
  if v_target.closed_at is not null or v_target.day is null then
    raise exception 'destination is already closed' using errcode = '55000';
  end if;

  v_statuses := coalesce(v_row.state->'pointStatuses', '{}'::jsonb);
  -- The itinerary is the source of the complete point key set. Preserve all
  -- existing statuses and add missing open/closed rows before switching.
  for v_key in
    select i.id::text from public.itinerary_items i
    where i.group_id = p_group_id and i.day is not null
  loop
    if not (v_statuses ? v_key) then
      v_statuses := v_statuses || jsonb_build_object(v_key, 'pending');
    end if;
  end loop;
  for v_key in
    select i.id::text from public.itinerary_items i
    where i.group_id = p_group_id and i.closed_at is not null
  loop
    v_statuses := v_statuses || jsonb_build_object(v_key, 'completed');
  end loop;

  v_old := nullif(v_row.state->>'activeDestinationId', '');
  v_target_status := coalesce(v_statuses->>p_destination_id, 'pending');
  if v_target_status = 'completed' then
    raise exception 'destination point is completed' using errcode = '55000';
  end if;
  if v_old is not null and v_old <> p_destination_id
     and coalesce(v_statuses->>v_old, 'pending') = 'en_route' then
    v_statuses := v_statuses || jsonb_build_object(v_old, 'pending');
  end if;
  v_statuses := v_statuses || jsonb_build_object(p_destination_id, 'en_route');
  v_next_version := v_server_version + 1;
  v_state := jsonb_build_object(
    'groupId', p_group_id::text,
    'journeyPhase', 'en_route',
    'activeDestinationId', p_destination_id,
    'pointStatuses', v_statuses,
    'phaseChangedAt', (extract(epoch from now()) * 1000)::bigint,
    'entityVersion', v_next_version
  );

  update public.core_entity_versions
  set entity_version = v_next_version, state = v_state, updated_at = now()
  where group_id = p_group_id
    and entity_type = 'active_gathering'
    and entity_id = p_entity_id;

  update public.groups
  set journey_status = 'going',
      active_destination_id = p_destination_id::uuid,
      journey_started_at = now()
  where id = p_group_id;

  insert into public.core_operations (
    operation_id, group_id, actor_id, entity_type, entity_id,
    base_entity_version, operation_type, payload, result_entity_version, status, created_at
  ) values (
    p_operation_id, p_group_id, v_uid, 'active_gathering', p_entity_id,
    p_entity_version, 'switch_gathering',
    jsonb_build_object('activeDestinationId', p_destination_id),
    v_next_version, 'accepted', coalesce(p_created_at, now())
  );

  return jsonb_build_object(
    'status', 'accepted',
    'operation_id', p_operation_id,
    'entity_version', v_next_version,
    'entity', v_state
  );
end;
$$;
commit;
