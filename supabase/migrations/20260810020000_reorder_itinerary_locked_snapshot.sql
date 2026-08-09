-- #151 Sol r2: reorder from ordered IDs against locked server snapshot.
-- Client-supplied absolute positions are ignored (stale after concurrent add/import).
-- Full-batch validation: reject dup/missing/closed/out-of-scope/unauthorized IDs
-- before any mutation; abort unless every requested row is updated.

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
  v_ids uuid[] := array[]::uuid[];
  v_days integer[] := array[]::integer[];
  v_has_meets boolean[] := array[]::boolean[];
  v_meets text[] := array[]::text[];
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

  -- Parse ordered IDs + day(/meet_at). Client "position" is ignored.
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

    v_ids := array_append(v_ids, v_id);
    v_days := array_append(v_days, v_day);
    v_has_meets := array_append(v_has_meets, v_has_meet);
    v_meets := array_append(v_meets, v_meet_at);
  end loop;

  -- Serialize against concurrent add / import / reorder.
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- Entire ID set must exist in this group (no missing / other-group IDs).
  select count(*)::integer into v_found
  from public.itinerary_items i
  where i.group_id = p_group_id
    and i.id = any (v_ids);

  if v_found <> v_input_count then
    raise exception 'reorder ids missing or out of scope' using errcode = '22023';
  end if;

  -- Closed historical rows cannot be reordered.
  select count(*)::integer into v_closed
  from public.itinerary_items i
  where i.group_id = p_group_id
    and i.id = any (v_ids)
    and i.closed_at is not null;

  if v_closed > 0 then
    raise exception 'cannot reorder closed itinerary items' using errcode = '22023';
  end if;

  -- Authority: leader may touch any group row; non-leader only their subgroup rows.
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

  -- Position slots from the locked snapshot of the requested open IDs only.
  -- Concurrent day-1 inserts that shifted later rows are reflected here.
  select coalesce(array_agg(i.position order by i.position), array[]::integer[])
  into v_slots
  from public.itinerary_items i
  where i.group_id = p_group_id
    and i.id = any (v_ids);

  if coalesce(array_length(v_slots, 1), 0) <> v_input_count then
    raise exception 'reorder slot mismatch' using errcode = '22023';
  end if;

  -- Apply in payload order → locked slots (ignore client absolute positions).
  for v_idx in 1 .. v_input_count
  loop
    if v_has_meets[v_idx] then
      update public.itinerary_items i
      set position = v_slots[v_idx],
          day = v_days[v_idx],
          meet_at = case
            when v_meets[v_idx] is null or v_meets[v_idx] = '' then null
            else (v_meets[v_idx])::timestamptz
          end
      where i.id = v_ids[v_idx]
        and i.group_id = p_group_id;
    else
      update public.itinerary_items i
      set position = v_slots[v_idx],
          day = v_days[v_idx]
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
  'Reorder open itinerary items from ordered IDs under groups FOR UPDATE; positions from locked snapshot; full-batch validate or abort.';
