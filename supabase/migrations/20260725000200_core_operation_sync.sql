-- OTA-04: versioned core operation ledger for local-first sync.
-- Transport-neutral operation contract applied via RPC; idempotent by
-- operation_id; stale entity versions return structured conflict (not silent overwrite).
-- First-write races use advisory xact locks + zero-row ensure.

create table if not exists public.core_entity_versions (
  group_id uuid not null references public.groups(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'group_snapshot', 'active_gathering', 'navigation_response', 'itinerary'
  )),
  entity_id text not null,
  entity_version integer not null default 0 check (entity_version >= 0),
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (group_id, entity_type, entity_id)
);

create index if not exists core_entity_versions_group
  on public.core_entity_versions(group_id, updated_at desc);

create table if not exists public.core_operations (
  operation_id uuid primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'group_snapshot', 'active_gathering', 'navigation_response', 'itinerary'
  )),
  entity_id text not null,
  base_entity_version integer not null check (base_entity_version >= 0),
  operation_type text not null,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536),
  result_entity_version integer,
  status text not null default 'accepted'
    check (status in ('accepted', 'duplicate', 'conflict')),
  created_at timestamptz not null default now()
);

create index if not exists core_operations_group_created
  on public.core_operations(group_id, created_at desc);
create index if not exists core_operations_entity
  on public.core_operations(group_id, entity_type, entity_id);

alter table public.core_entity_versions enable row level security;
alter table public.core_operations enable row level security;

create policy "core_entity_versions: select if member"
  on public.core_entity_versions for select to authenticated
  using (extensions.is_member(group_id));

create policy "core_operations: select own or leader"
  on public.core_operations for select to authenticated
  using (
    actor_id = (select auth.uid())
    or extensions.is_member(group_id)
  );

grant select on public.core_entity_versions to authenticated;
grant select on public.core_operations to authenticated;

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
  v_key text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_operation_id is null or p_group_id is null
     or p_entity_type is null or p_entity_id is null
     or p_entity_version is null or p_operation_type is null then
    raise exception 'invalid apply_core_operation arguments' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = v_uid
  ) into v_is_member;

  if not v_is_member then
    -- Record unauthorized for idempotent replay consistency.
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
      -- Prefer original conflict metadata stored on the op payload.
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

  -- Ensure a zero-version row exists so FOR UPDATE always locks something.
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
        p_entity_version, p_operation_type, coalesce(p_payload, '{}'::jsonb),
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
    v_active := coalesce(
      p_payload->>'activeDestinationId',
      v_row.state->>'activeDestinationId',
      ''
    );
    v_point_statuses := coalesce(v_row.state->'pointStatuses', '{}'::jsonb);

    if p_operation_type = 'start_gathering' then
      if v_phase = 'en_route' and v_server_version > 0 then
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
          p_entity_version, p_operation_type, coalesce(p_payload, '{}'::jsonb),
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
      -- end_gathering: require en_route regardless of entity version (empty/v0 stays invalid).
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
      -- Complete the currently en_route point (from server state, not post-end cursor).
      v_active := coalesce(v_row.state->>'activeDestinationId', '');
      if v_active <> '' then
        v_point_statuses := v_point_statuses || jsonb_build_object(v_active, 'completed');
      end if;
      -- Prefer client post-end nextDestinationId; else first non-completed key.
      v_next := nullif(p_payload->>'nextDestinationId', '');
      if v_next is null then
        for v_key in select jsonb_object_keys(v_point_statuses)
        loop
          if (v_point_statuses->>v_key) is distinct from 'completed' then
            v_next := v_key;
            exit;
          end if;
        end loop;
      end if;
      if v_next is not null and (v_point_statuses->>v_next) is null then
        v_point_statuses := v_point_statuses || jsonb_build_object(v_next, 'pending');
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

  -- Best-effort bridge onto legacy group columns.
  if p_entity_type = 'active_gathering' and p_operation_type = 'start_gathering' then
    update public.groups g
    set journey_status = 'going',
        active_destination_id = case
          when (v_state->>'activeDestinationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (v_state->>'activeDestinationId')::uuid
          else g.active_destination_id
        end,
        journey_started_at = now()
    where g.id = p_group_id;
  elsif p_entity_type = 'active_gathering' and p_operation_type = 'end_gathering' then
    update public.groups g
    set journey_status = 'paused',
        active_destination_id = case
          when (v_state->>'activeDestinationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (v_state->>'activeDestinationId')::uuid
          else null
        end,
        journey_started_at = null
    where g.id = p_group_id;

    if (v_state ? 'pointStatuses') then
      update public.itinerary_items i
      set closed_at = coalesce(i.closed_at, now())
      where i.group_id = p_group_id
        and i.closed_at is null
        and (v_state->'pointStatuses'->>i.id::text) = 'completed';
    end if;
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

revoke all on function public.apply_core_operation(
  uuid, uuid, text, text, integer, text, jsonb, timestamptz
) from public;
grant execute on function public.apply_core_operation(
  uuid, uuid, text, text, integer, text, jsonb, timestamptz
) to authenticated;

comment on function public.apply_core_operation is
  'OTA-04: apply a versioned core operation idempotently; stale versions conflict; first-write locked.';
