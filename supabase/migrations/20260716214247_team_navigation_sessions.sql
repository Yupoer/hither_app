-- Durable team-navigation sessions, privacy-aware location ingestion, and
-- bounded diagnostic ingestion. PostgreSQL owns lifecycle correctness;
-- Realtime/APNs are delivery channels only.

-- -------------------------------------------------------------------------
-- Privacy and session state
-- -------------------------------------------------------------------------

create table public.member_privacy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sharing_enabled boolean not null default true,
  local_navigation_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.navigation_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  destination_id uuid not null references public.itinerary_items(id) on delete restrict,
  destination_name text not null,
  destination_latitude double precision not null check (destination_latitude between -90 and 90),
  destination_longitude double precision not null check (destination_longitude between -180 and 180),
  arrival_radius_m integer not null default 50 check (arrival_radius_m between 10 and 500),
  started_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 hours'),
  status text not null default 'active'
    check (status in ('active','cancelled','expired','completed')),
  version integer not null default 1 check (version > 0),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, request_id)
);

create unique index navigation_sessions_one_active_group
  on public.navigation_sessions(group_id) where status = 'active';
create index navigation_sessions_group_started
  on public.navigation_sessions(group_id, started_at desc);
create index navigation_sessions_destination_id
  on public.navigation_sessions(destination_id);
create index navigation_sessions_started_by
  on public.navigation_sessions(started_by);
create index navigation_sessions_expires_at
  on public.navigation_sessions(expires_at) where status = 'active';

create table public.navigation_member_states (
  navigation_session_id uuid not null
    references public.navigation_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_status text not null default 'pending' check (local_status in (
    'pending','activity_started','tracking_active','permission_denied',
    'location_disabled','app_force_quit_suspected','offline','push_unavailable',
    'sharing_disabled','arriving','arrived','cancelled'
  )),
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 8192),
  latest_distance_m double precision check (latest_distance_m is null or latest_distance_m >= 0),
  latest_accuracy_m double precision check (latest_accuracy_m is null or latest_accuracy_m >= 0),
  live_activity_id text,
  acknowledged_at timestamptz,
  arrived_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (navigation_session_id, user_id)
);

create index navigation_member_states_user_id
  on public.navigation_member_states(user_id);

create table public.device_live_activity_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 8 and 200),
  push_to_start_token text,
  live_activities_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id),
  check (push_to_start_token is null or length(push_to_start_token) between 32 and 512)
);

create unique index device_live_activity_tokens_token
  on public.device_live_activity_tokens(push_to_start_token)
  where push_to_start_token is not null;

-- -------------------------------------------------------------------------
-- Idempotent location and diagnostic events
-- -------------------------------------------------------------------------

alter table public.member_locations add column if not exists horizontal_accuracy double precision;
alter table public.member_locations add column if not exists speed double precision;
alter table public.member_locations add column if not exists course double precision;
alter table public.member_locations add column if not exists captured_at timestamptz;
alter table public.member_locations add column if not exists tracking_mode text;
alter table public.member_locations add column if not exists navigation_session_id uuid
  references public.navigation_sessions(id) on delete set null;
alter table public.member_locations add column if not exists source text;
alter table public.member_locations add column if not exists sequence bigint;

create index if not exists member_locations_navigation_session_id
  on public.member_locations(navigation_session_id)
  where navigation_session_id is not null;

create table public.location_upload_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  navigation_session_id uuid references public.navigation_sessions(id) on delete set null,
  captured_at timestamptz not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  horizontal_accuracy double precision not null check (horizontal_accuracy >= 0),
  speed double precision,
  course double precision,
  tracking_mode text not null check (tracking_mode in (
    'passiveBackground','foreground','teamNavigation','navigationMax','manualHighAccuracy'
  )),
  source text not null check (source in (
    'foreground','background_task','refresh_request','location_push'
  )),
  sequence bigint not null check (sequence >= 0),
  ingested_at timestamptz not null default now()
);

create index location_upload_events_user_captured
  on public.location_upload_events(user_id, captured_at desc);
create index location_upload_events_group_captured
  on public.location_upload_events(group_id, captured_at desc);
create index location_upload_events_navigation_session_id
  on public.location_upload_events(navigation_session_id)
  where navigation_session_id is not null;

create table public.diagnostic_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 8 and 200),
  build_number text not null check (length(build_number) between 1 and 50),
  app_version text not null check (length(app_version) between 1 and 50),
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index diagnostic_sessions_user_started
  on public.diagnostic_sessions(user_id, started_at desc);

create table public.diagnostic_events (
  id uuid primary key,
  diagnostic_session_id uuid not null references public.diagnostic_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null,
  event text not null check (event in (
    'location_task_registered','location_task_unregistered','location_callback',
    'location_valid','location_rejected_accuracy','location_rejected_distance',
    'location_rejected_time','location_rejected_sharing_disabled',
    'location_outbox_enqueued','location_upload_started','location_upload_succeeded',
    'location_upload_failed','tracking_mode_changed','app_foreground','app_background',
    'app_inactive','team_navigation_received','team_navigation_acknowledged',
    'live_activity_start_requested','live_activity_started','live_activity_updated',
    'live_activity_ended','arrival_candidate','arrival_confirmed',
    'high_accuracy_started','high_accuracy_stopped','refresh_request_received',
    'refresh_request_completed','refresh_request_timeout','permission_changed',
    'metric_payload_received','diagnostic_error'
  )),
  navigation_session_id uuid references public.navigation_sessions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8192),
  created_at timestamptz not null default now()
);

create index diagnostic_events_session_occurred
  on public.diagnostic_events(diagnostic_session_id, occurred_at);
create index diagnostic_events_user_occurred
  on public.diagnostic_events(user_id, occurred_at desc);
create index diagnostic_events_navigation_session_id
  on public.diagnostic_events(navigation_session_id)
  where navigation_session_id is not null;

create table public.metric_payloads (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 8 and 200),
  kind text not null check (kind in ('metric','diagnostic')),
  payload jsonb not null check (octet_length(payload::text) <= 1048576),
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index metric_payloads_user_received
  on public.metric_payloads(user_id, received_at desc);

-- -------------------------------------------------------------------------
-- RLS and explicit Data API grants
-- -------------------------------------------------------------------------

alter table public.member_privacy_settings enable row level security;
alter table public.navigation_sessions enable row level security;
alter table public.navigation_member_states enable row level security;
alter table public.device_live_activity_tokens enable row level security;
alter table public.location_upload_events enable row level security;
alter table public.diagnostic_sessions enable row level security;
alter table public.diagnostic_events enable row level security;
alter table public.metric_payloads enable row level security;

create policy "member_privacy_settings: own rows"
  on public.member_privacy_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "navigation_sessions: group members read"
  on public.navigation_sessions for select to authenticated
  using (extensions.is_member(group_id));

create policy "navigation_sessions: leaders insert"
  on public.navigation_sessions for insert to authenticated
  with check (
    started_by = (select auth.uid())
    and exists (
      select 1 from public.memberships m
      where m.group_id = navigation_sessions.group_id
        and m.user_id = (select auth.uid())
        and m.role = 'leader'
    )
  );

create policy "navigation_sessions: leaders update"
  on public.navigation_sessions for update to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.group_id = navigation_sessions.group_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ))
  with check (exists (
    select 1 from public.memberships m
    where m.group_id = navigation_sessions.group_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ));

create policy "navigation_member_states: group members read"
  on public.navigation_member_states for select to authenticated
  using (exists (
    select 1 from public.navigation_sessions s
    where s.id = navigation_member_states.navigation_session_id
      and extensions.is_member(s.group_id)
  ));

create policy "navigation_member_states: own insert"
  on public.navigation_member_states for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "navigation_member_states: own update"
  on public.navigation_member_states for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "device_live_activity_tokens: own rows"
  on public.device_live_activity_tokens for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "location_upload_events: own read"
  on public.location_upload_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy "location_upload_events: own insert"
  on public.location_upload_events for insert to authenticated
  with check (user_id = (select auth.uid()) and extensions.is_member(group_id));

create policy "diagnostic_sessions: own rows"
  on public.diagnostic_sessions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "diagnostic_events: own read"
  on public.diagnostic_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy "diagnostic_events: own insert"
  on public.diagnostic_events for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "metric_payloads: own read"
  on public.metric_payloads for select to authenticated
  using (user_id = (select auth.uid()));
create policy "metric_payloads: own insert"
  on public.metric_payloads for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on public.member_privacy_settings from anon, authenticated;
revoke all on public.navigation_sessions from anon, authenticated;
revoke all on public.navigation_member_states from anon, authenticated;
revoke all on public.device_live_activity_tokens from anon, authenticated;
revoke all on public.location_upload_events from anon, authenticated;
revoke all on public.diagnostic_sessions from anon, authenticated;
revoke all on public.diagnostic_events from anon, authenticated;
revoke all on public.metric_payloads from anon, authenticated;

grant select, insert, update, delete on public.member_privacy_settings to authenticated;
grant select, insert, update on public.navigation_sessions to authenticated;
grant select, insert, update on public.navigation_member_states to authenticated;
grant select, insert, update, delete on public.device_live_activity_tokens to authenticated;
grant select, insert on public.location_upload_events to authenticated;
grant select, insert, update on public.diagnostic_sessions to authenticated;
grant select, insert on public.diagnostic_events to authenticated;
grant select, insert on public.metric_payloads to authenticated;

-- -------------------------------------------------------------------------
-- Trigger helpers
-- -------------------------------------------------------------------------

create or replace function public.seed_navigation_member_states()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.navigation_member_states (
    navigation_session_id, user_id, local_status
  )
  select new.id, m.user_id, 'pending'
  from public.memberships m
  where m.group_id = new.group_id
  on conflict (navigation_session_id, user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.seed_navigation_member_states()
  from public, anon, authenticated;

create trigger trg_seed_navigation_member_states
  after insert on public.navigation_sessions
  for each row execute function public.seed_navigation_member_states();

create or replace function public.on_navigation_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.version is distinct from old.version then
    perform extensions.notify_push(jsonb_build_object(
      'category', 'navigation_session',
      'group_id', new.group_id,
      'sender_id', new.started_by,
      'session_id', new.id,
      'destination_id', new.destination_id,
      'status', new.status,
      'version', new.version
    ));
  end if;
  return new;
end;
$$;

revoke execute on function public.on_navigation_session_change()
  from public, anon, authenticated;

create trigger trg_navigation_session_push
  after insert or update on public.navigation_sessions
  for each row execute function public.on_navigation_session_change();

-- The legacy trigger marked arrival after one raw <=30m fix. Session arrival
-- now requires client-side accuracy filtering and two consecutive fixes.
drop trigger if exists trg_member_location_arrival on public.member_locations;

-- -------------------------------------------------------------------------
-- Navigation commands (SECURITY INVOKER by default)
-- -------------------------------------------------------------------------

create or replace function public.start_navigation_session(
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
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  select s.* into v_existing
  from public.navigation_sessions s
  where s.group_id = p_group_id and s.request_id = p_request_id;
  if found then
    return v_existing;
  end if;

  update public.navigation_sessions
  set status = 'expired', ended_at = now(), version = version + 1, updated_at = now()
  where group_id = p_group_id and status = 'active' and expires_at <= now();

  if exists (
    select 1 from public.navigation_sessions s
    where s.group_id = p_group_id and s.status = 'active'
  ) then
    raise exception 'active navigation session exists' using errcode = '55000';
  end if;

  select i.* into v_destination
  from public.itinerary_items i
  where i.id = p_destination_id and i.group_id = p_group_id;
  if not found or v_destination.latitude is null or v_destination.longitude is null then
    raise exception 'destination does not belong to group or has no coordinates'
      using errcode = '23503';
  end if;

  insert into public.navigation_sessions (
    group_id, destination_id, destination_name,
    destination_latitude, destination_longitude, started_by, request_id
  ) values (
    p_group_id, p_destination_id, v_destination.title,
    v_destination.latitude, v_destination.longitude,
    (select auth.uid()), p_request_id
  ) returning * into v_session;

  update public.memberships
  set status = 'active'
  where group_id = p_group_id and status = 'arrived';

  update public.groups
  set journey_status = 'going',
      active_destination_id = p_destination_id,
      journey_started_at = v_session.started_at
  where id = p_group_id;

  return v_session;
end;
$$;

create or replace function public.cancel_navigation_session(
  p_session_id uuid,
  p_expected_version integer
)
returns public.navigation_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.navigation_sessions;
begin
  update public.navigation_sessions s
  set status = 'cancelled', ended_at = now(), version = s.version + 1, updated_at = now()
  where s.id = p_session_id
    and s.status = 'active'
    and s.version = p_expected_version
  returning * into v_session;
  if not found then
    raise exception 'active navigation session version mismatch' using errcode = '40001';
  end if;

  update public.groups
  set journey_status = 'paused', active_destination_id = null, journey_started_at = null
  where id = v_session.group_id;
  return v_session;
end;
$$;

create or replace function public.complete_navigation_session(
  p_session_id uuid,
  p_expected_version integer
)
returns public.navigation_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.navigation_sessions;
begin
  update public.navigation_sessions s
  set status = 'completed', ended_at = now(), version = s.version + 1, updated_at = now()
  where s.id = p_session_id
    and s.status = 'active'
    and s.version = p_expected_version
  returning * into v_session;
  if not found then
    raise exception 'active navigation session version mismatch' using errcode = '40001';
  end if;

  update public.groups
  set journey_status = 'paused', active_destination_id = null, journey_started_at = null
  where id = v_session.group_id;
  return v_session;
end;
$$;

create or replace function public.ack_navigation_session(
  p_session_id uuid,
  p_status text,
  p_detail jsonb default '{}'::jsonb
)
returns public.navigation_member_states
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_state public.navigation_member_states;
  v_group_id uuid;
begin
  if p_status not in (
    'pending','activity_started','tracking_active','permission_denied',
    'location_disabled','app_force_quit_suspected','offline','push_unavailable',
    'sharing_disabled','arriving','arrived','cancelled'
  ) then
    raise exception 'invalid navigation member status' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_detail, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_detail, '{}'::jsonb)::text) > 8192 then
    raise exception 'invalid navigation member detail' using errcode = '22023';
  end if;

  select s.group_id into v_group_id
  from public.navigation_sessions s
  where s.id = p_session_id and extensions.is_member(s.group_id);
  if not found then
    raise exception 'navigation session not found' using errcode = 'P0002';
  end if;

  insert into public.navigation_member_states (
    navigation_session_id, user_id, local_status, detail,
    acknowledged_at, arrived_at, updated_at
  ) values (
    p_session_id, (select auth.uid()), p_status, coalesce(p_detail, '{}'::jsonb),
    now(), case when p_status = 'arrived' then now() else null end, now()
  )
  on conflict (navigation_session_id, user_id) do update
  set local_status = excluded.local_status,
      detail = excluded.detail,
      acknowledged_at = excluded.acknowledged_at,
      arrived_at = case
        when excluded.local_status = 'arrived'
          then coalesce(public.navigation_member_states.arrived_at, excluded.arrived_at)
        else public.navigation_member_states.arrived_at
      end,
      updated_at = excluded.updated_at
  returning * into v_state;

  if p_status = 'arrived' then
    update public.memberships
    set status = 'arrived'
    where group_id = v_group_id and user_id = (select auth.uid());
  end if;
  return v_state;
end;
$$;

-- -------------------------------------------------------------------------
-- Privacy-aware batch ingestion
-- -------------------------------------------------------------------------

create or replace function public.ingest_location_batch(p_events jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event jsonb;
  v_id uuid;
  v_group_id uuid;
  v_session_id uuid;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) > 100
     or octet_length(p_events::text) > 262144 then
    raise exception 'location batch must contain at most 100 events'
      using errcode = '22023';
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    begin
      v_id := (v_event->>'id')::uuid;
      v_group_id := (v_event->>'groupId')::uuid;
      v_session_id := nullif(v_event->>'navigationSessionId', '')::uuid;

      if not extensions.is_member(v_group_id) then
        raise exception 'not a group member' using errcode = '42501';
      end if;
      if not coalesce((
        select p.sharing_enabled from public.member_privacy_settings p
        where p.user_id = (select auth.uid())
      ), true) then
        v_rejected := v_rejected || jsonb_build_array(
          jsonb_build_object('id', v_id, 'reason', 'sharing_disabled')
        );
        continue;
      end if;
      if v_session_id is not null and not exists (
        select 1 from public.navigation_sessions s
        where s.id = v_session_id and s.group_id = v_group_id
      ) then
        raise exception 'navigation session does not belong to group' using errcode = '23503';
      end if;

      insert into public.location_upload_events (
        id, user_id, group_id, navigation_session_id, captured_at,
        latitude, longitude, horizontal_accuracy, speed, course,
        tracking_mode, source, sequence
      ) values (
        v_id, (select auth.uid()), v_group_id, v_session_id,
        to_timestamp((v_event->>'capturedAt')::double precision / 1000.0),
        (v_event#>>'{coords,latitude}')::double precision,
        (v_event#>>'{coords,longitude}')::double precision,
        (v_event#>>'{coords,accuracy}')::double precision,
        nullif(v_event#>>'{coords,speed}', '')::double precision,
        nullif(v_event#>>'{coords,course}', '')::double precision,
        v_event->>'trackingMode', v_event->>'source',
        (v_event->>'sequence')::bigint
      ) on conflict (id) do nothing;

      insert into public.member_locations (
        group_id, user_id, latitude, longitude, updated_at,
        horizontal_accuracy, speed, course, captured_at,
        tracking_mode, navigation_session_id, source, sequence
      ) values (
        v_group_id, (select auth.uid()),
        (v_event#>>'{coords,latitude}')::double precision,
        (v_event#>>'{coords,longitude}')::double precision,
        now(), (v_event#>>'{coords,accuracy}')::double precision,
        nullif(v_event#>>'{coords,speed}', '')::double precision,
        nullif(v_event#>>'{coords,course}', '')::double precision,
        to_timestamp((v_event->>'capturedAt')::double precision / 1000.0),
        v_event->>'trackingMode', v_session_id, v_event->>'source',
        (v_event->>'sequence')::bigint
      )
      on conflict (group_id, user_id) do update
      set latitude = excluded.latitude,
          longitude = excluded.longitude,
          updated_at = excluded.updated_at,
          horizontal_accuracy = excluded.horizontal_accuracy,
          speed = excluded.speed,
          course = excluded.course,
          captured_at = excluded.captured_at,
          tracking_mode = excluded.tracking_mode,
          navigation_session_id = excluded.navigation_session_id,
          source = excluded.source,
          sequence = excluded.sequence
      where public.member_locations.captured_at is null
         or excluded.captured_at >= public.member_locations.captured_at;

      v_accepted := v_accepted || jsonb_build_array(v_id);
    exception
      when others then
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
          'id', coalesce(v_event->>'id', ''),
          'reason', case when sqlstate = '42501' then 'forbidden' else 'invalid_event' end
        ));
    end;
  end loop;

  return jsonb_build_object('acceptedIds', v_accepted, 'rejected', v_rejected);
end;
$$;

create or replace function public.ingest_diagnostic_batch(p_events jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event jsonb;
  v_id uuid;
  v_session_id uuid;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) > 100
     or octet_length(p_events::text) > 524288 then
    raise exception 'diagnostic batch must contain at most 100 events'
      using errcode = '22023';
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    begin
      v_id := (v_event->>'id')::uuid;
      v_session_id := (v_event->>'sessionId')::uuid;

      insert into public.diagnostic_sessions (
        id, user_id, device_id, build_number, app_version, started_at
      ) values (
        v_session_id, (select auth.uid()), v_event->>'deviceId',
        v_event->>'buildNumber', v_event->>'appVersion',
        to_timestamp((v_event->>'timestamp')::double precision / 1000.0)
      ) on conflict (id) do nothing;

      insert into public.diagnostic_events (
        id, diagnostic_session_id, user_id, occurred_at, event,
        navigation_session_id, payload
      ) values (
        v_id, v_session_id, (select auth.uid()),
        to_timestamp((v_event->>'timestamp')::double precision / 1000.0),
        v_event->>'event', nullif(v_event->>'navigationSessionId', '')::uuid,
        coalesce(v_event->'payload', '{}'::jsonb)
      ) on conflict (id) do nothing;
      v_accepted := v_accepted || jsonb_build_array(v_id);
    exception
      when others then
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
          'id', coalesce(v_event->>'id', ''), 'reason', 'invalid_event'
        ));
    end;
  end loop;
  return jsonb_build_object('acceptedIds', v_accepted, 'rejected', v_rejected);
end;
$$;

revoke all on function public.start_navigation_session(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.cancel_navigation_session(uuid, integer)
  from public, anon;
revoke all on function public.complete_navigation_session(uuid, integer)
  from public, anon;
revoke all on function public.ack_navigation_session(uuid, text, jsonb)
  from public, anon;
revoke all on function public.ingest_location_batch(jsonb)
  from public, anon;
revoke all on function public.ingest_diagnostic_batch(jsonb)
  from public, anon;

grant execute on function public.start_navigation_session(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.cancel_navigation_session(uuid, integer)
  to authenticated;
grant execute on function public.complete_navigation_session(uuid, integer)
  to authenticated;
grant execute on function public.ack_navigation_session(uuid, text, jsonb)
  to authenticated;
grant execute on function public.ingest_location_batch(jsonb)
  to authenticated;
grant execute on function public.ingest_diagnostic_batch(jsonb)
  to authenticated;

-- Realtime publication is idempotent across linked/local environments.
do $$
begin
  alter publication supabase_realtime add table public.navigation_sessions;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.navigation_member_states;
exception when duplicate_object then null;
end;
$$;
