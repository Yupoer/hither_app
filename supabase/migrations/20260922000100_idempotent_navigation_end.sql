-- End never requires a live session row; role and scope checks remain unchanged.
create or replace function public.apply_core_operation_v3(
  p_operation_id uuid,
  p_group_id uuid,
  p_actor_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_entity_version integer,
  p_operation_type text,
  p_payload jsonb,
  p_sequence bigint,
  p_dependency_ids uuid[] default '{}'::uuid[],
  p_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_existing public.core_operations%rowtype;
  v_row public.core_entity_versions%rowtype;
  v_session public.navigation_sessions%rowtype;
  v_active public.navigation_sessions%rowtype;
  v_item public.itinerary_items%rowtype;
  v_state jsonb := '{}'::jsonb;
  v_effects jsonb := '{}'::jsonb;
  v_scope_subgroup_id uuid;
  v_scope_key text := 'main';
  v_session_id uuid;
  v_request_id uuid;
  v_destination_id uuid;
  v_target_user_id uuid;
  v_server_version integer := 0;
  v_next_version integer := 1;
  v_position integer;
  v_day integer;
  v_kind text;
  v_provider_id text;
  v_patch jsonb;
  v_arrived boolean;
  v_arrived_at timestamptz;
  v_occurred_at timestamptz;
  v_received_at timestamptz := clock_timestamp();
  v_device_id text := nullif(btrim(v_payload->>'deviceId'), '');
  v_is_rebase boolean := coalesce((v_payload->>'rebase')::boolean, false);
  v_is_member boolean := false;
  v_is_scope_leader boolean := false;
  v_mergeable boolean := false;
  v_skip_version boolean := false;
  v_replay_conflict boolean := false;
  v_scope_payload text;
  v_sqlstate text;
  v_message text;
  v_conflict_code text;
  v_target_scope uuid;
  v_history public.navigation_session_history%rowtype;
  v_request public.gather_point_requests%rowtype;
  v_item_json jsonb;
  v_closed_at timestamptz;
  v_event_id uuid;
  v_arrival public.destination_arrivals%rowtype;
  v_dependency public.core_operations%rowtype;
  v_current_session uuid;
  v_live_session uuid;
  v_arrival_exists boolean := false;
  v_source text;
  v_resource_key text;
  v_is_leader_correction boolean := false;
  v_should_project boolean := true;
  v_event_sequence bigint;
  v_event_order timestamptz;
  v_updates jsonb := '[]'::jsonb;
  v_point_statuses jsonb := '{}'::jsonb;
  v_next_destination_id text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_actor_id is null or p_actor_id <> v_uid then
    return jsonb_build_object(
      'status', 'conflict', 'operation_id', p_operation_id,
      'conflict', jsonb_build_object(
        'code', 'account_changed',
        'message', 'operation actor does not match auth.uid()'
      )
    );
  end if;
  if p_operation_id is null or p_group_id is null or p_entity_type is null
     or p_entity_id is null or p_entity_version is null or p_operation_type is null
     or p_sequence is null or p_sequence <= 0
     or jsonb_typeof(v_payload) <> 'object' then
    raise exception 'invalid v3 operation arguments' using errcode = '22023';
  end if;
  if v_device_id is not null and length(v_device_id) > 200 then
    raise exception 'deviceId is too long' using errcode = '22023';
  end if;
  begin
    v_occurred_at := coalesce(
      nullif(v_payload->>'occurredAt', '')::timestamptz,
      nullif(v_payload->>'arrivedAt', '')::timestamptz,
      p_created_at,
      v_received_at
    );
  exception when others then
    return public.core_v3_conflict(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, 'validation', 'invalid occurredAt',
      null, null, v_device_id, null, null, null
    );
  end;

  -- Session id and scope are envelope fields.  Destination operations may
  -- omit them; session transitions and arrivals may not.
  begin
    v_session_id := coalesce(
      nullif(v_payload->>'navigationSessionId', '')::uuid,
      nullif(v_payload->>'sessionId', '')::uuid
    );
  exception when others then
    return public.core_v3_conflict(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, 'validation', 'invalid sessionId',
      null, null, v_device_id, null, null, v_occurred_at
    );
  end;
  begin
    v_scope_subgroup_id := coalesce(
      nullif(v_payload->>'scopeSubgroupId', '')::uuid,
      nullif(v_payload->>'subgroupId', '')::uuid
    );
  exception when others then
    return public.core_v3_conflict(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, 'validation', 'invalid subgroup scope',
      null, null, v_device_id, null, v_session_id, v_occurred_at
    );
  end;
  -- subgroupId is the client's long-lived wire field.  scope is optional in
  -- v3; infer it only after parsing subgroupId so an omitted scope cannot
  -- silently move a subgroup operation into the main lane.
  v_scope_payload := coalesce(
    nullif(v_payload->>'scope', ''),
    case when v_scope_subgroup_id is not null then 'subgroup' else 'main' end
  );
  -- A start owns its session identity.  Prefer the explicit request id used by
  -- the mobile navigation bridge and fall back to operation_id; never let the
  -- database generate a random id that a later end/arrival cannot reference.
  begin
    v_request_id := coalesce(
      nullif(v_payload->>'navigationRequestId', '')::uuid,
      p_operation_id
    );
  exception when others then
    return public.core_v3_conflict(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, 'validation', 'invalid navigationRequestId',
      null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at
    );
  end;
  if p_operation_type in ('start_gathering', 'switch_gathering', 'start_session') then
    v_session_id := v_request_id;
  end if;
  if v_scope_payload = 'main' then
    v_scope_subgroup_id := null;
    v_scope_key := 'main';
  elsif v_scope_payload in ('subgroup', 'small_team') then
    if v_scope_subgroup_id is null then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'validation',
        'subgroup scope requires scopeSubgroupId', null, null,
        v_device_id, null, v_session_id, v_occurred_at
      );
    end if;
    v_scope_key := v_scope_subgroup_id::text;
  elsif v_scope_subgroup_id is not null then
    v_scope_key := v_scope_subgroup_id::text;
  else
    return public.core_v3_conflict(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, 'validation', 'invalid scope',
      null, null, v_device_id, null, v_session_id, v_occurred_at
    );
  end if;

  -- The mobile client keeps one arrival operation type for both self-arrival
  -- and a leader's history correction.  A target different from auth.uid(),
  -- an explicit correction flag, or source=leader_correction selects the
  -- audited leader-correction path below.
  v_is_leader_correction := p_operation_type = 'record_arrival'
    and (
      coalesce(nullif(v_payload->>'source', '') = 'leader_correction', false)
      or lower(coalesce(v_payload->>'leaderCorrection', 'false')) in ('true', '1', 't')
      or lower(coalesce(v_payload->>'correction', 'false')) in ('true', '1', 't')
      or nullif(v_payload->>'targetUserId', '') is not null
      or (
        nullif(v_payload->>'userId', '') is not null
        and nullif(v_payload->>'userId', '') is distinct from v_uid::text
      )
    );
  v_is_leader_correction := coalesce(v_is_leader_correction, false);

  select exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = v_uid
  ) into v_is_member;
  if not v_is_member and p_operation_type <> 'record_arrival' then
    return public.core_v3_conflict(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, 'unauthorized', 'not a group member',
      null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(p_group_id::text || ':v3:' || v_scope_key));
  perform pg_advisory_xact_lock(
    hashtext(p_group_id::text || ':v3:' || p_entity_type), hashtext(p_entity_id)
  );

  select * into v_existing
  from public.core_operations
  where operation_id = p_operation_id
  for update;
  if found then
    if v_existing.actor_id <> v_uid or v_existing.group_id <> p_group_id
       or v_existing.entity_type is distinct from p_entity_type
       or v_existing.entity_id is distinct from p_entity_id
       or v_existing.operation_type is distinct from p_operation_type
       or v_existing.dependency_ids is distinct from coalesce(p_dependency_ids, '{}'::uuid[]) then
      return jsonb_build_object(
        'status', 'conflict', 'operation_id', p_operation_id,
        'conflict', jsonb_build_object(
          'code', 'operation_identity_mismatch',
          'message', 'operation id was already used for a different operation'
        )
      );
    end if;
    -- A subgroup tombstone intentionally redacts the old payload.  Preserve
    -- its terminal scope_deleted meaning for a same-owner replay instead of
    -- turning the cleanup result into a misleading identity mismatch.
    if v_existing.terminal_reason = 'scope_deleted' then
      return jsonb_build_object(
        'status', 'conflict', 'operation_id', p_operation_id,
        'conflict', coalesce(
          v_existing.payload->'_conflict',
          jsonb_build_object(
            'code', 'scope_deleted',
            'message', 'subgroup no longer exists'
          )
        )
      );
    end if;
    if (coalesce(v_existing.payload, '{}'::jsonb)
        - array['_result', '_effects', '_conflict', 'rebase'])
       is distinct from (v_payload - 'rebase') then
      return jsonb_build_object(
        'status', 'conflict', 'operation_id', p_operation_id,
        'conflict', jsonb_build_object(
          'code', 'operation_identity_mismatch',
          'message', 'operation id was already used for a different operation'
        )
      );
    end if;
    if v_existing.status = 'accepted' then
      return jsonb_build_object(
        'status', 'duplicate', 'operation_id', p_operation_id,
        'entity_version', v_existing.result_entity_version,
        'entity', v_existing.result_state,
        'effects', coalesce(v_existing.result_effects, '{}'::jsonb)
      );
    end if;
    if v_existing.status = 'conflict' then
      v_conflict_code := coalesce(
        v_existing.terminal_reason,
        v_existing.payload->'_conflict'->>'code',
        'unknown'
      );
      -- A lost response, stale snapshot, missing predecessor, or an old
      -- unclassified receipt is safe to replay under the same operation id.
      -- Authorization, deletion, scope, and invalid-transition receipts stay
      -- terminal unless the caller explicitly supplied rebase=true.
      if not v_is_rebase and v_conflict_code not in (
        'stale_version', 'dependency_missing', 'unknown'
      ) then
        return jsonb_build_object(
          'status', 'conflict', 'operation_id', p_operation_id,
          'conflict', coalesce(v_existing.payload->'_conflict',
            jsonb_build_object('code', v_conflict_code,
                               'message', 'previously conflicted operation'))
        );
      end if;
    end if;
    -- Replaying a recoverable or explicitly rebased receipt resumes the same
    -- row.  It never inserts a second operation and increments the audit
    -- counter only after the side effects commit.
    v_replay_conflict := v_existing.status = 'conflict';
  end if;

  -- Dependencies are causality hints, not a permanent queue barrier.  Ignore
  -- unrelated legacy actor/group FIFO receipts.  A known failed prerequisite
  -- on this same resource is terminal (the client may show a notice).  Missing
  -- session/destination prerequisites are checked by their operation-specific
  -- guards below; an unknown legacy wire id alone must not block an operation
  -- whose actual target can be validated.
  v_resource_key := public.core_v3_operation_resource_key(
    p_operation_type, p_entity_type, p_entity_id, v_payload,
    v_session_id, v_scope_key, p_operation_id
  );
  for v_dependency in
    select o.*
    from public.core_operations o
    join unnest(coalesce(p_dependency_ids, '{}'::uuid[])) d
      on d = o.operation_id
    where o.group_id = p_group_id
  loop
    if (
      public.core_v3_operation_resource_key(
      v_dependency.operation_type, v_dependency.entity_type,
      v_dependency.entity_id, v_dependency.payload,
      v_dependency.session_id, v_dependency.scope_key,
      v_dependency.operation_id
      ) = v_resource_key
      or (
        p_operation_type = 'record_arrival'
        and v_dependency.operation_type in ('add_destination')
        and v_dependency.entity_id = p_entity_id
      )
      or (
        p_operation_type = 'record_arrival'
        and v_dependency.operation_type in ('start_gathering', 'switch_gathering', 'start_session')
        and coalesce(
          nullif(v_dependency.payload->>'navigationRequestId', ''),
          v_dependency.operation_id::text
        ) = v_session_id::text
      )
      or (
        p_operation_type in ('end_gathering', 'end_session', 'complete_gathering', 'complete_session')
        and v_dependency.operation_type in ('start_gathering', 'switch_gathering', 'start_session')
        and coalesce(
          nullif(v_dependency.payload->>'navigationRequestId', ''),
          v_dependency.operation_id::text
        ) = v_session_id::text
      )
    ) and v_dependency.status <> 'accepted' then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at,
        case when v_dependency.operation_type in ('start_gathering', 'switch_gathering', 'start_session')
             and p_operation_type = 'record_arrival'
             then 'dependency_failed' else 'invalid_transition' end,
        'a prerequisite operation for this resource failed', null, null,
        v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
  end loop;
  -- Determine the target before version checks so role/scope failures cannot
  -- reveal a server snapshot to an unauthorized actor.
  if p_operation_type in (
       'start_gathering', 'switch_gathering', 'end_gathering',
       'complete_gathering', 'start_session', 'end_session', 'complete_session'
     ) then
    begin
      v_destination_id := coalesce(
        nullif(v_payload->>'activeDestinationId', '')::uuid,
        nullif(v_payload->>'destinationId', '')::uuid
      );
    exception when others then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'validation', 'invalid destination id',
        null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end;
    if p_operation_type in ('complete_gathering','complete_session')
       and v_session_id is null then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'session_required',
        'end and complete operations require the original sessionId',
        null, null, v_device_id, v_scope_key, null, v_occurred_at
      );
    end if;
    -- Scope is an explicit authority boundary.  The top-level leader may
    -- manage a named subgroup, while a subgroup leader may manage only its
    -- own lane.  An omitted scope still resolves to main above.
    select public.can_manage_itinerary_scope(
      p_group_id, v_scope_subgroup_id, v_uid
    ) into v_is_scope_leader;
    if not v_is_scope_leader then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'scope leader membership required', null, null,
        v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
  elsif p_operation_type in ('add_destination','edit_destination','delete_destination',
                             'reorder_destinations','set_destination_meet_time',
                             'complete_destination') then
    if p_operation_type = 'reorder_destinations' then
      -- Reorder is a batch.  Do not interpret itinerary entity_id (the group
      -- UUID) as one destination; each row is scope-checked below before the
      -- locked reorder RPC is called.
      if jsonb_typeof(v_payload->'updates') <> 'array'
         or jsonb_array_length(v_payload->'updates') = 0 then
        return public.core_v3_conflict(
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload, p_sequence,
          p_dependency_ids, p_created_at, 'validation', 'invalid reorder batch',
          null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at
        );
      end if;
      for v_item_json in select value from jsonb_array_elements(v_payload->'updates')
      loop
        begin
          v_destination_id := nullif(v_item_json->>'id', '')::uuid;
        exception when others then
          return public.core_v3_conflict(
            p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
            p_entity_version, p_operation_type, v_payload, p_sequence,
            p_dependency_ids, p_created_at, 'validation', 'invalid reorder destination id',
            null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at
          );
        end;
        select i.subgroup_id, i.closed_at into v_target_scope, v_closed_at
        from public.itinerary_items i
        where i.id = v_destination_id and i.group_id = p_group_id;
        if not found then
          return public.core_v3_conflict(
            p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
            p_entity_version, p_operation_type, v_payload, p_sequence,
            p_dependency_ids, p_created_at, 'target_deleted',
            'reorder destination no longer exists', null, null,
            v_device_id, v_scope_key, v_session_id, v_occurred_at
          );
        end if;
        if v_closed_at is not null then
          return public.core_v3_conflict(
            p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
            p_entity_version, p_operation_type, v_payload, p_sequence,
            p_dependency_ids, p_created_at, 'validation',
            'cannot reorder closed itinerary item', null, null,
            v_device_id, v_scope_key, v_session_id, v_occurred_at
          );
        end if;
        if not public.can_manage_itinerary_scope(p_group_id, v_target_scope, v_uid) then
          return public.core_v3_conflict(
            p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
            p_entity_version, p_operation_type, v_payload, p_sequence,
            p_dependency_ids, p_created_at, 'unauthorized',
            'reorder destination scope is not writable', null, null,
            v_device_id, v_scope_key, v_session_id, v_occurred_at
          );
        end if;
      end loop;
    else
    begin
      v_destination_id := coalesce(nullif(v_payload->>'destinationId', '')::uuid,
                                   case when p_operation_type <> 'add_destination'
                                        then p_entity_id::uuid else null end);
    exception when others then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'validation', 'invalid destination id',
        null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end;
    if p_operation_type = 'add_destination' then
      v_target_scope := v_scope_subgroup_id;
    else
      select i.subgroup_id into v_target_scope
      from public.itinerary_items i
      where i.id = v_destination_id and i.group_id = p_group_id;
      if not found then
        return public.core_v3_conflict(
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload, p_sequence,
          p_dependency_ids, p_created_at, 'target_deleted',
          'destination no longer exists', v_server_version, null,
          v_device_id, v_scope_key, v_session_id, v_occurred_at
        );
      end if;
    end if;
    if v_target_scope is distinct from v_scope_subgroup_id then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'scope_mismatch',
        'destination does not belong to the requested scope', null, null,
        v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
    if not public.can_manage_itinerary_scope(p_group_id, v_target_scope, v_uid) then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'itinerary scope leader required', null, null,
        v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
    end if;
  elsif p_operation_type = 'set_navigation_response' then
    if nullif(v_payload->>'userId', '') is distinct from v_uid::text then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'navigation response is user-scoped', null, null,
        v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
  elsif p_operation_type = 'resolve_gather_point_request' then
    begin
      v_request_id := nullif(v_payload->>'requestId', '')::uuid;
    exception when others then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'validation', 'invalid request id',
        null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end;
    select * into v_request from public.gather_point_requests r
    where r.id = v_request_id;
    if not found or v_request.group_id <> p_group_id then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'target_deleted',
        'request does not belong to group', null, null,
        v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
    if not public.can_manage_itinerary_scope(p_group_id, v_request.subgroup_id, v_uid) then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'request scope leader required', null, null,
        v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
  elsif p_operation_type = 'submit_gather_point_request' then
    begin
      v_target_scope := nullif(v_payload->>'subgroupId', '')::uuid;
    exception when others then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'validation', 'invalid subgroup id',
        null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end;
    if v_target_scope is not null and not exists (
      select 1 from public.subgroups s
      where s.id = v_target_scope and s.group_id = p_group_id
    ) then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'validation', 'subgroup does not belong to group',
        null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
    if not exists (
      select 1 from public.memberships m
      where m.group_id = p_group_id and m.user_id = v_uid
        and m.subgroup_id is not distinct from v_target_scope
    ) then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'request subgroup must match membership', null, null,
        v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
  elsif p_operation_type = 'record_arrival' and not v_is_leader_correction then
    if v_session_id is null then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'session_required',
        'arrival must name the original navigation session', null, null,
        v_device_id, v_scope_key, null, v_occurred_at
      );
    end if;
    select * into v_session
    from public.navigation_sessions s
    where s.id = v_session_id and s.group_id = p_group_id
    for update;
    if not found then
      -- A missing session is retryable only while its target scope and
      -- destination still exist.  Empty-subgroup cleanup and destination
      -- deletion are terminal facts even when the original start receipt was
      -- never uploaded to this device.
      if v_scope_subgroup_id is not null and not exists (
        select 1 from public.subgroups s
        where s.id = v_scope_subgroup_id and s.group_id = p_group_id
      ) then
        return public.core_v3_conflict(
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload, p_sequence,
          p_dependency_ids, p_created_at, 'scope_deleted',
          'arrival scope no longer exists', null, null,
          v_device_id, v_scope_key, v_session_id, v_occurred_at
        );
      end if;
      select i.subgroup_id into v_target_scope
      from public.itinerary_items i
      where i.id::text = p_entity_id and i.group_id = p_group_id;
      if not found then
        return public.core_v3_conflict(
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload, p_sequence,
          p_dependency_ids, p_created_at, 'target_deleted',
          'arrival destination no longer exists', null, null,
          v_device_id, v_scope_key, v_session_id, v_occurred_at
        );
      end if;
      if v_target_scope is distinct from v_scope_subgroup_id then
        return public.core_v3_conflict(
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload, p_sequence,
          p_dependency_ids, p_created_at, 'scope_mismatch',
          'arrival destination is outside the requested scope', null, null,
          v_device_id, v_scope_key, v_session_id, v_occurred_at
        );
      end if;
      -- A start may still be queued on another device.  Keep the arrival
      -- retryable while that prerequisite is absent; if the same start was
      -- durably rejected, propagate a terminal dependency_failed notice.
      select o.* into v_dependency
      from public.core_operations o
      where o.group_id = p_group_id
        and o.operation_type in ('start_gathering', 'switch_gathering', 'start_session')
        and (
          o.operation_id = v_session_id
          or o.payload->>'navigationRequestId' = v_session_id::text
          or o.session_id = v_session_id
        )
      order by o.created_at desc
      limit 1;
      if found and v_dependency.status = 'conflict' then
        return public.core_v3_conflict(
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload, p_sequence,
          p_dependency_ids, p_created_at, 'dependency_failed',
          'the navigation session start was rejected', null, null,
          v_device_id, v_scope_key, v_session_id, v_occurred_at
        );
      end if;
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'dependency_missing',
        'navigation session start has not been received yet', null, null,
        v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
    if v_session.status not in ('active', 'completed', 'cancelled', 'expired') then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'session_closed',
        'arrival session is no longer available for history', null, null,
        v_device_id, v_session.scope_key, v_session_id, v_occurred_at
      );
    end if;
    if v_session.destination_id is distinct from p_entity_id::uuid then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'session_mismatch',
        'arrival destination does not match its session', null, null,
        v_device_id, v_session.scope_key, v_session_id, v_occurred_at
      );
    end if;
    if not exists (
      select 1 from public.navigation_member_states n
      where n.navigation_session_id = v_session_id and n.user_id = v_uid
    ) then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'not_session_member',
        'actor was not a member of the original session', null, null,
        v_device_id, v_session.scope_key, v_session_id, v_occurred_at
      );
    end if;
    v_scope_subgroup_id := v_session.scope_subgroup_id;
    v_scope_key := v_session.scope_key;
  elsif p_operation_type in ('leader_correct_arrival','correct_arrival')
        or v_is_leader_correction then
    if v_session_id is null then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'session_required',
        'leader correction requires the completed sessionId', null, null,
        v_device_id, v_scope_key, null, v_occurred_at
      );
    end if;
    select * into v_session from public.navigation_sessions s
    where s.id = v_session_id and s.group_id = p_group_id for update;
    if not found or v_session.status <> 'completed'
       or v_session.scope_subgroup_id is not null then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'history_not_correctable',
        'only completed main-team history can be corrected', null, null,
        v_device_id, v_scope_key, v_session_id, v_occurred_at
      );
    end if;
    if not public.can_manage_itinerary_scope(p_group_id, null, v_uid) then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'main-team leader required for history correction', null, null,
        v_device_id, 'main', v_session_id, v_occurred_at
      );
    end if;
    v_target_user_id := coalesce(
      nullif(v_payload->>'targetUserId', '')::uuid,
      nullif(v_payload->>'userId', '')::uuid
    );
    if not exists (
      select 1 from public.navigation_member_states n
      where n.navigation_session_id = v_session_id and n.user_id = v_target_user_id
    ) then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'not_session_member',
        'target was not in the completed session', null, null,
        v_device_id, 'main', v_session_id, v_occurred_at
      );
    end if;
  elsif p_operation_type = 'send_command' then
    if not v_is_member then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized', 'not a group member',
        null, null, v_device_id, v_scope_key, null, v_occurred_at
      );
    end if;
    v_skip_version := true;
  end if;

  -- Arrival and transition operations are operation-level merges.  A stale
  -- snapshot does not replace the server document or block unrelated edits.
  v_mergeable := p_operation_type in (
    'add_destination','edit_destination','delete_destination',
    'set_destination_meet_time','record_arrival','leader_correct_arrival',
    'correct_arrival','send_command','start_gathering','switch_gathering',
    'end_gathering','complete_gathering','start_session','end_session',
    'complete_session','complete_destination','reorder_destinations',
    'set_navigation_response','submit_gather_point_request',
    'resolve_gather_point_request','replace_snapshot'
  );
  insert into public.core_entity_versions(
    group_id, entity_type, entity_id, entity_version, state, updated_at
  ) values (
    p_group_id, p_entity_type, p_entity_id, 0,
    case when p_entity_type = 'itinerary' and p_entity_id = p_group_id::text
         then public.core_itinerary_state(p_group_id) else '{}'::jsonb end,
    now()
  ) on conflict (group_id, entity_type, entity_id) do nothing;
  select * into v_row
  from public.core_entity_versions
  where group_id = p_group_id and entity_type = p_entity_type
    and entity_id = p_entity_id
  for update;
  v_server_version := coalesce(v_row.entity_version, 0);
  if not v_mergeable and v_server_version <> p_entity_version then
    return public.core_v3_conflict(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, 'stale_version',
      'entity version mismatch', v_server_version, v_row.state,
      v_device_id, v_scope_key, v_session_id, v_occurred_at
    );
  end if;
  v_next_version := v_server_version + 1;

  begin
    if p_operation_type in ('start_gathering','switch_gathering','start_session') then
      if v_destination_id is null then
        raise exception 'start requires destinationId' using errcode = '22023';
      end if;
      select * into v_item from public.itinerary_items i
      where i.id = v_destination_id and i.group_id = p_group_id for update;
      if not found or v_item.closed_at is not null
         or v_item.latitude is null or v_item.longitude is null
         or v_item.day is null then
        raise exception 'destination is missing, closed, unscheduled, or has no coordinates'
          using errcode = '55000';
      end if;
      if v_item.subgroup_id is distinct from v_scope_subgroup_id then
        raise exception 'destination scope mismatch' using errcode = '42501';
      end if;
      select * into v_active
      from public.navigation_sessions s
      where s.group_id = p_group_id and s.scope_key = v_scope_key and s.status = 'active'
      order by s.started_at desc limit 1 for update;
      if found then
        update public.navigation_sessions
        set status = 'cancelled', ended_at = now(), version = version + 1, updated_at = now()
        where id = v_active.id;
        update public.navigation_member_states n
        set local_status = case when n.local_status = 'arrived' then 'arrived' else 'missed' end,
            detail = coalesce(n.detail, '{}'::jsonb)
              || jsonb_build_object('reason', 'session_replaced'),
            updated_at = now()
        where n.navigation_session_id = v_active.id and n.local_status <> 'arrived';
      end if;
      -- Starting the same card again resets current-session arrivals.  The
      -- old session's events/history remain immutable.
      delete from public.destination_arrivals
      where destination_id = v_destination_id
        and (navigation_session_id is null or navigation_session_id = coalesce(v_active.id, navigation_session_id));
      insert into public.navigation_sessions(
        id, group_id, destination_id, destination_name,
        destination_latitude, destination_longitude, started_by, request_id,
        scope_subgroup_id, scope_key
      ) values (
        v_session_id, p_group_id, v_destination_id, v_item.title, v_item.latitude,
        v_item.longitude, v_uid, v_request_id,
        v_scope_subgroup_id, v_scope_key
      ) returning * into v_session;
      -- The legacy session trigger seeds every group member.  Trim that
      -- compatibility seed to the requested lane before applying the v3
      -- scope-specific membership projection.
      delete from public.navigation_member_states n
      where n.navigation_session_id = v_session.id
        and not exists (
          select 1 from public.memberships m
          where m.group_id = p_group_id
            and m.user_id = n.user_id
            and m.subgroup_id is not distinct from v_scope_subgroup_id
        );
      insert into public.navigation_member_states(navigation_session_id, user_id)
      select v_session.id, m.user_id
      from public.memberships m
      where m.group_id = p_group_id
        and m.subgroup_id is not distinct from v_scope_subgroup_id
      on conflict (navigation_session_id, user_id) do nothing;
      insert into public.navigation_scope_states(
        group_id, scope_key, scope_subgroup_id, journey_state,
        active_session_id, version, updated_at
      ) values (
        p_group_id, v_scope_key, v_scope_subgroup_id, 'active', v_session.id, 1, now()
      ) on conflict (group_id, scope_key) do update
      set journey_state = 'active', active_session_id = excluded.active_session_id,
          version = public.navigation_scope_states.version + 1, updated_at = now();
      if v_scope_subgroup_id is null then
        update public.groups set journey_status = 'going',
          active_destination_id = v_destination_id,
          journey_started_at = v_session.started_at
        where id = p_group_id;
      end if;
      v_session_id := v_session.id;
      v_point_statuses := coalesce(v_row.state->'pointStatuses', '{}'::jsonb)
        || jsonb_build_object(v_destination_id::text, 'en_route');
      v_state := jsonb_build_object('sessionId', v_session.id::text,
                                    'navigationSessionId', v_session.id::text,
                                    'groupId', p_group_id::text,
                                    'journeyPhase', 'en_route',
                                    'journeyStatus', 'going',
                                    'scope', v_scope_key,
                                    'status', v_session.status,
                                    'destinationId', v_destination_id::text,
                                    'activeDestinationId', v_destination_id::text,
                                    'pointStatuses', v_point_statuses,
                                    'phaseChangedAt', (extract(epoch from v_session.started_at) * 1000)::bigint,
                                    'version', v_session.version,
                                    'entityVersion', v_next_version);
      v_effects := jsonb_build_object('navigationSessionId', v_session.id::text,
                                      'navigationSession', to_jsonb(v_session));

    elsif p_operation_type in ('end_gathering','end_session') then
      -- End is idempotent and scoped to the original session. A stale device
      -- may dismiss locally even when that session was removed server-side.
      if v_session_id is null and nullif(v_payload->>'expectedSessionStartedAt', '') is null
         and exists (select 1 from public.navigation_sessions where group_id = p_group_id
                     and scope_key = v_scope_key and status = 'active') then
        return public.core_v3_conflict(
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload, p_sequence,
          p_dependency_ids, p_created_at, 'dependency_missing',
          'original navigation session identity is not available yet', null, null,
          v_device_id, v_scope_key, v_session_id, v_occurred_at
        );
      end if;
      -- A loading client may only know the original destination/start time.
      -- Resolve that exact identity, never the current session of the scope.
      if v_session_id is null and nullif(v_payload->>'expectedSessionStartedAt', '') is not null then
        select (array_agg(id))[1] into v_session_id from public.navigation_sessions
        where group_id = p_group_id and scope_key = v_scope_key
          and destination_id = nullif(v_payload->>'activeDestinationId', '')::uuid
          and (extract(epoch from started_at) * 1000)::bigint
            = (extract(epoch from (v_payload->>'expectedSessionStartedAt')::timestamptz) * 1000)::bigint
        having count(*) = 1;
        if v_session_id is null and exists (
          select 1 from public.navigation_sessions where group_id = p_group_id
          and scope_key = v_scope_key and status = 'active'
          and destination_id = nullif(v_payload->>'activeDestinationId', '')::uuid
          and (extract(epoch from started_at) * 1000)::bigint
            = (extract(epoch from (v_payload->>'expectedSessionStartedAt')::timestamptz) * 1000)::bigint
        ) then
          return public.core_v3_conflict(
            p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
            p_entity_version, p_operation_type, v_payload, p_sequence,
            p_dependency_ids, p_created_at, 'dependency_missing',
            'original session identity is ambiguous', null, null,
            v_device_id, v_scope_key, v_session_id, v_occurred_at
          );
        end if;
      end if;
      select * into v_session from public.navigation_sessions s
      where s.id = v_session_id and s.group_id = p_group_id for update;
      if found and v_session.scope_key <> v_scope_key then
        raise exception 'session scope mismatch' using errcode = '42501';
      end if;
      if v_session.id is not null and v_session.status = 'active' then
        update public.navigation_sessions
        set status = 'cancelled', ended_at = now(), version = version + 1, updated_at = now()
        where id = v_session.id returning * into v_session;
      end if;

      -- A null or obsolete ID must never select whichever session is active
      -- now. The row lock acquired above for this scope serializes End/Start.
      update public.navigation_scope_states
      set journey_state = 'idle', active_session_id = null,
          version = version + 1, updated_at = now()
      where group_id = p_group_id and scope_key = v_scope_key
        and active_session_id = v_session_id;
      if found and v_scope_subgroup_id is null then
        update public.groups set journey_status = 'paused', active_destination_id = null,
          journey_started_at = null where id = p_group_id;
      end if;

      v_state := coalesce(v_row.state, '{}'::jsonb);
      -- Keep the current entity when the event refers to an older session.
      if coalesce(v_state->>'navigationSessionId', v_state->>'sessionId', '') = coalesce(v_session_id::text, '')
         or (v_state = '{}'::jsonb) then
        v_point_statuses := coalesce(v_state->'pointStatuses', '{}'::jsonb);
        v_destination_id := coalesce(v_session.destination_id, v_destination_id);
        if v_destination_id is not null
           and coalesce(v_point_statuses->>v_destination_id::text, '') <> 'completed' then
          v_point_statuses := v_point_statuses || jsonb_build_object(v_destination_id::text, 'pending');
        end if;
        v_state := v_state || jsonb_build_object(
          'sessionId', v_session_id, 'navigationSessionId', v_session_id,
          'groupId', p_group_id::text, 'journeyPhase', 'staying',
          'journeyStatus', 'paused', 'scope', v_scope_key,
          'status', coalesce(v_session.status, 'cancelled'),
          'destinationId', v_destination_id, 'activeDestinationId', null,
          'pointStatuses', v_point_statuses,
          'phaseChangedAt', (extract(epoch from coalesce(v_session.ended_at, now())) * 1000)::bigint);
      end if;
      v_state := v_state || jsonb_build_object('entityVersion', v_next_version);

    elsif p_operation_type in ('complete_gathering','complete_session','complete_destination') then
      if v_session_id is null and p_operation_type = 'complete_destination' then
        select id into v_session_id from public.navigation_sessions
        where group_id = p_group_id and destination_id = v_destination_id
          and scope_key = v_scope_key and status = 'active'
        order by started_at desc limit 1;
      end if;
      select * into v_session from public.navigation_sessions s
      where s.id = v_session_id and s.group_id = p_group_id for update;
      if not found then raise exception 'navigation session not found' using errcode = 'P0002'; end if;
      if v_session.scope_key <> v_scope_key then
        raise exception 'session scope mismatch' using errcode = '42501';
      end if;
      if v_session.status = 'cancelled' or v_session.status = 'expired' then
        raise exception 'cannot complete a cancelled navigation session' using errcode = '55000';
      end if;
      if v_session.status = 'active' then
        update public.navigation_sessions
        set status = 'completed', ended_at = now(), version = version + 1, updated_at = now()
        where id = v_session.id returning * into v_session;
        update public.itinerary_items
        set closed_at = coalesce(closed_at, v_session.ended_at, now()),
            closed_by_session_id = coalesce(closed_by_session_id, v_session.id)
        where id = v_session.destination_id and group_id = p_group_id;
        update public.navigation_scope_states
        set journey_state = 'idle', active_session_id = null,
            version = version + 1, updated_at = now()
        where group_id = p_group_id and scope_key = v_scope_key
          and active_session_id = v_session.id;
        if v_scope_subgroup_id is null then
          update public.groups set journey_status = 'paused', active_destination_id = null,
            journey_started_at = null
          where id = p_group_id and active_destination_id = v_session.destination_id;
        end if;
      end if;
      insert into public.navigation_session_history(
        group_id, navigation_session_id, destination_id, user_id,
        arrived, arrived_at, recorded_at
      )
      select p_group_id, v_session.id, v_session.destination_id, m.user_id,
        exists (select 1 from public.destination_arrivals a
                where a.destination_id = v_session.destination_id
                  and a.user_id = m.user_id
                  and a.navigation_session_id = v_session.id),
        (select a.arrived_at from public.destination_arrivals a
         where a.destination_id = v_session.destination_id
           and a.user_id = m.user_id
           and a.navigation_session_id = v_session.id),
        coalesce(v_session.ended_at, now())
      from public.memberships m
      where m.group_id = p_group_id
        and m.subgroup_id is not distinct from v_session.scope_subgroup_id
      on conflict (navigation_session_id, user_id) do nothing;
      -- visited_waypoints is the main-team permanent history.  A subgroup
      -- completion remains in its scoped session/audit rows and must not
      -- leak into the main team's history projection.
      if v_session.scope_subgroup_id is null then
        insert into public.visited_waypoints(
          user_id, group_id, destination_id, navigation_session_id,
          name, latitude, longitude, arrived_at
        )
        select h.user_id, h.group_id, h.destination_id, h.navigation_session_id,
          coalesce(v_session.destination_name, '集合點'),
          coalesce(v_session.destination_latitude, 0),
          coalesce(v_session.destination_longitude, 0),
          h.arrived_at
        from public.navigation_session_history h
        where h.navigation_session_id = v_session.id
          and h.arrived
        on conflict (group_id, destination_id, user_id)
          where destination_id is not null and group_id is not null
        do update set navigation_session_id = excluded.navigation_session_id,
                      name = excluded.name,
                      latitude = excluded.latitude,
                      longitude = excluded.longitude,
                      arrived_at = excluded.arrived_at;
      end if;
      v_state := jsonb_build_object('sessionId', v_session.id::text,
                                    'navigationSessionId', v_session.id::text,
                                    'groupId', p_group_id::text,
                                    'journeyPhase', 'staying',
                                    'journeyStatus', 'paused',
                                    'scope', v_session.scope_key,
                                    'status', v_session.status,
                                    'destinationId', v_session.destination_id,
                                    'activeDestinationId', null,
                                    'pointStatuses',
                                      coalesce(v_row.state->'pointStatuses', '{}'::jsonb)
                                      || jsonb_build_object(v_session.destination_id::text, 'completed'),
                                    'phaseChangedAt', (extract(epoch from coalesce(v_session.ended_at, now())) * 1000)::bigint,
                                    'entityVersion', v_next_version);
      v_effects := jsonb_build_object('historySessionId', v_session.id::text);

    elsif p_operation_type = 'set_navigation_response' then
      -- Personal responses are independent of team journey state.  Keep the
      -- established navigation_response shape so old snapshot projection can
      -- consume the v3 receipt unchanged.
      v_state := jsonb_build_object(
        'sessionId', coalesce(v_payload->>'sessionId', v_payload->>'navigationSessionId'),
        'userId', v_uid::text,
        'groupId', p_group_id::text,
        'response', v_payload->'response',
        'entityVersion', v_next_version,
        'updatedAt', (extract(epoch from v_received_at) * 1000)::bigint
      );

    elsif p_operation_type = 'submit_gather_point_request' then
      begin
        v_request_id := coalesce(nullif(v_payload->>'requestId', '')::uuid, p_entity_id::uuid);
      exception when others then
        raise exception 'invalid request id' using errcode = '22023';
      end;
      if v_request_id::text is distinct from p_entity_id then
        raise exception 'request id does not match operation entity' using errcode = '22023';
      end if;
      if jsonb_typeof(v_payload->'items') <> 'array'
         or jsonb_array_length(v_payload->'items') not between 1 and 100 then
        raise exception 'request items must contain 1 to 100 entries' using errcode = '22023';
      end if;
      insert into public.gather_point_requests(
        id, group_id, subgroup_id, requester_id, items
      ) values (
        v_request_id, p_group_id, nullif(v_payload->>'subgroupId', '')::uuid,
        v_uid, v_payload->'items'
      ) on conflict (id) do nothing;
      select * into v_request from public.gather_point_requests
      where id = v_request_id;
      if not found or v_request.group_id <> p_group_id
         or v_request.requester_id <> v_uid then
        raise exception 'request id is already owned by another group or actor'
          using errcode = '42501';
      end if;
      v_state := to_jsonb(v_request);
      v_effects := jsonb_build_object('requestId', v_request_id::text);

    elsif p_operation_type = 'resolve_gather_point_request' then
      begin
        v_request_id := nullif(v_payload->>'requestId', '')::uuid;
      exception when others then
        raise exception 'invalid request id' using errcode = '22023';
      end;
      if v_request_id is null or v_request_id::text is distinct from p_entity_id then
        raise exception 'request id does not match operation entity' using errcode = '22023';
      end if;
      select * into v_request from public.gather_point_requests
      where id = v_request_id for update;
      if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
      if v_request.status <> 'pending' then
        raise exception 'request already resolved' using errcode = '23505';
      end if;
      -- Resolve directly instead of delegating to the legacy main-leader-only
      -- RPC, so a subgroup leader may resolve a request in its own scope.
      if coalesce((v_payload->>'approve')::boolean, false) then
        select coalesce(max(i.position), -1) into v_position
        from public.itinerary_items i
        where i.group_id = p_group_id
          and i.subgroup_id is not distinct from v_request.subgroup_id;
        for v_item_json in select value from jsonb_array_elements(v_request.items)
        loop
          v_position := v_position + 1;
          if jsonb_typeof(v_item_json->'latitude') <> 'number'
             or jsonb_typeof(v_item_json->'longitude') <> 'number'
             or nullif(btrim(v_item_json->>'title'), '') is null then
            raise exception 'invalid gathering point' using errcode = '22023';
          end if;
          insert into public.itinerary_items(
            group_id, subgroup_id, title, address, day, latitude, longitude,
            position, kind, stay_anchor, created_by
          ) values (
            p_group_id, v_request.subgroup_id,
            btrim(v_item_json->>'title'), nullif(v_item_json->>'address', ''),
            greatest(1, coalesce((v_item_json->>'day')::integer, 1)),
            (v_item_json->>'latitude')::double precision,
            (v_item_json->>'longitude')::double precision,
            v_position, 'stop', false, v_uid
          );
        end loop;
      end if;
      update public.gather_point_requests
      set status = case when coalesce((v_payload->>'approve')::boolean, false)
                        then 'approved' else 'rejected' end,
          reviewed_by = v_uid, reviewed_at = v_received_at
      where id = v_request_id
      returning * into v_request;
      v_state := to_jsonb(v_request);
      v_effects := jsonb_build_object('requestId', v_request_id::text);

    elsif p_operation_type = 'record_arrival' and not v_is_leader_correction then
      v_arrived := coalesce((v_payload->>'arrived')::boolean, true);
      begin
        v_arrived_at := nullif(v_payload->>'arrivedAt', '')::timestamptz;
      exception when others then
        raise exception 'invalid arrivedAt' using errcode = '22023';
      end;
      v_source := case when coalesce(v_payload->>'source', '') = 'automatic'
                       then 'automatic' else 'manual' end;
      insert into public.navigation_arrival_events(
        operation_id, group_id, navigation_session_id, destination_id,
        user_id, actor_id, event_kind, arrived, arrived_at, source,
        device_id, client_sequence, occurred_at, received_at
      ) values (
        p_operation_id, p_group_id, v_session.id, v_session.destination_id,
        v_uid, v_uid, 'arrival', v_arrived, v_arrived_at, v_source,
        v_device_id, p_sequence, v_occurred_at, v_received_at
      ) returning id into v_event_id;
      -- Keep the raw client time for audit, but do not let a device clock
      -- that is ahead of the server move the live projection backwards or
      -- suppress a later leader correction.  Same-device client_sequence is
      -- still the primary ordering signal below.
      select event_sequence, least(coalesce(occurred_at, received_at), received_at)
        into v_event_sequence, v_event_order
      from public.navigation_arrival_events
      where id = v_event_id;
      select not exists (
        select 1
        from public.navigation_arrival_events e
        where e.navigation_session_id = v_session.id
          and e.user_id = v_uid
          and e.id <> v_event_id
          and (
            (
              v_device_id is not null and e.device_id is not null
              and e.device_id = v_device_id
              and e.client_sequence is not null and e.client_sequence > p_sequence
            )
            or (
              not (v_device_id is not null and e.device_id is not null
                   and e.device_id = v_device_id
                   and e.client_sequence is not null)
              and case when e.event_kind = 'leader_correction'
                       then coalesce(e.corrected_at, e.received_at)
                       else least(coalesce(e.occurred_at, e.received_at), e.received_at)
                  end > v_event_order
            )
            or (
              not (v_device_id is not null and e.device_id is not null
                   and e.device_id = v_device_id
                   and e.client_sequence is not null)
              and case when e.event_kind = 'leader_correction'
                       then coalesce(e.corrected_at, e.received_at)
                       else least(coalesce(e.occurred_at, e.received_at), e.received_at)
                  end = v_event_order
              and e.event_sequence > v_event_sequence
            )
          )
      ) into v_should_project;
      select * into v_arrival
      from public.destination_arrivals a
      where a.destination_id = v_session.destination_id and a.user_id = v_uid
      for update;
      v_arrival_exists := found;
      v_current_session := v_arrival.navigation_session_id;
      -- A late event from a completed session must not recreate the current
      -- projection after a newer session has started.  The unique arrival row
      -- may have been cleared by that new start, so inspect the live session
      -- independently of destination_arrivals as well.
      select s.id into v_live_session
      from public.navigation_sessions s
      where s.group_id = p_group_id
        and s.destination_id = v_session.destination_id
        and s.scope_key = v_session.scope_key
        and s.status = 'active'
      order by s.started_at desc
      limit 1;
      if v_live_session is not null then
        v_current_session := v_live_session;
      elsif not v_arrival_exists then
        v_current_session := null;
      end if;
      if v_arrived then
        if v_should_project and v_session.status in ('active', 'completed')
           and (v_current_session is null or v_current_session = v_session.id) then
          insert into public.destination_arrivals(
            group_id, destination_id, user_id, navigation_session_id,
            arrived_at, source, marked_by
          ) values (
            p_group_id, v_session.destination_id, v_uid, v_session.id,
            v_arrived_at, v_source, v_uid
          ) on conflict (destination_id, user_id) do update
          set navigation_session_id = excluded.navigation_session_id,
              arrived_at = excluded.arrived_at,
              source = excluded.source,
              marked_by = excluded.marked_by;
        end if;
      elsif v_should_project and v_session.status in ('active', 'completed')
            and v_arrival_exists
            and (v_current_session is null or v_current_session = v_session.id) then
        delete from public.destination_arrivals
        where destination_id = v_session.destination_id and user_id = v_uid;
      end if;
      if v_should_project then
        insert into public.navigation_session_history(
          group_id, navigation_session_id, destination_id, user_id,
          arrived, arrived_at, recorded_at
        ) values (
          p_group_id, v_session.id, v_session.destination_id, v_uid,
          v_arrived, v_arrived_at, v_received_at
        ) on conflict (navigation_session_id, user_id) do update
        set arrived = excluded.arrived,
            arrived_at = excluded.arrived_at,
            recorded_at = excluded.recorded_at;
        if v_session.status in ('active', 'completed') then
          update public.navigation_member_states
          set local_status = case when v_arrived then 'arrived' else 'pending' end,
              arrived_at = case when v_arrived then v_arrived_at else null end,
              updated_at = v_received_at
          where navigation_session_id = v_session.id and user_id = v_uid;
        end if;
        -- visited_waypoints is the main-team permanent history projection.
        -- Keep it aligned with the winning event, including late events for a
        -- completed/cancelled session, but never let an old session overwrite
        -- a newer active session for the same destination.
        if v_session.scope_subgroup_id is null
           and (v_current_session is null or v_current_session = v_session.id) then
          if v_arrived then
            insert into public.visited_waypoints(
              user_id, group_id, destination_id, navigation_session_id,
              name, latitude, longitude, arrived_at
            ) values (
              v_uid, p_group_id, v_session.destination_id, v_session.id,
              coalesce(v_session.destination_name, '集合點'),
              coalesce(v_session.destination_latitude, 0),
              coalesce(v_session.destination_longitude, 0), v_arrived_at
            ) on conflict (group_id, destination_id, user_id)
              where destination_id is not null and group_id is not null
            do update set navigation_session_id = excluded.navigation_session_id,
                          name = excluded.name,
                          latitude = excluded.latitude,
                          longitude = excluded.longitude,
                          arrived_at = excluded.arrived_at;
          else
            delete from public.visited_waypoints
            where group_id = p_group_id
              and destination_id = v_session.destination_id
              and user_id = v_uid
              and (navigation_session_id is null or navigation_session_id = v_session.id);
          end if;
        end if;
      end if;
      v_state := jsonb_build_object('sessionId', v_session.id::text,
                                    'destinationId', v_session.destination_id::text,
                                    'userId', v_uid::text,
                                    'arrived', v_arrived,
                                    'arrivedAt', v_arrived_at,
                                    'appliedToCurrentSession',
                                      (v_should_project and v_session.status in ('active', 'completed')
                                       and (v_current_session is null or v_current_session = v_session.id)));

    elsif p_operation_type in ('leader_correct_arrival','correct_arrival')
          or v_is_leader_correction then
      v_arrived := coalesce((v_payload->>'arrived')::boolean, false);
      v_target_user_id := coalesce(
        nullif(v_payload->>'targetUserId', '')::uuid,
        nullif(v_payload->>'userId', '')::uuid
      );
      insert into public.navigation_arrival_events(
        operation_id, group_id, navigation_session_id, destination_id,
        user_id, actor_id, event_kind, arrived, arrived_at, source,
        device_id, client_sequence, occurred_at, received_at, corrected_at, correction_note
      ) values (
        p_operation_id, p_group_id, v_session.id, v_session.destination_id,
        v_target_user_id, v_uid, 'leader_correction', v_arrived, null,
        'leader_correction', v_device_id, p_sequence, v_occurred_at, v_received_at, v_received_at,
        nullif(v_payload->>'note', '')
      ) returning id into v_event_id;
      select not exists (
        select 1
        from public.navigation_arrival_events e
        where e.navigation_session_id = v_session.id
          and e.user_id = v_target_user_id
          and e.id <> v_event_id
          and (
            (
              v_device_id is not null and e.device_id is not null
              and e.device_id = v_device_id
              and e.client_sequence is not null and e.client_sequence > p_sequence
            )
            or (
              not (v_device_id is not null and e.device_id is not null
                   and e.device_id = v_device_id
                   and e.client_sequence is not null)
              and case when e.event_kind = 'leader_correction'
                       then coalesce(e.corrected_at, e.received_at)
                       else least(coalesce(e.occurred_at, e.received_at), e.received_at)
                  end > v_received_at
            )
            or (
              not (v_device_id is not null and e.device_id is not null
                   and e.device_id = v_device_id
                   and e.client_sequence is not null)
              and case when e.event_kind = 'leader_correction'
                       then coalesce(e.corrected_at, e.received_at)
                       else least(coalesce(e.occurred_at, e.received_at), e.received_at)
                  end = v_received_at
              and e.event_sequence > (
                select event_sequence from public.navigation_arrival_events
                where id = v_event_id
              )
            )
          )
      ) into v_should_project;
      select a.navigation_session_id into v_current_session
      from public.destination_arrivals a
      where a.destination_id = v_session.destination_id
        and a.user_id = v_target_user_id;
      select s.id into v_live_session
      from public.navigation_sessions s
      where s.group_id = p_group_id and s.destination_id = v_session.destination_id
        and s.scope_key = v_session.scope_key and s.status = 'active'
      order by s.started_at desc limit 1;
      if v_live_session is not null then v_current_session := v_live_session; end if;
      if v_should_project and (v_current_session is null or v_current_session = v_session.id) then
        if v_arrived then
          insert into public.destination_arrivals(
            group_id, destination_id, user_id, navigation_session_id,
            arrived_at, source, marked_by, corrected_at, corrected_by, correction_note
          ) values (
            p_group_id, v_session.destination_id, v_target_user_id, v_session.id,
            null, 'leader_correction', v_uid, v_received_at, v_uid,
            nullif(v_payload->>'note', '')
          ) on conflict (destination_id, user_id) do update
          set navigation_session_id = excluded.navigation_session_id,
              arrived_at = null, source = excluded.source, marked_by = excluded.marked_by,
              corrected_at = excluded.corrected_at, corrected_by = excluded.corrected_by,
              correction_note = excluded.correction_note;
        else
          delete from public.destination_arrivals
          where destination_id = v_session.destination_id and user_id = v_target_user_id
            and (navigation_session_id is null or navigation_session_id = v_session.id);
        end if;
        insert into public.navigation_session_history(
          group_id, navigation_session_id, destination_id, user_id,
          arrived, arrived_at, recorded_at, corrected_at, corrected_by, correction_note
        ) values (
          p_group_id, v_session.id, v_session.destination_id, v_target_user_id,
          v_arrived, null, v_received_at, v_received_at, v_uid,
          nullif(v_payload->>'note', '')
        ) on conflict (navigation_session_id, user_id) do update
        set arrived = excluded.arrived, arrived_at = null,
            corrected_at = excluded.corrected_at, corrected_by = excluded.corrected_by,
            correction_note = excluded.correction_note;
        update public.navigation_member_states
        set local_status = case when v_arrived then 'arrived' else 'missed' end,
            arrived_at = null,
            detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object(
              'correctedAt', v_received_at, 'correctedBy', v_uid::text),
            updated_at = v_received_at
        where navigation_session_id = v_session.id and user_id = v_target_user_id;
        -- A correction is the winning main-session event even though its
        -- physical arrival timestamp is intentionally NULL.  Keep the
        -- permanent projection in lockstep; an out-of-order older event never
        -- reaches this block because v_should_project is false above.
        if v_session.scope_subgroup_id is null then
          if v_arrived then
            insert into public.visited_waypoints(
              user_id, group_id, destination_id, navigation_session_id,
              name, latitude, longitude, arrived_at
            ) values (
              v_target_user_id, p_group_id, v_session.destination_id, v_session.id,
              coalesce(v_session.destination_name, '集合點'),
              coalesce(v_session.destination_latitude, 0),
              coalesce(v_session.destination_longitude, 0), null
            ) on conflict (group_id, destination_id, user_id)
              where destination_id is not null and group_id is not null
            do update set navigation_session_id = excluded.navigation_session_id,
                          name = excluded.name,
                          latitude = excluded.latitude,
                          longitude = excluded.longitude,
                          arrived_at = null;
          else
            delete from public.visited_waypoints
            where group_id = p_group_id
              and destination_id = v_session.destination_id
              and user_id = v_target_user_id
              and (navigation_session_id is null or navigation_session_id = v_session.id);
          end if;
        end if;
      end if;
      v_state := jsonb_build_object('sessionId', v_session.id::text,
        'destinationId', v_session.destination_id::text,
        'targetUserId', v_target_user_id::text, 'arrived', v_arrived,
        'arrivedAt', null, 'correctedAt', v_received_at,
        'correctedBy', v_uid::text);
      v_effects := jsonb_build_object('arrivalEventId', v_event_id::text);

    elsif p_operation_type = 'send_command' then
      v_effects := public.core_v3_enqueue_notification(
        p_operation_id, p_group_id, v_uid, v_scope_subgroup_id,
        v_payload, v_received_at
      );
      v_state := jsonb_build_object('operationId', p_operation_id::text,
                                    'accepted', true,
                                    'expired', (v_effects->>'expiresAt')::timestamptz <= v_received_at);

    elsif p_operation_type = 'replace_snapshot' then
      -- A client snapshot is a recovery hint, never an authority capable of
      -- overwriting server rows.  Accept a receipt and return the current
      -- entity so the caller can rehydrate without a permanent queue stop.
      v_skip_version := true;
      if p_entity_type = 'itinerary' and p_entity_id = p_group_id::text then
        v_state := public.core_itinerary_state(p_group_id);
      else
        v_state := coalesce(v_row.state, '{}'::jsonb);
      end if;
      v_effects := jsonb_build_object('snapshotReplaced', false);

    elsif p_operation_type = 'add_destination' then
      if v_destination_id is null then
        raise exception 'add requires destinationId' using errcode = '22023';
      end if;
      v_provider_id := nullif(btrim(v_payload->>'providerPlaceId'), '');
      v_day := case when v_payload ? 'day' and v_payload->>'day' <> ''
                    then (v_payload->>'day')::integer else null end;
      v_kind := coalesce(nullif(v_payload->>'kind', ''), 'stop');
      if v_kind not in ('stop','accommodation') then
        raise exception 'invalid itinerary kind' using errcode = '22023';
      end if;
      if exists (select 1 from public.itinerary_items where id = v_destination_id) then
        raise exception 'destination id is already in use' using errcode = '23505';
      end if;
      select coalesce(max(i.position), -1) + 1 into v_position
      from public.itinerary_items i
      where i.group_id = p_group_id
        and i.subgroup_id is not distinct from v_scope_subgroup_id
        and i.day is not distinct from v_day;
      insert into public.itinerary_items(
        id, group_id, subgroup_id, title, address, day, latitude, longitude,
        position, kind, stay_anchor, provider_place_id, created_by
      ) values (
        v_destination_id, p_group_id, v_scope_subgroup_id,
        nullif(btrim(v_payload->>'title'), ''),
        nullif(btrim(v_payload->>'address'), ''), v_day,
        (v_payload->>'latitude')::double precision,
        (v_payload->>'longitude')::double precision,
        v_position, v_kind,
        case when v_kind = 'accommodation'
             then coalesce((v_payload->>'stayAnchor')::boolean, false) else false end,
        v_provider_id, v_uid
      );
      v_state := public.core_itinerary_state(p_group_id);

    elsif p_operation_type = 'edit_destination' then
      v_patch := coalesce(v_payload->'patch', '{}'::jsonb);
      if v_patch ? 'latitude' or v_patch ? 'longitude' then
        raise exception 'destination coordinates are immutable' using errcode = '22023';
      end if;
      update public.itinerary_items i
      set title = case when v_patch ? 'title' then nullif(btrim(v_patch->>'title'), '') else i.title end,
          address = case when v_patch ? 'address' then nullif(btrim(v_patch->>'address'), '') else i.address end,
          day = case when v_patch ? 'day' then (v_patch->>'day')::integer else i.day end,
          subgroup_id = case when v_patch ? 'subgroupId' then nullif(v_patch->>'subgroupId', '')::uuid else i.subgroup_id end,
          kind = case when v_patch ? 'kind' then v_patch->>'kind' else i.kind end,
          stay_anchor = case when v_patch ? 'stayAnchor' then (v_patch->>'stayAnchor')::boolean else i.stay_anchor end,
          provider_place_id = case when v_patch ? 'providerPlaceId' then nullif(btrim(v_patch->>'providerPlaceId'), '') else i.provider_place_id end,
          emoji = case when v_patch ? 'emoji' then v_patch->>'emoji' else i.emoji end,
          marker_color = case when v_patch ? 'markerColor' then v_patch->>'markerColor' else i.marker_color end
      where i.id = v_destination_id and i.group_id = p_group_id;
      if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;
      if v_patch ? 'subgroupId' and not public.can_manage_itinerary_scope(
        p_group_id, nullif(v_patch->>'subgroupId', '')::uuid, v_uid
      ) then
        raise exception 'destination subgroup scope is not writable' using errcode = '42501';
      end if;
      v_state := public.core_itinerary_state(p_group_id);

    elsif p_operation_type = 'delete_destination' then
      select * into v_item from public.itinerary_items
      where id = v_destination_id and group_id = p_group_id for update;
      if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;
      select * into v_active from public.navigation_sessions
      where group_id = p_group_id and destination_id = v_destination_id
        and scope_key = v_scope_key and status = 'active'
      for update;
      if found then
        if v_session_id is null or v_active.id <> v_session_id then
          raise exception 'active destination requires the original sessionId before deletion'
            using errcode = '55000';
        end if;
        update public.navigation_sessions
        set status = 'cancelled', ended_at = now(), version = version + 1, updated_at = now()
        where id = v_active.id;
      end if;
      delete from public.itinerary_items where id = v_destination_id and group_id = p_group_id;
      v_state := public.core_itinerary_state(p_group_id);

    elsif p_operation_type = 'set_destination_meet_time' then
      update public.itinerary_items
      set meet_at = nullif(v_payload->>'meetAt', '')::timestamptz,
          meet_red_minutes = case when v_payload ? 'meetRedMinutes'
            then nullif(v_payload->>'meetRedMinutes', '')::integer else meet_red_minutes end
      where id = v_destination_id and group_id = p_group_id;
      if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;
      v_state := public.core_itinerary_state(p_group_id);

    elsif p_operation_type = 'reorder_destinations' then
      -- The existing locked reorder RPC applies a batch against the current
      -- rows; it does not overwrite the complete itinerary snapshot.
      if jsonb_typeof(v_payload->'updates') <> 'array'
         or jsonb_array_length(v_payload->'updates') = 0 then
        raise exception 'invalid reorder batch' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', u->>'id',
          'position', coalesce((u->>'position')::integer, 0),
          'day', case when u ? 'day' then u->'day' else 'null'::jsonb end,
          'meet_at', case when u ? 'meetAt' then u->'meetAt' else 'null'::jsonb end,
          'stay_anchor', case when u ? 'stayAnchor' then u->'stayAnchor' else 'null'::jsonb end
        )
      ), '[]'::jsonb) into v_updates
      from jsonb_array_elements(v_payload->'updates') u;
      perform public.reorder_itinerary_items(p_group_id, v_updates);
      v_state := public.core_itinerary_state(p_group_id);

    else
      raise exception 'unsupported v3 operation type' using errcode = '22023';
    end if;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    if v_sqlstate in ('40001','40P01','57014') then
      raise;
    end if;
    v_conflict_code := case
      when v_sqlstate in ('28000','42501') then 'unauthorized'
      when v_sqlstate in ('22023','22P02','22003','23503','23505','23514',
                          'P0001','P0002','P0004','55000') then 'validation'
      else 'unknown'
    end;
    return public.core_v3_conflict(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, v_conflict_code, v_message,
      v_server_version, v_row.state, v_device_id, v_scope_key,
      v_session_id, v_occurred_at
    );
  end;

  if v_skip_version then
    select * into v_row from public.core_entity_versions
    where group_id = p_group_id and entity_type = p_entity_type and entity_id = p_entity_id;
  else
    if v_state = '{}'::jsonb then v_state := coalesce(v_row.state, '{}'::jsonb); end if;
    update public.core_entity_versions
    set entity_version = v_next_version, state = v_state, updated_at = now()
    where group_id = p_group_id and entity_type = p_entity_type and entity_id = p_entity_id
    returning * into v_row;
  end if;
  if v_state = '{}'::jsonb then v_state := coalesce(v_row.state, '{}'::jsonb); end if;

  if found and v_replay_conflict then
    update public.core_operations
    set base_entity_version = p_entity_version,
        payload = v_payload || jsonb_build_object('_result', v_state, '_effects', v_effects),
        result_entity_version = case when v_skip_version then v_server_version else v_row.entity_version end,
        result_state = v_state, result_effects = v_effects, status = 'accepted',
        client_sequence = p_sequence, dependency_ids = coalesce(p_dependency_ids, '{}'::uuid[]),
        device_id = v_device_id, scope_key = v_scope_key, session_id = v_session_id,
        occurred_at = v_occurred_at, received_at = v_received_at,
        terminal_reason = null, rebase_count = rebase_count + 1,
        resolved_at = v_received_at
    where operation_id = p_operation_id;
  else
    insert into public.core_operations(
      operation_id, group_id, actor_id, entity_type, entity_id,
      base_entity_version, operation_type, payload, result_entity_version,
      status, created_at, client_sequence, dependency_ids, result_state,
      result_effects, device_id, scope_key, session_id, occurred_at,
      received_at, terminal_reason
    ) values (
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type,
      v_payload || jsonb_build_object('_result', v_state, '_effects', v_effects),
      case when v_skip_version then v_server_version else v_row.entity_version end,
      'accepted', coalesce(p_created_at, now()), p_sequence,
      coalesce(p_dependency_ids, '{}'::uuid[]), v_state, v_effects,
      v_device_id, v_scope_key, v_session_id, v_occurred_at,
      v_received_at, null
    );
  end if;
  return jsonb_build_object(
    'status', 'accepted', 'operation_id', p_operation_id,
    'entity_version', case when v_skip_version then v_server_version else v_row.entity_version end,
    'entity', v_state, 'effects', v_effects,
    'rebased', v_replay_conflict
  );
end;
$$;
