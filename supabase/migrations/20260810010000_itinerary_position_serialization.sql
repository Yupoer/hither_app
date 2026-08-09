-- Shared server serialization for itinerary position writers (#151 Sol P1).
-- All position mutations lock public.groups row first so concurrent add / reorder /
-- import_itinerary_batch cannot compute from a stale position map.

-- ── Single-stop append (same day-append plan as former client-side addDestination) ──

create or replace function public.add_itinerary_item(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_title text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_day integer default 1
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
  v_insert_pos integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if v_title is null then
    raise exception 'invalid itinerary title' using errcode = '22023';
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

  -- Leader of group, or member of the target subgroup (matches RLS).
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
    position
  ) values (
    p_group_id,
    p_subgroup_id,
    v_title,
    nullif(trim(coalesce(p_address, '')), ''),
    v_day,
    p_latitude,
    p_longitude,
    v_insert_pos
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_itinerary_item(uuid, uuid, text, text, double precision, double precision, integer)
  from public, anon;
grant execute on function public.add_itinerary_item(uuid, uuid, text, text, double precision, double precision, integer)
  to authenticated;

comment on function public.add_itinerary_item(uuid, uuid, text, text, double precision, double precision, integer) is
  'Serialized single-stop insert: locks groups row, shifts later positions, inserts once.';

-- ── Batch reorder under the same group lock ───────────────────────────────

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
  v_count integer := 0;
  v_item jsonb;
  v_id uuid;
  v_position integer;
  v_day integer;
  v_meet_at text;
  v_has_meet boolean;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
  ) then
    raise exception 'membership required' using errcode = '42501';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'invalid reorder batch' using errcode = '22023';
  end if;

  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  for v_item in select * from jsonb_array_elements(p_updates)
  loop
    begin
      v_id := (v_item->>'id')::uuid;
      v_position := (v_item->>'position')::integer;
      v_day := greatest(1, coalesce((v_item->>'day')::integer, 1));
    exception when others then
      raise exception 'invalid reorder item' using errcode = '22023';
    end;

    if v_id is null or v_position is null then
      raise exception 'invalid reorder item' using errcode = '22023';
    end if;

    v_has_meet := v_item ? 'meet_at';
    v_meet_at := v_item->>'meet_at';

    if v_has_meet then
      update public.itinerary_items i
      set position = v_position,
          day = v_day,
          meet_at = case
            when v_meet_at is null or v_meet_at = '' then null
            else v_meet_at::timestamptz
          end
      where i.id = v_id
        and i.group_id = p_group_id;
    else
      update public.itinerary_items i
      set position = v_position,
          day = v_day
      where i.id = v_id
        and i.group_id = p_group_id;
    end if;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.reorder_itinerary_items(uuid, jsonb) from public, anon;
grant execute on function public.reorder_itinerary_items(uuid, jsonb) to authenticated;

comment on function public.reorder_itinerary_items(uuid, jsonb) is
  'Serialized multi-stop reorder: locks groups row then applies position/day(/meet_at) patches.';
