-- #151 Sol r3: lock every server-side itinerary position writer.
-- Direct table writes remain available during the documented old-client rollout;
-- the new client uses the serialized RPCs below.

-- ── import_itinerary_batch: serialize after group lock ───────────────────────

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

  if p_subgroup_id is not null and not exists (
    select 1 from public.subgroups s
    where s.id = p_subgroup_id
      and s.group_id = p_group_id
  ) then
    raise exception 'subgroup does not belong to group' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid import batch' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count = 0 then
    return 0;
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
  set position = i.position + v_count
  where i.group_id = p_group_id
    and (
      (p_subgroup_id is null and i.subgroup_id is null)
      or i.subgroup_id = p_subgroup_id
    )
    and i.position >= v_insert_pos;

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

-- ── add_itinerary_item: serialize after group lock ───────────────────────────

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

-- ── resolve_gather_point_request: groups FOR UPDATE before max+insert ────────

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
  select * into v_request
  from public.gather_point_requests r
  where r.id = p_request_id
  for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then
    raise exception 'request already resolved' using errcode = '23505';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.group_id = v_request.group_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  if p_approve then
    -- Same serialization contract as import/add/reorder.
    perform 1 from public.groups g where g.id = v_request.group_id for update;
    if not found then
      raise exception 'group not found' using errcode = 'P0002';
    end if;

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
        v_request.group_id,
        v_request.subgroup_id,
        btrim(v_item->>'title'),
        nullif(v_item->>'address', ''),
        greatest(1, coalesce((v_item->>'day')::integer, 1)),
        (v_item->>'latitude')::double precision,
        (v_item->>'longitude')::double precision,
        v_position,
        (select auth.uid())
      );
      v_inserted := v_inserted + 1;
    end loop;
  end if;

  update public.gather_point_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'status', case when p_approve then 'approved' else 'rejected' end,
    'inserted_count', v_inserted
  );
end;
$$;

revoke all on function public.resolve_gather_point_request(uuid, boolean) from public, anon;
grant execute on function public.resolve_gather_point_request(uuid, boolean) to authenticated;

-- ── coordination_apply_outcome: lock + GUC before position/day mutations ─────

create or replace function public.coordination_apply_outcome(
  p_request public.coordination_requests,
  p_option_id text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option jsonb;
  v_kind text;
  v_payload jsonb;
  v_version bigint;
  v_op_id uuid;
  v_op_type text := 'coordination_no_change';
  v_dest_id uuid;
  v_position integer;
  v_lat double precision;
  v_lon double precision;
  v_title text;
  v_address text;
  v_day integer;
  v_meet_at timestamptz;
  v_applied jsonb := jsonb_build_object('option_id', p_option_id);
begin
  select value into v_option
  from jsonb_array_elements(p_request.options) elem(value)
  where btrim(value->>'id') = p_option_id
  limit 1;

  if v_option is null then
    raise exception 'resolved option not found in request options'
      using errcode = '22023';
  end if;

  v_kind := coalesce(nullif(btrim(v_option->>'kind'), ''), 'keep_current');
  v_payload := coalesce(v_option->'payload', '{}'::jsonb);

  if v_kind in ('keep_current', 'reject', 'no_change') then
    v_op_type := 'coordination_no_change';
    v_applied := v_applied || jsonb_build_object('applied', false, 'kind', v_kind);
  elsif v_kind = 'meet_time' then
    v_dest_id := nullif(v_payload->>'destinationId', '')::uuid;
    if v_dest_id is null then
      raise exception 'meet_time option requires destinationId'
        using errcode = '22023';
    end if;
    v_meet_at := nullif(v_payload->>'meetAt', '')::timestamptz;

    update public.itinerary_items i
    set meet_at = v_meet_at
    where i.id = v_dest_id
      and i.group_id = p_request.group_id
      and i.subgroup_id is not distinct from p_request.subgroup_id
      and i.closed_at is null;

    if not found then
      v_op_type := 'coordination_no_change';
      v_applied := v_applied || jsonb_build_object(
        'applied', false,
        'kind', v_kind,
        'reason', 'destination_missing_or_closed'
      );
    else
      v_op_type := 'coordination_apply';
      v_applied := v_applied || jsonb_build_object(
        'applied', true,
        'kind', v_kind,
        'destination_id', v_dest_id,
        'meet_at', v_meet_at
      );
    end if;
  elsif v_kind in ('gathering_point', 'itinerary', 'route') then
    v_dest_id := nullif(v_payload->>'destinationId', '')::uuid;
    v_title := nullif(btrim(v_payload->>'title'), '');
    v_address := nullif(v_payload->>'address', '');
    v_lat := nullif(v_payload->>'latitude', '')::double precision;
    if v_lat is null and jsonb_typeof(v_payload->'latitude') = 'number' then
      v_lat := (v_payload->>'latitude')::double precision;
    end if;
    v_lon := nullif(v_payload->>'longitude', '')::double precision;
    if v_lon is null and jsonb_typeof(v_payload->'longitude') = 'number' then
      v_lon := (v_payload->>'longitude')::double precision;
    end if;
    v_day := greatest(1, coalesce(nullif(v_payload->>'day', '')::integer, 1));

    if (v_lat is not null and v_lat not between -90 and 90)
       or (v_lon is not null and v_lon not between -180 and 180) then
      raise exception 'invalid coordinates' using errcode = '22023';
    end if;

    -- Serialize with import/add/reorder before any day/position mutation.
    perform 1 from public.groups g where g.id = p_request.group_id for update;
    if not found then
      raise exception 'group not found' using errcode = 'P0002';
    end if;

    if v_dest_id is not null then
      update public.itinerary_items i
      set title = coalesce(v_title, i.title),
          address = case
            when v_payload ? 'address' then v_address
            else i.address
          end,
          latitude = coalesce(v_lat, i.latitude),
          longitude = coalesce(v_lon, i.longitude),
          day = coalesce(
            nullif(v_payload->>'day', '')::integer,
            i.day
          ),
          meet_at = case
            when v_payload ? 'meetAt' then nullif(v_payload->>'meetAt', '')::timestamptz
            else i.meet_at
          end
      where i.id = v_dest_id
        and i.group_id = p_request.group_id
        and i.subgroup_id is not distinct from p_request.subgroup_id
        and i.closed_at is null;

      if found then
        v_op_type := 'coordination_apply';
        v_applied := v_applied || jsonb_build_object(
          'applied', true,
          'kind', v_kind,
          'destination_id', v_dest_id,
          'mode', 'update'
        );
      else
        v_op_type := 'coordination_no_change';
        v_applied := v_applied || jsonb_build_object(
          'applied', false,
          'kind', v_kind,
          'reason', 'destination_missing_or_closed'
        );
      end if;
    elsif v_title is not null and v_lat is not null and v_lon is not null then
      select coalesce(max(i.position), -1) into v_position
      from public.itinerary_items i
      where i.group_id = p_request.group_id
        and i.subgroup_id is not distinct from p_request.subgroup_id;

      insert into public.itinerary_items(
        group_id, subgroup_id, title, address, day,
        latitude, longitude, position, created_by, meet_at
      ) values (
        p_request.group_id,
        p_request.subgroup_id,
        v_title,
        v_address,
        v_day,
        v_lat,
        v_lon,
        v_position + 1,
        p_actor,
        nullif(v_payload->>'meetAt', '')::timestamptz
      )
      returning id into v_dest_id;

      v_op_type := 'coordination_apply';
      v_applied := v_applied || jsonb_build_object(
        'applied', true,
        'kind', v_kind,
        'destination_id', v_dest_id,
        'mode', 'insert'
      );
    else
      v_op_type := 'coordination_no_change';
      v_applied := v_applied || jsonb_build_object(
        'applied', false,
        'kind', v_kind,
        'reason', 'insufficient_payload'
      );
    end if;
  else
    v_op_type := 'coordination_no_change';
    v_applied := v_applied || jsonb_build_object(
      'applied', false,
      'kind', v_kind,
      'reason', 'unknown_kind'
    );
  end if;

  perform pg_advisory_xact_lock(87125009, hashtext(p_request.group_id::text));

  select coalesce(max(o.version), 0) + 1 into v_version
  from public.itinerary_operations o
  where o.group_id = p_request.group_id;

  insert into public.itinerary_operations(
    group_id, subgroup_id, version, operation_type, payload,
    source_request_id, created_by
  ) values (
    p_request.group_id,
    p_request.subgroup_id,
    v_version,
    v_op_type,
    v_applied || jsonb_build_object(
      'request_id', p_request.id,
      'subject', p_request.subject,
      'subject_kind', p_request.subject_kind,
      'option', v_option
    ),
    p_request.id,
    p_actor
  )
  returning id into v_op_id;

  return v_op_id;
end;
$$;
