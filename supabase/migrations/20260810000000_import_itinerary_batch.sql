-- Atomic KML/itinerary batch import (#152 / parent #151).
-- security invoker: RLS + membership checks apply; one transaction for shift+insert.

create or replace function public.import_itinerary_batch(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_day integer,
  p_items jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_day integer := greatest(1, coalesce(p_day, 1));
  v_count integer;
  v_insert_pos integer;
  v_item jsonb;
  v_idx integer := 0;
  v_title text;
  v_lat double precision;
  v_lng double precision;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid import batch' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count = 0 then
    return 0;
  end if;

  -- Serialize concurrent itinerary mutations for this group.
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- Compute insert position (append end of target day within subgroup scope).
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

  -- If no same-day rows, place after last earlier-day stop in scope.
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

  -- Shift later rows once by +v_count (high → low to avoid unique collisions).
  update public.itinerary_items i
  set position = i.position + v_count
  where i.group_id = p_group_id
    and (
      (p_subgroup_id is null and i.subgroup_id is null)
      or i.subgroup_id = p_subgroup_id
    )
    and i.position >= v_insert_pos;

  -- Insert all items in file order.
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
      or v_lng < -180 or v_lng > 180
    then
      raise exception 'invalid import item coordinates' using errcode = '22023';
    end if;

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
      nullif(trim(coalesce(v_item->>'address', '')), ''),
      v_day,
      v_lat,
      v_lng,
      v_insert_pos + v_idx
    );

    v_idx := v_idx + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.import_itinerary_batch(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.import_itinerary_batch(uuid, uuid, integer, jsonb) to authenticated;

comment on function public.import_itinerary_batch(uuid, uuid, integer, jsonb) is
  'Atomic batch insert of itinerary stops (KML import). Leader-only; one shift + multi insert.';
