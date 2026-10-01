-- Extend the existing receipt processor in place: UUID replay, causal guards,
-- actor binding, version allocation and its existing grants remain unchanged.
do $migration$
declare
  definition text;
  next_definition text;
  anchor text;
begin
  definition := replace(pg_get_functiondef('public.core_itinerary_state(uuid)'::regprocedure), E'\r\n', E'\n');
  anchor := '    ''groupId'', p_group_id::text,';
  if strpos(definition, anchor) = 0 then raise exception 'core_itinerary_state anchor missing'; end if;
  next_definition := replace(definition, anchor, $state$
    'groupId', p_group_id::text,
    'group', (select jsonb_build_object('tripDays', g.trip_days,
      'departureDate', g.departure_date, 'accommodationAutoAdd', g.accommodation_auto_add)
      from public.groups g where g.id = p_group_id),
    'dailyAccommodations', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id::text, 'groupId', d.group_id::text, 'stayDate', d.stay_date,
      'title', d.title, 'address', d.address,
      'coordinates', jsonb_build_object('latitude', d.latitude, 'longitude', d.longitude),
      'sourceDestinationId', d.source_destination_id) order by d.stay_date), '[]'::jsonb)
      from public.daily_accommodations d where d.group_id = p_group_id),$state$);
  execute next_definition;

  definition := replace(pg_get_functiondef('public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamp with time zone)'::regprocedure), E'\r\n', E'\n');
  anchor := '  -- Determine the target before version checks';
  if strpos(definition, anchor) = 0 then raise exception 'v3 authorization anchor missing'; end if;
  definition := replace(definition, anchor, $authorization$
  if p_operation_type in ('set_trip_details','set_daily_accommodation','clear_daily_accommodation') then
    if p_entity_type <> 'itinerary' or p_entity_id <> p_group_id::text
       or v_scope_subgroup_id is not null or not extensions.is_member(p_group_id)
       or not exists (select 1 from public.memberships m where m.group_id = p_group_id
         and m.user_id = v_uid and m.role = 'leader' and m.subgroup_id is null) then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized', 'leader role required for main team trip details',
        null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at);
    end if;
  end if;
  -- Determine the target before version checks$authorization$);

  anchor := '    ''resolve_gather_point_request'',''replace_snapshot''';
  if strpos(definition, anchor) = 0 then raise exception 'v3 mergeable anchor missing'; end if;
  definition := replace(definition, anchor, anchor || ',
    ''set_trip_details'',''set_daily_accommodation'',''clear_daily_accommodation''');
  definition := replace(definition, '''22023'',''22P02'',''22003''', '''22023'',''22P02'',''22003'',''22007'',''22008''');
  anchor := '    if p_operation_type in (''start_gathering'',''switch_gathering'',''start_session'') then';
  if strpos(definition, anchor) = 0 then raise exception 'v3 mutation anchor missing'; end if;
  next_definition := replace(definition, anchor, $mutation$
    if p_operation_type = 'set_trip_details' then
      if (v_payload->>'tripDays')::integer < 1
         or v_payload->>'tripDays' is null or v_payload->>'departureDate' is null
         or v_payload->>'departureDate' !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'invalid trip details' using errcode = '22023';
      end if;
      update public.groups set trip_days = (v_payload->>'tripDays')::integer,
        departure_date = (v_payload->>'departureDate')::date where id = p_group_id;
      v_state := public.core_itinerary_state(p_group_id);
    elsif p_operation_type in ('set_daily_accommodation','clear_daily_accommodation') then
      if v_payload->>'stayDate' is null or v_payload->>'stayDate' !~ '^\d{4}-\d{2}-\d{2}$'
         or (v_payload->>'day')::integer < 1 then
        raise exception 'invalid stay date or day' using errcode = '22023';
      end if;
      if p_operation_type = 'set_daily_accommodation' then
        if nullif(btrim(v_payload->'daily'->>'title'), '') is null
           or not coalesce((v_payload->'daily'->'coordinates'->>'latitude')::double precision between -90 and 90, false)
           or not coalesce((v_payload->'daily'->'coordinates'->>'longitude')::double precision between -180 and 180, false) then
          raise exception 'invalid daily accommodation' using errcode = '22023';
        end if;
        if nullif(v_payload->'daily'->>'sourceDestinationId', '') is not null and not exists (
          select 1 from public.itinerary_items i where i.id = (v_payload->'daily'->>'sourceDestinationId')::uuid
            and i.group_id = p_group_id and i.subgroup_id is null
        ) then raise exception 'invalid source destination' using errcode = '22023'; end if;
        perform public.set_accommodation_auto_add(p_group_id, false);
        perform public.set_daily_accommodation_with_auto_add(p_group_id,
          (v_payload->>'stayDate')::date, v_payload->'daily'->>'title', v_payload->'daily'->>'address',
          (v_payload->'daily'->'coordinates'->>'latitude')::double precision,
          (v_payload->'daily'->'coordinates'->>'longitude')::double precision,
          nullif(v_payload->'daily'->>'sourceDestinationId', '')::uuid, (v_payload->>'day')::integer);
      else
        perform public.clear_daily_accommodation_with_downgrade(p_group_id,
          (v_payload->>'stayDate')::date, (v_payload->>'day')::integer);
      end if;
      v_state := public.core_itinerary_state(p_group_id);
    elsif p_operation_type in ('start_gathering','switch_gathering','start_session') then$mutation$);
  definition := next_definition;
  anchor := $completion_anchor$      if v_session.status = 'cancelled' or v_session.status = 'expired' then
        raise exception 'cannot complete a cancelled navigation session' using errcode = '55000';
      end if;$completion_anchor$;
  if strpos(definition, anchor) = 0 then raise exception 'v3 completion anchor missing'; end if;
  next_definition := replace(definition, anchor, anchor || $completion$
      if p_operation_type = 'complete_destination' then
        if v_session.destination_id is distinct from v_destination_id then
          raise exception 'completion destination does not match session' using errcode = '22023';
        end if;
        if coalesce(v_payload->>'reason', 'forced') not in ('all_arrived', 'forced') then
          raise exception 'invalid completion reason' using errcode = '22023';
        end if;
        if v_payload->>'reason' = 'all_arrived' and v_session.status = 'active' then
          if not exists (select 1 from public.memberships m where m.group_id = p_group_id
            and m.subgroup_id is not distinct from v_session.scope_subgroup_id and not coalesce(m.solo, false)
            and exists (select 1 from public.navigation_member_states n where n.navigation_session_id = v_session.id and n.user_id = m.user_id))
          or exists (select 1 from public.memberships m where m.group_id = p_group_id
            and m.subgroup_id is not distinct from v_session.scope_subgroup_id and not coalesce(m.solo, false)
            and exists (select 1 from public.navigation_member_states n where n.navigation_session_id = v_session.id and n.user_id = m.user_id)
            and not exists (select 1 from public.destination_arrivals a where a.destination_id = v_session.destination_id
              and a.user_id = m.user_id and a.navigation_session_id = v_session.id and a.arrived_at is not null)) then
            -- Arrivals may still be waiting in another device's durable queue.
            -- Keep the same operation retryable; no history/closure is written.
            raise exception 'waiting for all session members to arrive' using errcode = '40001';
          end if;
        end if;
      end if;$completion$);
  execute next_definition;
end;
$migration$;
