-- Silent journey sync v3.
--
-- This migration is additive.  v2 remains callable by clients that have not
-- moved to the envelope fields below; v3 owns the operation-level rebase,
-- scope-bound navigation sessions, late arrival history and notification
-- outbox used by the silent queue.
begin;

-- -------------------------------------------------------------------------
-- Durable operation metadata
-- -------------------------------------------------------------------------

alter table public.core_operations
  add column if not exists device_id text,
  add column if not exists scope_key text,
  add column if not exists session_id uuid,
  add column if not exists occurred_at timestamptz,
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists terminal_reason text,
  add column if not exists rebase_count integer not null default 0,
  add column if not exists resolved_at timestamptz;

alter table public.core_operations
  drop constraint if exists core_operations_device_id_length;
alter table public.core_operations
  add constraint core_operations_device_id_length
  check (device_id is null or length(device_id) between 1 and 200);

create index if not exists core_operations_scope_received
  on public.core_operations(group_id, scope_key, received_at desc);
create index if not exists core_operations_session
  on public.core_operations(session_id)
  where session_id is not null;

-- Existing receipts predate received_at.  Keep their original created_at as
-- the server receipt and leave occurred_at null rather than inventing a phone
-- timestamp.
update public.core_operations
set received_at = coalesce(received_at, created_at)
where received_at is null;

-- -------------------------------------------------------------------------
-- Independent main/subgroup session state
-- -------------------------------------------------------------------------

alter table public.navigation_sessions
  add column if not exists scope_subgroup_id uuid,
  add column if not exists scope_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'navigation_sessions_scope_subgroup_fkey'
      and conrelid = 'public.navigation_sessions'::regclass
  ) then
    alter table public.navigation_sessions
      add constraint navigation_sessions_scope_subgroup_fkey
      foreign key (scope_subgroup_id)
      references public.subgroups(id)
      on delete cascade;
  end if;
end;
$$;

-- Historical sessions acquire the destination's scope.  A deleted
-- destination has no subgroup left to infer, so it safely remains main scope.
update public.navigation_sessions s
set scope_subgroup_id = i.subgroup_id
from public.itinerary_items i
where s.destination_id = i.id
  and s.scope_subgroup_id is null;
update public.navigation_sessions
set scope_key = coalesce(scope_subgroup_id::text, 'main')
where scope_key is null;
alter table public.navigation_sessions
  alter column scope_key set default 'main';
alter table public.navigation_sessions
  alter column scope_key set not null;

drop index if exists public.navigation_sessions_one_active_group;
drop index if exists public.navigation_sessions_one_active_scope;
create unique index if not exists navigation_sessions_one_active_scope
  on public.navigation_sessions(group_id, scope_key)
  where status = 'active';
create index if not exists navigation_sessions_scope_started
  on public.navigation_sessions(group_id, scope_key, started_at desc);

create table if not exists public.navigation_scope_states (
  group_id uuid not null references public.groups(id) on delete cascade,
  scope_key text not null,
  scope_subgroup_id uuid references public.subgroups(id) on delete cascade,
  journey_state text not null default 'idle'
    check (journey_state in ('idle', 'active')),
  active_session_id uuid references public.navigation_sessions(id) on delete set null,
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  primary key (group_id, scope_key),
  check (
    (scope_key = 'main' and scope_subgroup_id is null)
    or (scope_key <> 'main' and scope_subgroup_id is not null
        and scope_key = scope_subgroup_id::text)
  )
);
create unique index if not exists navigation_scope_states_main
  on public.navigation_scope_states(group_id)
  where scope_subgroup_id is null;
create unique index if not exists navigation_scope_states_subgroup
  on public.navigation_scope_states(group_id, scope_subgroup_id)
  where scope_subgroup_id is not null;

alter table public.navigation_scope_states enable row level security;
drop policy if exists "navigation scope states: group members read"
  on public.navigation_scope_states;
create policy "navigation scope states: group members read"
  on public.navigation_scope_states for select to authenticated
  using (extensions.is_member(group_id));
grant select on public.navigation_scope_states to authenticated;

-- -------------------------------------------------------------------------
-- Session-bound arrival/history events
-- -------------------------------------------------------------------------

alter table public.destination_arrivals
  alter column arrived_at drop not null,
  add column if not exists corrected_at timestamptz,
  add column if not exists corrected_by uuid references auth.users(id) on delete set null,
  add column if not exists correction_note text;

alter table public.destination_arrivals
  drop constraint if exists destination_arrivals_source_check;
alter table public.destination_arrivals
  add constraint destination_arrivals_source_check
  check (source in ('automatic', 'manual', 'leader_correction'));

alter table public.visited_waypoints
  add column if not exists navigation_session_id uuid
    references public.navigation_sessions(id) on delete set null;
alter table public.visited_waypoints
  alter column arrived_at drop not null;
create index if not exists visited_waypoints_navigation_session
  on public.visited_waypoints(navigation_session_id)
  where navigation_session_id is not null;

create table if not exists public.navigation_session_history (
  group_id uuid not null references public.groups(id) on delete cascade,
  navigation_session_id uuid not null references public.navigation_sessions(id) on delete cascade,
  destination_id uuid references public.itinerary_items(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  arrived boolean not null default false,
  arrived_at timestamptz,
  recorded_at timestamptz not null default now(),
  corrected_at timestamptz,
  corrected_by uuid references auth.users(id) on delete set null,
  correction_note text,
  primary key (navigation_session_id, user_id)
);
create index if not exists navigation_session_history_group
  on public.navigation_session_history(group_id, destination_id, recorded_at desc);
alter table public.navigation_session_history enable row level security;
drop policy if exists "navigation session history: group members read"
  on public.navigation_session_history;
create policy "navigation session history: group members read"
  on public.navigation_session_history for select to authenticated
  using (extensions.is_member(group_id));
grant select on public.navigation_session_history to authenticated;

create table if not exists public.navigation_arrival_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique references public.core_operations(operation_id)
    on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  navigation_session_id uuid not null references public.navigation_sessions(id) on delete cascade,
  destination_id uuid references public.itinerary_items(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  event_kind text not null check (event_kind in ('arrival', 'leader_correction')),
  arrived boolean not null,
  arrived_at timestamptz,
  source text not null check (source in ('automatic', 'manual', 'leader_correction')),
  device_id text,
  client_sequence bigint,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  corrected_at timestamptz,
  correction_note text
);
-- Arrival events are written before the v3 operation receipt so the event and
-- receipt commit atomically.  Defer this FK until the end of the transaction.
alter table public.navigation_arrival_events
  drop constraint if exists navigation_arrival_events_operation_id_fkey;
alter table public.navigation_arrival_events
  add constraint navigation_arrival_events_operation_id_fkey
  foreign key (operation_id) references public.core_operations(operation_id)
  on delete cascade deferrable initially deferred;
create sequence if not exists public.navigation_arrival_event_sequence;
alter table public.navigation_arrival_events
  add column if not exists event_sequence bigint;
alter table public.navigation_arrival_events
  add column if not exists device_id text,
  add column if not exists client_sequence bigint;
update public.navigation_arrival_events
set event_sequence = nextval('public.navigation_arrival_event_sequence')
where event_sequence is null;
alter table public.navigation_arrival_events
  alter column event_sequence set default nextval('public.navigation_arrival_event_sequence'),
  alter column event_sequence set not null;
create index if not exists navigation_arrival_events_session_user
  on public.navigation_arrival_events(navigation_session_id, user_id, received_at);
alter table public.navigation_arrival_events enable row level security;
drop policy if exists "navigation arrival events: group members read"
  on public.navigation_arrival_events;
create policy "navigation arrival events: group members read"
  on public.navigation_arrival_events for select to authenticated
  using (extensions.is_member(group_id));
grant select on public.navigation_arrival_events to authenticated;

-- A correction is an audit event, not a fake client arrival.  The nullable
-- timestamp is intentional: a leader correction never claims when the member
-- physically arrived.
comment on column public.navigation_arrival_events.arrived_at is
  'Client-reported arrival time; NULL for leader corrections.';

-- -------------------------------------------------------------------------
-- Notification outbox
-- -------------------------------------------------------------------------

create table if not exists public.core_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.core_operations(operation_id)
    on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in (
    'leader_commands', 'follower_requests', 'journey', 'arrival'
  )),
  target_role text not null check (target_role in ('leader', 'member')),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8192),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivery_status text not null default 'queued'
    check (delivery_status in ('queued', 'attempted', 'expired', 'delivered')),
  attempted_at timestamptz,
  delivered_at timestamptz,
  unique (operation_id, target_user_id)
);
alter table public.core_notification_outbox
  drop constraint if exists core_notification_outbox_operation_id_fkey;
alter table public.core_notification_outbox
  add constraint core_notification_outbox_operation_id_fkey
  foreign key (operation_id) references public.core_operations(operation_id)
  on delete cascade deferrable initially deferred;
create index if not exists core_notification_outbox_expiry
  on public.core_notification_outbox(expires_at, delivery_status);
create index if not exists core_notification_outbox_target
  on public.core_notification_outbox(target_user_id, created_at desc);
alter table public.core_notification_outbox enable row level security;
drop policy if exists "core notification outbox: own or group read"
  on public.core_notification_outbox;
create policy "core notification outbox: own or group read"
  on public.core_notification_outbox for select to authenticated
  using (target_user_id = (select auth.uid()) or extensions.is_member(group_id));
grant select on public.core_notification_outbox to authenticated;

-- -------------------------------------------------------------------------
-- Coordinate immutability and empty subgroup audit
-- -------------------------------------------------------------------------

create or replace function public.guard_itinerary_coordinates_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.latitude is distinct from old.latitude
     or new.longitude is distinct from old.longitude then
    raise exception 'destination coordinates are immutable; delete and recreate the destination'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_itinerary_coordinates_immutable on public.itinerary_items;
create trigger trg_itinerary_coordinates_immutable
before update of latitude, longitude on public.itinerary_items
for each row execute function public.guard_itinerary_coordinates_immutable();
revoke all on function public.guard_itinerary_coordinates_immutable() from public, anon, authenticated;

create table if not exists public.subgroup_cleanup_audit (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  subgroup_id uuid not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references auth.users(id) on delete set null,
  reason text not null default 'empty_subgroup'
);
create unique index if not exists subgroup_cleanup_audit_once
  on public.subgroup_cleanup_audit(group_id, subgroup_id);
alter table public.subgroup_cleanup_audit enable row level security;
drop policy if exists "subgroup cleanup audit: group members read"
  on public.subgroup_cleanup_audit;
create policy "subgroup cleanup audit: group members read"
  on public.subgroup_cleanup_audit for select to authenticated
  using (extensions.is_member(group_id));
grant select on public.subgroup_cleanup_audit to authenticated;

-- A main-team leader retains the existing top-down management authority for a
-- subgroup when the subgroup is named explicitly.  Omitting scope still means
-- the main lane, so this does not let a legacy unscoped request cancel a
-- subgroup session.
create or replace function public.can_manage_itinerary_scope(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_user_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    left join public.subgroups s
      on s.id = p_subgroup_id
     and s.group_id = p_group_id
    where m.group_id = p_group_id
      and m.user_id = coalesce(p_user_id, (select auth.uid()))
      and (
        (
          p_subgroup_id is null
          and m.subgroup_id is null
          and m.role = 'leader'
        )
        or (
          p_subgroup_id is not null
          and (
            (m.subgroup_id is null and m.role = 'leader')
            or (m.subgroup_id = p_subgroup_id and s.leader_id = m.user_id)
          )
        )
      )
  )
  and (p_user_id is null or p_user_id = (select auth.uid()))
  and public.anonymous_access_is_active(coalesce(p_user_id, (select auth.uid())));
$$;
revoke all on function public.can_manage_itinerary_scope(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.can_manage_itinerary_scope(uuid, uuid, uuid)
  to authenticated;

create or replace function public.delete_empty_group_or_subgroup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
begin
  if old.subgroup_id is not null
     and not exists (select 1 from public.memberships m where m.subgroup_id = old.subgroup_id)
     and not exists (select 1 from public.subgroups c where c.parent_subgroup_id = old.subgroup_id)
  then
    select group_id into v_group from public.subgroups where id = old.subgroup_id;
    if v_group is not null then
      insert into public.subgroup_cleanup_audit(group_id, subgroup_id, deleted_by)
      values (v_group, old.subgroup_id, v_uid)
      on conflict (group_id, subgroup_id) do nothing;
      -- Keep only an opaque tombstone for queued operations.  Payloads and
      -- result snapshots can contain private names/coordinates, and an
      -- outbox row can otherwise deliver the deleted subgroup after cleanup.
      update public.core_notification_outbox n
      set payload = jsonb_build_object(
            'type', 'scope_deleted',
            'scope', old.subgroup_id::text
          ),
          delivery_status = 'expired',
          expires_at = least(n.expires_at, now()),
          attempted_at = coalesce(n.attempted_at, now()),
          delivered_at = null
      where n.group_id = v_group
        and exists (
          select 1
          from public.core_operations o
          where o.operation_id = n.operation_id
            and o.group_id = v_group
            and (
              o.scope_key = old.subgroup_id::text
              or o.payload->>'subgroupId' = old.subgroup_id::text
              or o.payload->>'scopeSubgroupId' = old.subgroup_id::text
            )
        );
      update public.core_operations o
      set status = 'conflict',
          terminal_reason = 'scope_deleted',
          resolved_at = coalesce(resolved_at, now()),
          payload = jsonb_build_object(
            '_conflict', jsonb_build_object(
              'code', 'scope_deleted', 'message', 'subgroup no longer exists'
            )
          ),
          result_state = null,
          result_effects = jsonb_build_object('scopeDeleted', true)
      where o.group_id = v_group
        and (
          o.scope_key = old.subgroup_id::text
          or o.payload->>'subgroupId' = old.subgroup_id::text
          or o.payload->>'scopeSubgroupId' = old.subgroup_id::text
        );
      -- Child rows carry the subgroup's session/history content.  Remove them
      -- before the destination rows so a later subgroup with a new identity
      -- cannot inherit stale arrivals or visited projections.
      delete from public.visited_waypoints v
      where v.group_id = v_group
        and (
          v.destination_id in (
            select i.id from public.itinerary_items i
            where i.group_id = v_group and i.subgroup_id = old.subgroup_id
          )
          or v.navigation_session_id in (
            select s.id from public.navigation_sessions s
            where s.group_id = v_group and s.scope_subgroup_id = old.subgroup_id
          )
        );
      delete from public.destination_arrivals a
      where a.group_id = v_group
        and a.destination_id in (
          select i.id from public.itinerary_items i
          where i.group_id = v_group and i.subgroup_id = old.subgroup_id
        );
      delete from public.navigation_sessions s
      where s.group_id = v_group and s.scope_subgroup_id = old.subgroup_id;
      delete from public.itinerary_items where subgroup_id = old.subgroup_id;
      delete from public.subgroups where id = old.subgroup_id;
    end if;
  end if;

  if old.group_id is not null
     and not exists (select 1 from public.memberships m where m.group_id = old.group_id)
  then
    delete from public.groups where id = old.group_id;
  end if;
  return null;
end;
$$;
revoke all on function public.delete_empty_group_or_subgroup() from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- Internal v3 helpers
-- -------------------------------------------------------------------------

create or replace function public.core_v3_conflict(
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
  p_server_state jsonb default null,
  p_device_id text default null,
  p_scope_key text default null,
  p_session_id uuid default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflict jsonb;
  v_existing public.core_operations%rowtype;
  v_incoming_identity jsonb := coalesce(p_payload, '{}'::jsonb)
    - array['_result', '_effects', '_conflict', 'rebase'];
  v_existing_identity jsonb;
begin
  -- Early envelope parsing calls this helper before the main v3 identity
  -- lookup.  Serialize the lookup here too, otherwise a malformed replay
  -- could replace a receipt before actor/group/payload identity is checked.
  perform pg_advisory_xact_lock(
    hashtext('core-v3-conflict:' || coalesce(p_operation_id::text, ''))
  );
  v_conflict := jsonb_build_object(
    'code', coalesce(p_code, 'unknown'),
    'message', coalesce(p_message, 'core operation conflict'),
    'server_entity_version', p_server_version,
    'server_state', p_server_state
  );

  select * into v_existing
  from public.core_operations
  where operation_id = p_operation_id
  for update;
  if found then
    v_existing_identity := coalesce(v_existing.payload, '{}'::jsonb)
      - array['_result', '_effects', '_conflict', 'rebase'];
    if v_existing.actor_id is distinct from p_actor_id
       or v_existing.group_id is distinct from p_group_id
       or v_existing.entity_type is distinct from p_entity_type
       or v_existing.entity_id is distinct from p_entity_id
       or v_existing.base_entity_version is distinct from p_entity_version
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
    -- Cleanup deliberately redacts the payload.  A replay by the same
    -- logical owner must receive the terminal scope tombstone instead of an
    -- identity mismatch caused only by that redaction.
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
    if v_existing_identity is distinct from v_incoming_identity then
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
    -- The logical identity is unchanged, but the latest retry may have
    -- learned a terminal target/authorization result.  Replace only the
    -- receipt fields; never replace actor/group/entity/dependency identity.
    update public.core_operations
    set payload = coalesce(p_payload, '{}'::jsonb) ||
          jsonb_build_object('_conflict', v_conflict),
        result_entity_version = p_server_version,
        result_state = p_server_state,
        result_effects = '{}'::jsonb,
        terminal_reason = coalesce(p_code, 'unknown'),
        received_at = now(),
        resolved_at = null
    where operation_id = p_operation_id;
    return jsonb_build_object(
      'status', 'conflict', 'operation_id', p_operation_id,
      'conflict', v_conflict
    );
  end if;

  insert into public.core_operations(
    operation_id, group_id, actor_id, entity_type, entity_id,
    base_entity_version, operation_type, payload, result_entity_version,
    status, created_at, client_sequence, dependency_ids, result_state,
    result_effects, device_id, scope_key, session_id, occurred_at,
    received_at, terminal_reason
  ) values (
    p_operation_id, p_group_id, p_actor_id, p_entity_type, p_entity_id,
    p_entity_version, p_operation_type,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('_conflict', v_conflict),
    p_server_version, 'conflict', coalesce(p_created_at, now()),
    nullif(p_sequence, 0), coalesce(p_dependency_ids, '{}'::uuid[]),
    p_server_state, '{}'::jsonb, p_device_id, p_scope_key, p_session_id,
    p_occurred_at, now(), p_code
  );
  return jsonb_build_object(
    'status', 'conflict', 'operation_id', p_operation_id, 'conflict', v_conflict
  );
end;
$$;
revoke all on function public.core_v3_conflict(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz,
  text, text, integer, jsonb, text, text, uuid, timestamptz
) from public, anon, authenticated;

create or replace function public.core_v3_enqueue_notification(
  p_operation_id uuid,
  p_group_id uuid,
  p_sender_id uuid,
  p_scope_subgroup_id uuid,
  p_payload jsonb,
  p_received_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_role text;
  v_category text;
  v_target_role text;
  v_target record;
  v_targets integer := 0;
  v_ids jsonb := '[]'::jsonb;
  v_expires timestamptz;
  v_pref boolean;
  v_row public.core_notification_outbox%rowtype;
begin
  select m.role into v_sender_role
  from public.memberships m
  where m.group_id = p_group_id and m.user_id = p_sender_id;
  if not found then
    raise exception 'sender is not a group member' using errcode = '42501';
  end if;
  if p_payload->>'type' in (
       'gather', 'find_gathering', 'depart', 'rest', 'be_careful',
       'go_left', 'go_right', 'stop', 'hurry_up'
     ) and v_sender_role <> 'leader' then
    raise exception 'leader command requires leader membership' using errcode = '42501';
  end if;

  v_category := case when v_sender_role = 'leader'
                     then 'leader_commands' else 'follower_requests' end;
  v_target_role := case when p_payload->>'type' = 'request_start'
                        then 'leader' else 'member' end;
  v_expires := least(
    coalesce(p_received_at, now()) + interval '5 minutes',
    coalesce(nullif(p_payload->>'expiresAt', '')::timestamptz,
             coalesce(p_received_at, now()) + interval '5 minutes')
  );
  -- A client may shorten a TTL but may never extend the server five-minute
  -- delivery window.  Already expired commands are accepted durable no-ops:
  -- keep the receipt, but do not create a notification or call APNs.
  if v_expires <= coalesce(p_received_at, now()) then
    return jsonb_build_object(
      'category', v_category,
      'targetRole', v_target_role,
      'targetCount', 0,
      'notificationIds', '[]'::jsonb,
      'expiresAt', v_expires,
      'expired', true
    );
  end if;

  for v_target in
    select m.user_id, m.role, m.subgroup_id
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id <> p_sender_id
      and (
        p_scope_subgroup_id is null
        or m.subgroup_id = p_scope_subgroup_id
        or m.role = 'leader'
      )
      and (
        (p_payload->>'type' = 'request_start' and m.role = 'leader')
        or (
          (p_payload->>'type') is distinct from 'request_start'
          and not coalesce(m.solo, false)
        )
      )
  loop
    select case v_category
      when 'leader_commands' then coalesce(np.leader_commands, true)
      when 'follower_requests' then coalesce(np.follower_requests, true)
      else coalesce(np.journey, true)
    end into v_pref
    from public.notification_preferences np
    where np.user_id = v_target.user_id;
    if coalesce(v_pref, true) then
      insert into public.core_notification_outbox(
        operation_id, group_id, sender_id, target_user_id,
        category, target_role, payload, created_at, expires_at
      ) values (
        p_operation_id, p_group_id, p_sender_id, v_target.user_id,
        v_category, case when v_target.role = 'leader' then 'leader' else 'member' end,
        coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
          'category', v_category,
          'groupId', p_group_id::text,
          'senderId', p_sender_id::text,
          'targetUserId', v_target.user_id::text,
          'expiresAt', v_expires
        ),
        coalesce(p_received_at, now()), v_expires
      )
      on conflict (operation_id, target_user_id) do nothing
      returning * into v_row;
      if found then
        v_targets := v_targets + 1;
        v_ids := v_ids || jsonb_build_array(v_row.id::text);
        begin
          -- send-push consumes a flat PushPayload.  Keep the complete command
          -- under payload as well, but mirror its routing fields at top level
          -- for older edge-function versions and include the server TTL.
          perform extensions.notify_push(jsonb_build_object(
            'type', v_row.payload->>'type',
            'message', v_row.payload->>'message',
            'latitude', v_row.payload->'latitude',
            'longitude', v_row.payload->'longitude',
            'expires_at', v_row.expires_at,
            'entity_id', v_row.operation_id,
            'operation_id', v_row.operation_id,
            'category', v_row.category,
            'group_id', v_row.group_id,
            'sender_id', v_row.sender_id,
            'target_user_id', v_row.target_user_id,
            'payload', v_row.payload
          ));
          update public.core_notification_outbox
          set delivery_status = 'attempted', attempted_at = now()
          where id = v_row.id and delivery_status = 'queued';
        exception when others then
          -- There is no queue worker in this migration.  Record that a
          -- delivery attempt happened instead of leaving a permanently
          -- indistinguishable queued row; a later worker may retry attempted.
          update public.core_notification_outbox
          set delivery_status = 'attempted', attempted_at = now()
          where id = v_row.id and delivery_status = 'queued';
        end;
      end if;
    end if;
  end loop;
  return jsonb_build_object(
    'category', v_category,
    'targetRole', v_target_role,
    'targetCount', v_targets,
    'notificationIds', v_ids,
    'expiresAt', v_expires
  );
end;
$$;
revoke all on function public.core_v3_enqueue_notification(
  uuid, uuid, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;

-- Older clients populated dependency_ids with a whole actor/group FIFO.  v3
-- keeps that wire field for compatibility but only treats a dependency as a
-- prerequisite when it addresses the same logical resource/lane.  A failed
-- unrelated edit therefore cannot block an independent add.
create or replace function public.core_v3_operation_resource_key(
  p_operation_type text,
  p_entity_type text,
  p_entity_id text,
  p_payload jsonb,
  p_session_id uuid,
  p_scope_key text,
  p_operation_id uuid default null
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_operation_type in (
      'record_arrival', 'leader_correct_arrival', 'correct_arrival'
    ) then 'session:' || coalesce(
      p_session_id::text,
      nullif(p_payload->>'navigationSessionId', ''),
      nullif(p_payload->>'sessionId', ''),
      'missing'
    )
    when p_operation_type in ('start_gathering', 'switch_gathering', 'start_session')
      and nullif(p_payload->>'navigationRequestId', '') is not null
      then 'session:' || (p_payload->>'navigationRequestId')
    when p_operation_type in (
      'end_gathering', 'complete_gathering', 'end_session', 'complete_session'
    ) and coalesce(
      nullif(p_payload->>'navigationSessionId', ''),
      nullif(p_payload->>'sessionId', '')
    ) is not null
      then 'session:' || coalesce(
        nullif(p_payload->>'navigationSessionId', ''),
        nullif(p_payload->>'sessionId', '')
      )
    when p_operation_type in (
      'start_gathering', 'switch_gathering', 'end_gathering',
      'complete_gathering', 'start_session', 'end_session', 'complete_session'
    ) then 'scope:' || coalesce(p_scope_key, 'main')
    when p_operation_type in (
      'add_destination', 'edit_destination', 'delete_destination',
      'set_destination_meet_time', 'complete_destination'
    ) then 'destination:' || coalesce(
      nullif(p_payload->>'destinationId', ''),
      nullif(p_payload->>'activeDestinationId', ''),
      p_entity_id
    )
    when p_operation_type = 'reorder_destinations'
      then 'itinerary-reorder:' || p_entity_id
    when p_operation_type = 'send_command'
      then 'command:' || coalesce(p_operation_id::text, p_entity_id)
    else coalesce(p_entity_type, '') || ':' || coalesce(p_entity_id, '')
  end;
$$;
revoke all on function public.core_v3_operation_resource_key(
  text, text, text, jsonb, uuid, text, uuid
) from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- v3 operation RPC
-- -------------------------------------------------------------------------

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
    if p_operation_type in ('end_gathering','end_session','complete_gathering','complete_session')
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
      select * into v_session from public.navigation_sessions s
      where s.id = v_session_id and s.group_id = p_group_id for update;
      if not found then raise exception 'navigation session not found' using errcode = 'P0002'; end if;
      if v_session.scope_key <> v_scope_key then
        raise exception 'session scope mismatch' using errcode = '42501';
      end if;
      if v_session.status = 'active' then
        update public.navigation_sessions
        set status = 'cancelled', ended_at = now(), version = version + 1, updated_at = now()
        where id = v_session.id returning * into v_session;
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
      v_point_statuses := coalesce(v_row.state->'pointStatuses', '{}'::jsonb);
      if v_session.destination_id is not null then
        v_point_statuses := v_point_statuses ||
          jsonb_build_object(v_session.destination_id::text, 'pending');
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
                                    'pointStatuses', v_point_statuses,
                                    'phaseChangedAt', (extract(epoch from coalesce(v_session.ended_at, now())) * 1000)::bigint,
                                    'entityVersion', v_next_version);

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

-- -------------------------------------------------------------------------
-- Legacy compatibility entry points
-- -------------------------------------------------------------------------
--
-- The old navigation RPCs did not carry a scope.  Their only safe meaning is
-- the main-team lane; replacing their bodies here prevents an old client from
-- cancelling a concurrently active subgroup session.  The return signatures
-- are unchanged, and request_id remains the idempotency key.

create or replace function public.start_navigation_session(
  p_group_id uuid,
  p_destination_id uuid,
  p_request_id uuid
)
returns public.navigation_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.navigation_sessions;
  v_active public.navigation_sessions;
  v_result jsonb;
  v_sequence bigint;
  v_message text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request id is required' using errcode = '22023';
  end if;
  if not public.can_manage_itinerary_scope(p_group_id, null, v_uid) then
    raise exception 'main-team leader membership required' using errcode = '42501';
  end if;

  select s.* into v_existing
  from public.navigation_sessions s
  where s.group_id = p_group_id and s.request_id = p_request_id;
  if found then
    if v_existing.scope_key <> 'main' or v_existing.scope_subgroup_id is not null then
      raise exception 'legacy navigation RPC cannot address a subgroup session'
        using errcode = '42501';
    end if;
    return v_existing;
  end if;

  -- Preserve the old same-destination retry behavior without touching the
  -- independent subgroup lane. A switch RPC below deliberately does not use
  -- this short-circuit.
  select s.* into v_active
  from public.navigation_sessions s
  where s.group_id = p_group_id and s.scope_key = 'main' and s.status = 'active'
  order by s.started_at desc
  limit 1
  for update;
  if found and v_active.destination_id = p_destination_id then
    return v_active;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_group_id::text || ':legacy:' || v_uid::text));
  select coalesce(max(o.client_sequence), 0) + 1 into v_sequence
  from public.core_operations o
  where o.group_id = p_group_id and o.actor_id = v_uid;
  v_result := public.apply_core_operation_v3(
    p_request_id, p_group_id, v_uid, 'active_gathering', p_group_id::text, 0,
    'start_gathering',
    jsonb_build_object(
      'activeDestinationId', p_destination_id::text,
      'navigationRequestId', p_request_id::text,
      'scope', 'main',
      'subgroupId', null
    ),
    v_sequence, '{}'::uuid[], now()
  );
  if v_result->>'status' not in ('accepted', 'duplicate') then
    v_message := coalesce(v_result->'conflict'->>'message', 'navigation session start rejected');
    raise exception '%', v_message using errcode = '55000';
  end if;
  select s.* into v_existing
  from public.navigation_sessions s
  where s.group_id = p_group_id and s.request_id = p_request_id
    and s.scope_key = 'main';
  if not found then
    raise exception 'navigation session was not created' using errcode = 'P0002';
  end if;
  return v_existing;
end;
$$;

revoke all on function public.start_navigation_session(uuid, uuid, uuid) from public, anon;
grant execute on function public.start_navigation_session(uuid, uuid, uuid) to authenticated;

create or replace function public.start_navigation_session_switch(
  p_group_id uuid,
  p_destination_id uuid,
  p_request_id uuid
)
returns public.navigation_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.navigation_sessions;
  v_result jsonb;
  v_sequence bigint;
  v_message text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request id is required' using errcode = '22023';
  end if;
  if not public.can_manage_itinerary_scope(p_group_id, null, v_uid) then
    raise exception 'main-team leader membership required' using errcode = '42501';
  end if;
  select s.* into v_existing
  from public.navigation_sessions s
  where s.group_id = p_group_id and s.request_id = p_request_id;
  if found then
    if v_existing.scope_key <> 'main' or v_existing.scope_subgroup_id is not null then
      raise exception 'legacy navigation RPC cannot address a subgroup session'
        using errcode = '42501';
    end if;
    return v_existing;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_group_id::text || ':legacy:' || v_uid::text));
  select coalesce(max(o.client_sequence), 0) + 1 into v_sequence
  from public.core_operations o
  where o.group_id = p_group_id and o.actor_id = v_uid;
  v_result := public.apply_core_operation_v3(
    p_request_id, p_group_id, v_uid, 'active_gathering', p_group_id::text, 0,
    'switch_gathering',
    jsonb_build_object(
      'activeDestinationId', p_destination_id::text,
      'navigationRequestId', p_request_id::text,
      'scope', 'main',
      'subgroupId', null
    ),
    v_sequence, '{}'::uuid[], now()
  );
  if v_result->>'status' not in ('accepted', 'duplicate') then
    v_message := coalesce(v_result->'conflict'->>'message', 'navigation session switch rejected');
    raise exception '%', v_message using errcode = '55000';
  end if;
  select s.* into v_existing
  from public.navigation_sessions s
  where s.group_id = p_group_id and s.request_id = p_request_id
    and s.scope_key = 'main';
  if not found then
    raise exception 'navigation session was not created' using errcode = 'P0002';
  end if;
  return v_existing;
end;
$$;

revoke all on function public.start_navigation_session_switch(uuid, uuid, uuid) from public, anon;
grant execute on function public.start_navigation_session_switch(uuid, uuid, uuid) to authenticated;

-- v2 keeps its exact wire signature, but uses the scope-aware v3 engine. This
-- is important for old end/switch clients: the former implementation looked
-- up the latest session by group and could cancel a subgroup session. v3
-- requires the original session id for end/complete and locks one scope lane.
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
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_existing public.core_operations%rowtype;
  v_destination_id uuid;
  v_subgroup_id uuid;
  v_session_id uuid;
begin
  -- Old v2 end/complete envelopes did not always carry a session id. Infer
  -- one only inside the destination's or caller's scope, and persist that
  -- inference in the operation payload so a replay with the same id remains
  -- byte-compatible and cannot bind to a newer session.
  if nullif(v_payload->>'navigationSessionId', '') is null
     and nullif(v_payload->>'sessionId', '') is null then
    -- A first invocation may infer a session. On replay, prefer the stored
    -- identity so the same operation cannot bind to a newer session.
    select * into v_existing
    from public.core_operations o
    where o.operation_id = p_operation_id;
    if found and nullif(v_existing.payload->>'navigationSessionId', '') is not null then
      v_payload := v_payload || jsonb_build_object(
        'navigationSessionId', v_existing.payload->>'navigationSessionId'
      );
      if v_existing.payload ? 'subgroupId' then
        v_payload := v_payload || jsonb_build_object(
          'subgroupId', v_existing.payload->'subgroupId'
        );
      end if;
    elsif p_operation_type in (
            'end_gathering', 'end_session', 'complete_gathering',
            'complete_session'
          ) then
      begin
        v_destination_id := coalesce(
          nullif(v_payload->>'activeDestinationId', '')::uuid,
          nullif(v_payload->>'destinationId', '')::uuid
        );
        v_subgroup_id := coalesce(
          nullif(v_payload->>'scopeSubgroupId', '')::uuid,
          nullif(v_payload->>'subgroupId', '')::uuid
        );
      exception when others then
        v_destination_id := null;
        v_subgroup_id := null;
      end;
      if v_subgroup_id is null and v_destination_id is not null then
        select i.subgroup_id into v_subgroup_id
        from public.itinerary_items i
        where i.id = v_destination_id and i.group_id = p_group_id;
      end if;
      if v_subgroup_id is null and not exists (
        select 1 from public.memberships m
        where m.group_id = p_group_id and m.user_id = p_actor_id
          and m.role = 'leader' and m.subgroup_id is null
      ) then
        select m.subgroup_id into v_subgroup_id
        from public.memberships m
        where m.group_id = p_group_id and m.user_id = p_actor_id
          and m.subgroup_id is not null
        order by m.subgroup_id
        limit 1;
      end if;
      select s.id into v_session_id
      from public.navigation_sessions s
      where s.group_id = p_group_id
        and s.scope_key = coalesce(v_subgroup_id::text, 'main')
        and s.status = 'active'
        and (v_destination_id is null or s.destination_id = v_destination_id)
      order by s.started_at desc
      limit 1;
      if v_session_id is not null then
        v_payload := v_payload || jsonb_build_object(
          'navigationSessionId', v_session_id::text,
          'subgroupId', v_subgroup_id
        );
      end if;
    end if;
  end if;
  return public.apply_core_operation_v3(
    p_operation_id, p_group_id, p_actor_id, p_entity_type, p_entity_id,
    p_entity_version, p_operation_type, v_payload, p_sequence,
    p_dependency_ids, p_created_at
  );
end;
$$;

revoke all on function public.apply_core_operation_v2(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz
) from public, anon;
grant execute on function public.apply_core_operation_v2(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz
) to authenticated;

revoke all on function public.apply_core_operation_v3(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz
) from public, anon;
grant execute on function public.apply_core_operation_v3(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz
) to authenticated;

comment on function public.apply_core_operation_v3(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz
) is
  'v3 silent sync RPC. Payload carries deviceId, scope/scopeSubgroupId, sessionId/navigationSessionId, occurredAt, and operation-specific fields. Set rebase=true to retry an existing conflict with the same operationId.';

commit;
