-- Integrate daily-accommodation semantics with the deployed locked itinerary RPCs.

drop function if exists public.add_itinerary_item(
  uuid, uuid, text, text, double precision, double precision, integer
);

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
  v_day integer := greatest(1, coalesce(p_day, 1));
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
    and coalesce(i.day, 1) = v_day;

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
      and coalesce(i.day, 1) = v_day
  ) then
    select coalesce(max(i.position), -1) + 1 into v_insert_pos
    from public.itinerary_items i
    where i.group_id = p_group_id
      and (
        (p_subgroup_id is null and i.subgroup_id is null)
        or i.subgroup_id = p_subgroup_id
      )
      and coalesce(i.day, 1) < v_day;
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
        and coalesce(i.day, 1) = v_day
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

revoke all on function public.add_itinerary_item(uuid, uuid, text, text, double precision, double precision, integer, text, boolean)
  from public, anon, service_role;
grant execute on function public.add_itinerary_item(uuid, uuid, text, text, double precision, double precision, integer, text, boolean)
  to authenticated;

-- ── reorder_itinerary_items: set allow GUC after group lock ──────────────────

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
      v_day := greatest(1, coalesce((v_item->>'day')::integer, 1));
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

revoke all on function public.reorder_itinerary_items(uuid, jsonb) from public, anon;
grant execute on function public.reorder_itinerary_items(uuid, jsonb) to authenticated;

comment on function public.reorder_itinerary_items(uuid, jsonb) is
  'Reorder open itinerary items from ordered IDs under groups FOR UPDATE; positions come from the locked snapshot.';
