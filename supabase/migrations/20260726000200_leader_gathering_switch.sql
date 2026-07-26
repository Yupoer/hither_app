-- Leader-first gathering switch.
-- A switch pauses the old active point (pending), starts the requested open
-- point, and never writes itinerary_items.closed_at. The session handoff is
-- separate from complete_gathering_stop so changing cards cannot create history.

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
  if v_target.closed_at is not null then
    raise exception 'destination is already closed' using errcode = '55000';
  end if;

  v_statuses := coalesce(v_row.state->'pointStatuses', '{}'::jsonb);
  -- The itinerary is the source of the complete point key set. Preserve all
  -- existing statuses and add missing open/closed rows before switching.
  for v_key in
    select i.id::text from public.itinerary_items i
    where i.group_id = p_group_id
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

revoke all on function public.apply_leader_gathering_switch(uuid, uuid, text, integer, text, timestamptz) from public;
grant execute on function public.apply_leader_gathering_switch(uuid, uuid, text, integer, text, timestamptz) to authenticated;

-- Session handoff used only after the leader's local switch is durable.
create or replace function public.start_navigation_session_switch(
  p_group_id uuid,
  p_destination_id uuid,
  p_request_id uuid
)
returns public.navigation_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.navigation_sessions;
  v_destination public.itinerary_items;
  v_session public.navigation_sessions;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then raise exception 'group not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = (select auth.uid()) and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  select s.* into v_existing
  from public.navigation_sessions s
  where s.group_id = p_group_id and s.request_id = p_request_id;
  if found then return v_existing; end if;

  update public.navigation_sessions
  set status = 'cancelled', ended_at = now(), version = version + 1, updated_at = now()
  where group_id = p_group_id and status = 'active';

  select i.* into v_destination
  from public.itinerary_items i
  where i.id = p_destination_id and i.group_id = p_group_id;
  if not found or v_destination.latitude is null or v_destination.longitude is null then
    raise exception 'destination does not belong to group or has no coordinates'
      using errcode = '23503';
  end if;
  if v_destination.closed_at is not null then
    raise exception 'destination is already closed' using errcode = '55000';
  end if;

  insert into public.navigation_sessions (
    group_id, destination_id, destination_name,
    destination_latitude, destination_longitude, started_by, request_id
  ) values (
    p_group_id, p_destination_id, v_destination.title,
    v_destination.latitude, v_destination.longitude,
    (select auth.uid()), p_request_id
  ) returning * into v_session;

  update public.memberships set status = 'active'
  where group_id = p_group_id and status = 'arrived';
  update public.groups
  set journey_status = 'going', active_destination_id = p_destination_id,
      journey_started_at = v_session.started_at
  where id = p_group_id;
  return v_session;
end;
$$;

revoke all on function public.start_navigation_session_switch(uuid, uuid, uuid) from public;
grant execute on function public.start_navigation_session_switch(uuid, uuid, uuid) to authenticated;

comment on function public.apply_leader_gathering_switch is
  'Leader-first atomic gathering switch: old active point returns to pending; target starts; no closed_at.';
comment on function public.start_navigation_session_switch is
  'Leader-only navigation session handoff; cancels prior active session without completing itinerary.';
