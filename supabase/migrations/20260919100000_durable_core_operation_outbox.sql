-- Durable OFFLINE OPERATION QUEUE v2.
-- This migration is additive: shipped clients keep using the old RPCs while
-- actor-bound clients use apply_core_operation_v2.
begin;

alter table public.itinerary_items
  add column if not exists provider_place_id text;

alter table public.destination_arrivals
  add column if not exists navigation_session_id uuid
    references public.navigation_sessions(id) on delete set null;
create index if not exists destination_arrivals_session
  on public.destination_arrivals(navigation_session_id)
  where navigation_session_id is not null;

create index if not exists itinerary_items_provider_place_scope
  on public.itinerary_items(group_id, provider_place_id, subgroup_id, day, kind)
  where provider_place_id is not null and closed_at is null;

alter table public.core_operations
  add column if not exists client_sequence bigint;
alter table public.core_operations
  add column if not exists dependency_ids uuid[] not null default '{}'::uuid[];
alter table public.core_operations
  add column if not exists result_state jsonb;
alter table public.core_operations
  add column if not exists result_effects jsonb;

-- client_sequence is a device-local FIFO/audit hint, not a server identity.
-- Reinstalling a client or using a second phone may legitimately reuse it.
drop index if exists public.core_operations_actor_sequence_unique;
create index if not exists core_operations_actor_sequence_audit
  on public.core_operations(group_id, actor_id, client_sequence)
  where client_sequence is not null;

create table if not exists public.core_destination_id_aliases (
  group_id uuid not null references public.groups(id) on delete cascade,
  local_destination_id uuid not null,
  canonical_destination_id uuid not null references public.itinerary_items(id) on delete cascade,
  operation_id uuid references public.core_operations(operation_id)
    on delete set null deferrable initially deferred,
  created_at timestamptz not null default now(),
  primary key (group_id, local_destination_id),
  check (local_destination_id <> canonical_destination_id)
);

-- Existing databases may have received the first shape with a non-deferred
-- foreign key. Recreate only this constraint so a merge alias can be written
-- before the operation ledger receipt in the same transaction.
alter table public.core_destination_id_aliases
  drop constraint if exists core_destination_id_aliases_operation_id_fkey;
alter table public.core_destination_id_aliases
  add constraint core_destination_id_aliases_operation_id_fkey
  foreign key (operation_id) references public.core_operations(operation_id)
  on delete set null deferrable initially deferred;

alter table public.core_destination_id_aliases enable row level security;
drop policy if exists "core destination aliases: group member read"
  on public.core_destination_id_aliases;
create policy "core destination aliases: group member read"
  on public.core_destination_id_aliases for select to authenticated
  using (extensions.is_member(group_id));
grant select on public.core_destination_id_aliases to authenticated;

create or replace function public.core_itinerary_state(p_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'groupId', p_group_id::text,
    'destinations', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', i.id::text,
          'title', i.title,
          'order', i.position,
          'day', i.day,
          'address', i.address,
          'coordinates', jsonb_build_object(
            'latitude', i.latitude,
            'longitude', i.longitude
          ),
          'subgroupId', i.subgroup_id,
          'meetAt', i.meet_at,
          'meetRedMinutes', i.meet_red_minutes,
          'closedAt', i.closed_at,
          'closedBySessionId', i.closed_by_session_id,
          'emoji', i.emoji,
          'markerColor', i.marker_color,
          'kind', i.kind,
          'stayAnchor', i.stay_anchor,
          'providerPlaceId', i.provider_place_id
        ) order by coalesce(i.day, 0), i.position, i.id
      ),
      '[]'::jsonb
    )
  )
  from public.itinerary_items i
  where i.group_id = p_group_id;
$$;
revoke all on function public.core_itinerary_state(uuid) from public, anon, authenticated;

-- Legacy/direct itinerary RPCs do not pass through the durable v2 ledger.
-- Bump the same itinerary entity version for those writes so a later queued
-- edit cannot mistake an old snapshot for the current server state. v2 sets a
-- transaction-local group marker only while its own itinerary mutation is
-- running and writes the authoritative version once at the end.
create or replace function public.bump_core_itinerary_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := coalesce(new.group_id, old.group_id);
begin
  if current_setting('hither.core_operation_v2', true) = v_group_id::text then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  insert into public.core_entity_versions(
    group_id, entity_type, entity_id, entity_version, state, updated_at
  ) values (
    v_group_id, 'itinerary', v_group_id::text, 1,
    public.core_itinerary_state(v_group_id), now()
  ) on conflict (group_id, entity_type, entity_id) do update
    set entity_version = public.core_entity_versions.entity_version + 1,
        state = public.core_itinerary_state(v_group_id),
        updated_at = now();
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_core_itinerary_version on public.itinerary_items;
create trigger trg_core_itinerary_version
  after insert or update or delete on public.itinerary_items
  for each row execute function public.bump_core_itinerary_version();
revoke all on function public.bump_core_itinerary_version() from public, anon, authenticated;

-- One conflict writer keeps auth, role, expected-version and original draft
-- metadata in the same core_operations ledger transaction.
create or replace function public.core_record_conflict_v2(
  p_operation_id uuid,
  p_group_id uuid,
  p_actor_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_entity_version integer,
  p_operation_type text,
  p_payload jsonb,
  p_sequence bigint,
  p_dependency_ids uuid[],
  p_created_at timestamptz,
  p_code text,
  p_message text,
  p_server_version integer default null,
  p_server_state jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflict jsonb;
begin
  v_conflict := jsonb_build_object(
    'code', coalesce(p_code, 'unknown'),
    'message', coalesce(p_message, 'core operation conflict'),
    'server_entity_version', p_server_version,
    'server_state', p_server_state
  );
  insert into public.core_operations (
    operation_id, group_id, actor_id, entity_type, entity_id,
    base_entity_version, operation_type, payload, result_entity_version,
    status, created_at, client_sequence, dependency_ids, result_state, result_effects
  ) values (
    p_operation_id, p_group_id, p_actor_id, p_entity_type, p_entity_id,
    p_entity_version, p_operation_type,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('_conflict', v_conflict),
    p_server_version, 'conflict', coalesce(p_created_at, now()),
    nullif(p_sequence, 0), coalesce(p_dependency_ids, '{}'::uuid[]),
    p_server_state, '{}'::jsonb
  ) on conflict (operation_id) do nothing;
  return jsonb_build_object(
    'status', 'conflict',
    'operation_id', p_operation_id,
    'conflict', v_conflict
  );
end;
$$;
revoke all on function public.core_record_conflict_v2(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz,
  text, text, integer, jsonb
) from public, anon, authenticated;

create or replace function public.apply_core_operation_v2(
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
  v_server_version integer := 0;
  v_next_version integer := 1;
  v_state jsonb := '{}'::jsonb;
  v_effects jsonb := '{}'::jsonb;
  v_result jsonb;
  v_conflict jsonb;
  v_destination_id uuid;
  v_canonical_id uuid;
  v_provider_id text;
  v_subgroup_id uuid;
  v_day integer;
  v_kind text;
  v_position integer;
  v_closed_at timestamptz;
  v_patch jsonb;
  v_item public.itinerary_items%rowtype;
  v_request public.gather_point_requests%rowtype;
  v_request_id uuid;
  v_session public.navigation_sessions%rowtype;
  v_active_session public.navigation_sessions%rowtype;
  v_existing_arrival public.destination_arrivals%rowtype;
  v_arrival_session_id uuid;
  v_legacy_id uuid;
  v_legacy_result jsonb;
  v_is_scope_leader boolean := false;
  v_skip_expected boolean := false;
  v_already_versioned boolean := false;
  v_update_count integer := 0;
  v_updates jsonb := '[]'::jsonb;
  v_item_json jsonb;
  v_sqlstate text;
  v_message text;
  v_conflict_code text;
  v_previous_bypass text;
  v_bypass_set boolean := false;
  v_non_destructive_merge boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_actor_id is null or p_actor_id <> v_uid then
    return jsonb_build_object(
      'status', 'conflict',
      'operation_id', p_operation_id,
      'conflict', jsonb_build_object(
        'code', 'account_changed',
        'message', 'operation actor does not match auth.uid()'
      )
    );
  end if;
  if p_operation_id is null or p_group_id is null or p_entity_type is null
     or p_entity_id is null or p_entity_version is null
     or p_operation_type is null or p_sequence is null or p_sequence <= 0
     or jsonb_typeof(v_payload) <> 'object' then
    raise exception 'invalid durable operation arguments' using errcode = '22023';
  end if;
  if not extensions.is_member(p_group_id) then
    return public.core_record_conflict_v2(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, 'unauthorized', 'not a group member'
    );
  end if;

  -- Serialize all operations from one actor in one group. Entity locking below
  -- additionally protects cross-actor edits to the same itinerary/gathering.
  perform pg_advisory_xact_lock(hashtext(p_group_id::text || ':actor:' || v_uid::text));
  perform pg_advisory_xact_lock(hashtext(p_group_id::text || ':' || p_entity_type), hashtext(p_entity_id));

  select * into v_existing
  from public.core_operations
  where operation_id = p_operation_id;
  if found then
    if v_existing.actor_id <> v_uid or v_existing.group_id <> p_group_id then
      return jsonb_build_object(
        'status', 'conflict', 'operation_id', p_operation_id,
        'conflict', jsonb_build_object(
          'code', 'unauthorized', 'message', 'operation ledger actor/group mismatch'
        )
      );
    end if;
    if v_existing.entity_type is distinct from p_entity_type
       or v_existing.entity_id is distinct from p_entity_id
       or v_existing.base_entity_version is distinct from p_entity_version
       or v_existing.operation_type is distinct from p_operation_type
       or v_existing.dependency_ids is distinct from coalesce(p_dependency_ids, '{}'::uuid[])
       or (coalesce(v_existing.payload, '{}'::jsonb) - array['_result', '_effects', '_conflict'])
          is distinct from v_payload then
      return jsonb_build_object(
        'status', 'conflict',
        'operation_id', p_operation_id,
        'conflict', jsonb_build_object(
          'code', 'operation_identity_mismatch',
          'message', 'operation id was already used for a different operation'
        )
      );
    end if;
    if v_existing.status = 'conflict' then
      return jsonb_build_object(
        'status', 'conflict', 'operation_id', p_operation_id,
        'conflict', coalesce(
          v_existing.payload->'_conflict',
          jsonb_build_object('code', 'unknown', 'message', 'previously conflicted operation')
        )
      );
    end if;
    return jsonb_build_object(
      'status', 'duplicate',
      'operation_id', p_operation_id,
      'entity_version', coalesce(v_existing.result_entity_version, p_entity_version),
      'entity', v_existing.result_state,
      'effects', coalesce(v_existing.result_effects, '{}'::jsonb)
    );
  end if;

  -- client_sequence is intentionally not used for idempotency or gap
  -- detection. UUID operation_id owns replay identity; dependency_ids own
  -- causality across devices, reinstalls, and explicit conflict reapply.
  if exists (
    select 1
    from unnest(coalesce(p_dependency_ids, '{}'::uuid[])) as dependency_id
    where not exists (
      select 1 from public.core_operations o
      where o.operation_id = dependency_id
        and o.group_id = p_group_id
        and o.actor_id = v_uid
        and o.status = 'accepted'
    )
  ) then
    return public.core_record_conflict_v2(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, 'dependency_missing',
      'operation dependency is not accepted'
    );
  end if;

  -- Resolve role before expected-version checks so unauthorized actors cannot
  -- use stale-version responses as an entity oracle.
  if p_entity_type = 'active_gathering'
     and p_operation_type in ('start_gathering', 'switch_gathering', 'end_gathering') then
    select exists (
      select 1 from public.memberships m
      where m.group_id = p_group_id and m.user_id = v_uid and m.role = 'leader'
    ) into v_is_scope_leader;
    if not v_is_scope_leader then
      return public.core_record_conflict_v2(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'only the group leader may transition gathering'
      );
    end if;
  elsif p_entity_type = 'navigation_response' then
    if (v_payload->>'userId') is distinct from v_uid::text then
      return public.core_record_conflict_v2(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'navigation response is user-scoped'
      );
    end if;
  elsif p_operation_type in ('add_destination', 'edit_destination', 'delete_destination',
      'reorder_destinations', 'set_destination_meet_time', 'complete_destination') then
    begin
      v_subgroup_id := nullif(v_payload->>'subgroupId', '')::uuid;
    exception when others then
      v_subgroup_id := null;
    end;
    if p_operation_type <> 'add_destination' then
      begin
        v_destination_id := coalesce(nullif(v_payload->>'destinationId', '')::uuid, p_entity_id::uuid);
      exception when others then
        return public.core_record_conflict_v2(
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload, p_sequence,
          p_dependency_ids, p_created_at, 'validation', 'invalid destination id'
        );
      end;
      select i.subgroup_id into v_subgroup_id
      from public.itinerary_items i
      where i.id = v_destination_id and i.group_id = p_group_id;
    end if;
    if p_operation_type <> 'reorder_destinations'
       and not public.can_manage_itinerary_scope(p_group_id, v_subgroup_id, v_uid) then
      return public.core_record_conflict_v2(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'itinerary scope leader required'
      );
    end if;
  elsif p_operation_type = 'resolve_gather_point_request' then
    begin
      v_request_id := nullif(v_payload->>'requestId', '')::uuid;
    exception when others then
      return public.core_record_conflict_v2(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'validation', 'invalid request id'
      );
    end;
    select r.* into v_request
    from public.gather_point_requests r
    where r.id = v_request_id;
    if not found or v_request.group_id <> p_group_id then
      return public.core_record_conflict_v2(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'validation', 'request does not belong to group'
      );
    end if;
    if not public.can_manage_itinerary_scope(
      p_group_id, v_request.subgroup_id, v_uid
    ) then
      return public.core_record_conflict_v2(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'request scope leader required'
      );
    end if;
  elsif p_operation_type = 'submit_gather_point_request' then
    begin
      v_subgroup_id := nullif(v_payload->>'subgroupId', '')::uuid;
    exception when others then
      return public.core_record_conflict_v2(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'validation', 'invalid subgroup id'
      );
    end;
    if v_subgroup_id is not null and not exists (
      select 1 from public.subgroups s
      where s.id = v_subgroup_id and s.group_id = p_group_id
    ) then
      return public.core_record_conflict_v2(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'validation', 'subgroup does not belong to group'
      );
    end if;
    if not exists (
      select 1 from public.memberships m
      where m.group_id = p_group_id and m.user_id = v_uid
        and m.subgroup_id is not distinct from v_subgroup_id
    ) then
      return public.core_record_conflict_v2(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized',
        'request subgroup must match membership'
      );
    end if;
  end if;

  -- An open same-provider add is a non-destructive merge. It is safe to
  -- accept against a stale itinerary snapshot because it does not overwrite
  -- the authoritative destination; the alias response carries the current
  -- itinerary entity version back to the client.
  if p_entity_type = 'itinerary'
     and p_entity_id = p_group_id::text
     and p_operation_type = 'add_destination' then
    begin
      v_destination_id := nullif(v_payload->>'destinationId', '')::uuid;
      v_provider_id := nullif(btrim(v_payload->>'providerPlaceId'), '');
      v_subgroup_id := nullif(v_payload->>'subgroupId', '')::uuid;
      v_day := case
        when v_payload ? 'day' and v_payload->>'day' <> ''
          then (v_payload->>'day')::integer
        else null
      end;
      v_kind := coalesce(nullif(v_payload->>'kind', ''), 'stop');
      if v_provider_id is not null and v_kind in ('stop', 'accommodation') then
        select i.id into v_canonical_id
        from public.itinerary_items i
        where i.group_id = p_group_id
          and i.provider_place_id = v_provider_id
          and i.subgroup_id is not distinct from v_subgroup_id
          and i.day is not distinct from v_day
          and i.kind = v_kind
          and i.closed_at is null
          and i.id <> v_destination_id
        order by i.position, i.id
        limit 1
        for update;
      end if;
    exception when others then
      v_canonical_id := null;
    end;
    if v_canonical_id is not null then
      v_non_destructive_merge := true;
    end if;
  end if;

  -- Arrival and request status mutations have their own unique/status guards;
  -- they do not share one destination version across multiple members.
  v_skip_expected := v_non_destructive_merge or p_operation_type in (
    'record_arrival', 'submit_gather_point_request', 'resolve_gather_point_request'
  );
  insert into public.core_entity_versions(
    group_id, entity_type, entity_id, entity_version, state, updated_at
  ) values (
    p_group_id,
    p_entity_type,
    p_entity_id,
    0,
    case
      when p_entity_type = 'itinerary' and p_entity_id = p_group_id::text
        then public.core_itinerary_state(p_group_id)
      else '{}'::jsonb
    end,
    now()
  ) on conflict (group_id, entity_type, entity_id) do nothing;
  select * into v_row
  from public.core_entity_versions
  where group_id = p_group_id and entity_type = p_entity_type and entity_id = p_entity_id
  for update;
  -- A group can predate this migration and therefore have a version row with
  -- no canonical snapshot yet. Lazily hydrate only that group itinerary row;
  -- never rewrite its existing version number or any other entity's state.
  if p_entity_type = 'itinerary'
     and p_entity_id = p_group_id::text
     and v_row.state = '{}'::jsonb then
    update public.core_entity_versions
    set state = public.core_itinerary_state(p_group_id),
        updated_at = now()
    where group_id = p_group_id
      and entity_type = p_entity_type
      and entity_id = p_entity_id
      and state = '{}'::jsonb
    returning * into v_row;
  end if;
  v_server_version := coalesce(v_row.entity_version, 0);
  if not v_skip_expected and v_server_version <> p_entity_version then
    return public.core_record_conflict_v2(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, 'stale_version', 'entity version mismatch',
      v_server_version, v_row.state
    );
  end if;
  v_next_version := v_server_version + 1;
  if p_entity_type = 'itinerary'
     and p_entity_id = p_group_id::text
     and p_operation_type in (
       'add_destination', 'edit_destination', 'delete_destination',
       'reorder_destinations', 'set_destination_meet_time', 'complete_destination'
     ) then
    v_previous_bypass := current_setting('hither.core_operation_v2', true);
    perform set_config('hither.core_operation_v2', p_group_id::text, true);
    v_bypass_set := true;
  end if;

  begin
    if p_operation_type in ('start_gathering', 'switch_gathering', 'end_gathering')
       and p_entity_type = 'active_gathering' then
      -- Reuse the already-shipped transition validators and bridge them with
      -- the navigation session in this same database transaction. The derived
      -- ledger id keeps old RPC idempotency intact without changing its API.
      v_legacy_id := md5(p_operation_id::text || ':legacy')::uuid;
      if p_operation_type = 'switch_gathering' then
        v_legacy_result := public.apply_leader_gathering_switch(
          v_legacy_id, p_group_id, p_entity_id, p_entity_version,
          (v_payload->>'activeDestinationId'),
          coalesce(p_created_at, now())
        );
      else
        v_legacy_result := public.apply_core_operation(
          v_legacy_id, p_group_id, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload,
          coalesce(p_created_at, now())
        );
      end if;
      if v_legacy_result->>'status' <> 'accepted' then
        if v_bypass_set then
          perform set_config('hither.core_operation_v2', coalesce(v_previous_bypass, ''), true);
          v_bypass_set := false;
        end if;
        return public.core_record_conflict_v2(
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload, p_sequence,
          p_dependency_ids, p_created_at,
          coalesce(v_legacy_result->'conflict'->>'code', 'unknown'),
          coalesce(v_legacy_result->'conflict'->>'message', 'gathering transition rejected'),
          nullif(v_legacy_result->'conflict'->>'server_entity_version', '')::integer,
          v_legacy_result->'conflict'->'server_state'
        );
      end if;
      v_state := coalesce(v_legacy_result->'entity', '{}'::jsonb);
      v_next_version := coalesce((v_legacy_result->>'entity_version')::integer, v_next_version);
      v_already_versioned := true;

      if p_operation_type in ('start_gathering', 'switch_gathering') then
        if coalesce(v_payload->>'navigationRequestId', '') ~
           '^[0-9a-fA-F-]{36}$' then
          if p_operation_type = 'start_gathering' then
            select * into v_session
            from public.start_navigation_session(
              p_group_id,
              (v_payload->>'activeDestinationId')::uuid,
              (v_payload->>'navigationRequestId')::uuid
            );
          else
            select * into v_session
            from public.start_navigation_session_switch(
              p_group_id,
              (v_payload->>'activeDestinationId')::uuid,
              (v_payload->>'navigationRequestId')::uuid
            );
          end if;
        else
          if p_operation_type = 'start_gathering' then
            select * into v_session
            from public.start_navigation_session(
              p_group_id,
              (v_payload->>'activeDestinationId')::uuid,
              p_operation_id
            );
          else
            select * into v_session
            from public.start_navigation_session_switch(
              p_group_id,
              (v_payload->>'activeDestinationId')::uuid,
              p_operation_id
            );
          end if;
        end if;
        v_effects := jsonb_build_object(
          'navigationSessionId', v_session.id::text,
          'navigationSession', to_jsonb(v_session)
        );
      else
        select s.* into v_active_session
        from public.navigation_sessions s
        where s.group_id = p_group_id and s.status = 'active'
        order by s.started_at desc
        limit 1
        for update;
        if found then
          update public.navigation_sessions
          set status = 'cancelled', ended_at = now(), version = version + 1, updated_at = now()
          where id = v_active_session.id;
          v_effects := jsonb_build_object('navigationSessionEnded', v_active_session.id::text);
        end if;
      end if;

    elsif p_operation_type = 'set_navigation_response' then
      v_state := jsonb_build_object(
        'sessionId', v_payload->>'sessionId',
        'userId', v_uid::text,
        'groupId', p_group_id::text,
        'response', v_payload->'response',
        'entityVersion', v_next_version,
        'updatedAt', (extract(epoch from now()) * 1000)::bigint
      );

    elsif p_operation_type = 'record_arrival' then
      begin
        v_destination_id := p_entity_id::uuid;
        v_arrival_session_id := nullif(v_payload->>'navigationSessionId', '')::uuid;
      exception when others then
        raise exception 'invalid arrival destination or session id' using errcode = '22023';
      end;
      if nullif(v_payload->>'userId', '')::uuid is distinct from v_uid then
        raise exception 'arrival actor must equal target user' using errcode = '42501';
      end if;
      if not exists (
        select 1 from public.memberships m
        where m.group_id = p_group_id and m.user_id = v_uid
      ) then
        raise exception 'arrival target is not a group member' using errcode = '42501';
      end if;
      select i.* into v_item
      from public.itinerary_items i
      where i.id = v_destination_id and i.group_id = p_group_id
      for update;
      if not found then
        raise exception 'arrival destination does not belong to group' using errcode = 'P0002';
      end if;
      if v_arrival_session_id is not null then
        select s.* into v_session
        from public.navigation_sessions s
        where s.id = v_arrival_session_id
          and s.group_id = p_group_id
          and s.destination_id = v_destination_id
          and s.status = 'active'
          and s.expires_at > now()
        for update;
        if not found then
          raise exception 'arrival session is no longer active for destination' using errcode = '55000';
        end if;
      else
        select s.* into v_active_session
        from public.navigation_sessions s
        where s.group_id = p_group_id
          and s.destination_id = v_destination_id
          and s.status = 'active'
          and s.expires_at > now()
        order by s.started_at desc
        limit 1
        for update;
        if found then
          v_arrival_session_id := v_active_session.id;
        elsif not exists (
          select 1 from public.groups g
          where g.id = p_group_id
            and g.journey_status = 'going'
            and g.active_destination_id = v_destination_id
        ) then
          raise exception 'arrival is not scoped to the active destination/session' using errcode = '55000';
        end if;
      end if;

      select a.* into v_existing_arrival
      from public.destination_arrivals a
      where a.destination_id = v_destination_id and a.user_id = v_uid
      for update;
      if found and coalesce((v_payload->>'arrived')::boolean, true) is false then
        if v_arrival_session_id is null
           or v_existing_arrival.navigation_session_id is distinct from v_arrival_session_id then
          raise exception 'arrival undo belongs to another navigation session' using errcode = '55000';
        end if;
      end if;
      -- A repeat arrival is a server-side idempotent no-op. Never rebind an
      -- existing arrival to a later session or resurrect an ended trip.
      if not found or coalesce((v_payload->>'arrived')::boolean, true) is false then
        perform public.set_destination_arrival_at(
          v_destination_id,
          v_uid,
          coalesce((v_payload->>'arrived')::boolean, true),
          nullif(v_payload->>'arrivedAt', '')::timestamptz
        );
        if coalesce((v_payload->>'arrived')::boolean, true) then
          update public.destination_arrivals
          set navigation_session_id = v_arrival_session_id
          where destination_id = v_destination_id and user_id = v_uid
            and navigation_session_id is null;
        end if;
      end if;
      select i.closed_at into v_closed_at
      from public.itinerary_items i
      where i.id = v_destination_id and i.group_id = p_group_id;
      v_state := jsonb_build_object(
        'destinationId', v_destination_id::text,
        'userId', v_uid::text,
        'completeSolo', v_closed_at is not null,
        'arrived', coalesce((v_payload->>'arrived')::boolean, true),
        'navigationSessionId', v_arrival_session_id
      );

    elsif p_operation_type = 'submit_gather_point_request' then
      begin
        v_request_id := nullif(v_payload->>'requestId', '')::uuid;
      exception when others then
        raise exception 'invalid request id' using errcode = '22023';
      end;
      if v_request_id is null or v_request_id::text is distinct from p_entity_id then
        raise exception 'request id does not match operation entity' using errcode = '22023';
      end if;
      if jsonb_typeof(v_payload->'items') <> 'array'
         or jsonb_array_length(v_payload->'items') = 0 then
        raise exception 'request items must be a non-empty array' using errcode = '22023';
      end if;
      insert into public.gather_point_requests(
        id, group_id, subgroup_id, requester_id, items
      ) values (
        v_request_id, p_group_id,
        nullif(v_payload->>'subgroupId', '')::uuid,
        v_uid, v_payload->'items'
      ) on conflict (id) do nothing;
      select * into v_request from public.gather_point_requests where id = v_request_id;
      if not found or v_request.group_id <> p_group_id or v_request.requester_id <> v_uid then
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
      v_state := public.resolve_gather_point_request(
        v_request_id, coalesce((v_payload->>'approve')::boolean, false)
      );
      v_effects := jsonb_build_object('requestId', v_request_id::text);

    elsif p_operation_type = 'add_destination' then
      v_destination_id := (v_payload->>'destinationId')::uuid;
      v_provider_id := nullif(btrim(v_payload->>'providerPlaceId'), '');
      v_subgroup_id := nullif(v_payload->>'subgroupId', '')::uuid;
      v_day := case when v_payload ? 'day' and v_payload->>'day' <> '' then (v_payload->>'day')::integer else null end;
      v_kind := coalesce(nullif(v_payload->>'kind', ''), 'stop');
      if v_kind not in ('stop', 'accommodation') then
        raise exception 'invalid itinerary kind' using errcode = '22023';
      end if;
      if v_provider_id is not null then
        select i.id into v_canonical_id
        from public.itinerary_items i
        where i.group_id = p_group_id
          and i.provider_place_id = v_provider_id
          and i.subgroup_id is not distinct from v_subgroup_id
          and i.day is not distinct from v_day
          and i.kind = v_kind
          and i.closed_at is null
          and i.id <> v_destination_id
        order by i.position, i.id
        limit 1
        for update;
      end if;
      if v_canonical_id is not null then
        insert into public.core_destination_id_aliases(
          group_id, local_destination_id, canonical_destination_id, operation_id
        ) values (p_group_id, v_destination_id, v_canonical_id, p_operation_id)
        on conflict (group_id, local_destination_id) do update
          set canonical_destination_id = excluded.canonical_destination_id,
              operation_id = excluded.operation_id,
              created_at = now();
        v_effects := jsonb_build_object(
          'destinationIdAliases', jsonb_build_object(
            v_destination_id::text, v_canonical_id::text
          )
        );
      else
        select coalesce(max(i.position), -1) + 1 into v_position
        from public.itinerary_items i
        where i.group_id = p_group_id
          and i.subgroup_id is not distinct from v_subgroup_id
          and i.day is not distinct from v_day;
        insert into public.itinerary_items(
          id, group_id, subgroup_id, title, address, day, latitude, longitude,
          position, kind, stay_anchor, provider_place_id, created_by
        ) values (
          v_destination_id, p_group_id, v_subgroup_id,
          nullif(btrim(v_payload->>'title'), ''),
          nullif(btrim(v_payload->>'address'), ''), v_day,
          (v_payload->>'latitude')::double precision,
          (v_payload->>'longitude')::double precision,
          v_position, v_kind,
          case when v_kind = 'accommodation' then coalesce((v_payload->>'stayAnchor')::boolean, false) else false end,
          v_provider_id, v_uid
        );
      end if;
      v_state := public.core_itinerary_state(p_group_id);

    elsif p_operation_type = 'edit_destination' then
      v_patch := coalesce(v_payload->'patch', '{}'::jsonb);
      if v_patch ? 'subgroupId'
         and not public.can_manage_itinerary_scope(
           p_group_id,
           nullif(v_patch->>'subgroupId', '')::uuid,
           v_uid
         ) then
        return public.core_record_conflict_v2(
          p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
          p_entity_version, p_operation_type, v_payload, p_sequence,
          p_dependency_ids, p_created_at, 'unauthorized',
          'destination subgroup scope is not writable'
        );
      end if;
      update public.itinerary_items i
      set title = case when v_patch ? 'title' then nullif(btrim(v_patch->>'title'), '') else i.title end,
          address = case when v_patch ? 'address' then nullif(btrim(v_patch->>'address'), '') else i.address end,
          latitude = case when v_patch ? 'latitude' then (v_patch->>'latitude')::double precision else i.latitude end,
          longitude = case when v_patch ? 'longitude' then (v_patch->>'longitude')::double precision else i.longitude end,
          day = case when v_patch ? 'day' then (v_patch->>'day')::integer else i.day end,
          subgroup_id = case when v_patch ? 'subgroupId' then nullif(v_patch->>'subgroupId', '')::uuid else i.subgroup_id end,
          kind = case when v_patch ? 'kind' then v_patch->>'kind' else i.kind end,
          stay_anchor = case when v_patch ? 'stayAnchor' then (v_patch->>'stayAnchor')::boolean else i.stay_anchor end,
          provider_place_id = case when v_patch ? 'providerPlaceId' then nullif(btrim(v_patch->>'providerPlaceId'), '') else i.provider_place_id end,
          emoji = case when v_patch ? 'emoji' then v_patch->>'emoji' else i.emoji end,
          marker_color = case when v_patch ? 'markerColor' then v_patch->>'markerColor' else i.marker_color end
      where i.id = v_destination_id and i.group_id = p_group_id;
      get diagnostics v_update_count = row_count;
      if v_update_count <> 1 then
        raise exception 'destination not found' using errcode = 'P0002';
      end if;
      v_state := public.core_itinerary_state(p_group_id);

    elsif p_operation_type = 'delete_destination' then
      perform public.delete_destination(p_group_id, v_destination_id);
      v_state := public.core_itinerary_state(p_group_id);

    elsif p_operation_type = 'reorder_destinations' then
      if jsonb_typeof(v_payload->'updates') <> 'array'
         or jsonb_array_length(v_payload->'updates') = 0 then
        raise exception 'invalid reorder batch' using errcode = '22023';
      end if;
      for v_item_json in select value from jsonb_array_elements(v_payload->'updates')
      loop
        begin
          v_destination_id := nullif(v_item_json->>'id', '')::uuid;
        exception when others then
          raise exception 'invalid reorder destination id' using errcode = '22023';
        end;
        select i.subgroup_id, i.closed_at into v_subgroup_id, v_closed_at
        from public.itinerary_items i
        where i.id = v_destination_id and i.group_id = p_group_id;
        if not found then
          raise exception 'reorder destination does not belong to group' using errcode = '22023';
        end if;
        if v_closed_at is not null then
          raise exception 'cannot reorder closed itinerary item' using errcode = '22023';
        end if;
        if not public.can_manage_itinerary_scope(
          p_group_id, v_subgroup_id, v_uid
        ) then
          raise exception 'reorder destination scope is not writable' using errcode = '42501';
        end if;
      end loop;
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

    elsif p_operation_type = 'set_destination_meet_time' then
      update public.itinerary_items i
      set meet_at = nullif(v_payload->>'meetAt', '')::timestamptz,
          meet_red_minutes = case
            when v_payload ? 'meetRedMinutes'
            then nullif(v_payload->>'meetRedMinutes', '')::integer
            else i.meet_red_minutes
          end
      where i.id = v_destination_id and i.group_id = p_group_id;
      get diagnostics v_update_count = row_count;
      if v_update_count <> 1 then
        raise exception 'destination not found' using errcode = 'P0002';
      end if;
      v_state := public.core_itinerary_state(p_group_id);

    elsif p_operation_type = 'complete_destination' then
      perform public.complete_gathering_stop(p_group_id, v_destination_id);
      v_state := public.core_itinerary_state(p_group_id);

    else
      raise exception 'unsupported durable operation type' using errcode = '22023';
    end if;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    if v_bypass_set then
      perform set_config('hither.core_operation_v2', coalesce(v_previous_bypass, ''), true);
      v_bypass_set := false;
    end if;
    if v_sqlstate in ('40001', '40P01', '57014') then
      -- Serialization failures, deadlocks, and statement cancellations are
      -- transient queue failures. Let the caller retry the same operation ID
      -- instead of recording a terminal conflict receipt.
      raise;
    end if;
    v_conflict_code := case
      when v_sqlstate in ('28000', '42501') then 'unauthorized'
      when v_sqlstate in (
        '22023', '22P02', '22003', '23503', '23505', '23514',
        'P0001', 'P0002', 'P0004', '55000'
      ) then 'validation'
      else 'unknown'
    end;
    return public.core_record_conflict_v2(
      p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
      p_entity_version, p_operation_type, v_payload, p_sequence,
      p_dependency_ids, p_created_at, v_conflict_code, v_message,
      v_server_version, v_row.state
    );
  end;

  if v_non_destructive_merge then
    -- The merge only wrote the alias ledger. The authoritative itinerary
    -- version/state belong to the remote row and must not be incremented.
    select * into v_row
    from public.core_entity_versions
    where group_id = p_group_id
      and entity_type = p_entity_type
      and entity_id = p_entity_id;
  elsif not v_already_versioned then
    update public.core_entity_versions
    set entity_version = v_next_version,
        state = v_state,
        updated_at = now()
    where group_id = p_group_id and entity_type = p_entity_type and entity_id = p_entity_id
    returning * into v_row;
  else
    -- The legacy transition updated the shared version row. Re-read its
    -- authoritative state so the v2 ledger duplicate has the same result.
    select * into v_row
    from public.core_entity_versions
    where group_id = p_group_id and entity_type = p_entity_type and entity_id = p_entity_id;
  end if;

  if v_state = '{}'::jsonb then v_state := coalesce(v_row.state, '{}'::jsonb); end if;
  if v_bypass_set then
    perform set_config('hither.core_operation_v2', coalesce(v_previous_bypass, ''), true);
    v_bypass_set := false;
  end if;
  insert into public.core_operations(
    operation_id, group_id, actor_id, entity_type, entity_id,
    base_entity_version, operation_type, payload, result_entity_version,
    status, created_at, client_sequence, dependency_ids, result_state, result_effects
  ) values (
    p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
    p_entity_version, p_operation_type,
    v_payload || jsonb_build_object('_result', v_state, '_effects', v_effects),
    coalesce((v_row.entity_version), v_next_version), 'accepted', coalesce(p_created_at, now()),
    p_sequence, coalesce(p_dependency_ids, '{}'::uuid[]), v_state, v_effects
  );
  return jsonb_build_object(
    'status', 'accepted',
    'operation_id', p_operation_id,
    'entity_version', coalesce(v_row.entity_version, v_next_version),
    'entity', v_state,
    'effects', v_effects
  );
end;
$$;

revoke all on function public.apply_core_operation_v2(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz
) from public, anon;
grant execute on function public.apply_core_operation_v2(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz
) to authenticated;

commit;
