-- Production APNs, persisted journey target, sticky 30 m arrival, and
-- per-user ActivityKit push sessions. Secret values are provisioned outside
-- migrations in Edge Function Secrets and Supabase Vault.

-- -------------------------------------------------------------------------
-- Authoritative journey target
-- -------------------------------------------------------------------------

alter table public.groups
  add column if not exists active_destination_id uuid
    references public.itinerary_items(id) on delete set null,
  add column if not exists journey_started_at timestamptz;

create index if not exists idx_groups_active_destination_id
  on public.groups(active_destination_id)
  where active_destination_id is not null;

-- The client already supports a personal `custom` Quick Command. Keep the DB
-- contract aligned so production inserts are not rejected.
alter table public.commands drop constraint if exists commands_type_check;
alter table public.commands
  add constraint commands_type_check check (type in (
    'gather','find_gathering','depart','rest','be_careful',
    'go_left','go_right','stop','hurry_up',
    'need_restroom','need_break','need_help','found_something','custom'
  ));

-- -------------------------------------------------------------------------
-- Per-user Live Activity sessions
-- -------------------------------------------------------------------------

create table public.live_activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  destination_id uuid not null references public.itinerary_items(id) on delete cascade,
  activity_id text not null,
  push_token text unique,
  initial_distance_m double precision not null check (initial_distance_m > 0),
  current_distance_m double precision not null check (current_distance_m >= 0),
  eta_seconds integer check (eta_seconds is null or eta_seconds >= 0),
  travel_mode text not null check (travel_mode in ('walk','transit','drive')),
  last_progress_bucket integer not null default 0
    check (last_progress_bucket between 0 and 20),
  expires_at timestamptz not null default (now() + interval '8 hours'),
  updated_at timestamptz not null default now(),
  unique (user_id, group_id)
);

create index idx_live_activity_sessions_group_id
  on public.live_activity_sessions(group_id);
create index idx_live_activity_sessions_destination_id
  on public.live_activity_sessions(destination_id);
create index idx_live_activity_sessions_expires_at
  on public.live_activity_sessions(expires_at);

alter table public.live_activity_sessions enable row level security;

create policy "live_activity_sessions: select own"
  on public.live_activity_sessions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "live_activity_sessions: write own"
  on public.live_activity_sessions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and extensions.is_member(group_id)
  );

grant select, insert, update, delete
  on public.live_activity_sessions to authenticated;

alter publication supabase_realtime
  add table public.live_activity_sessions;

-- -------------------------------------------------------------------------
-- Distance and journey RPC
-- -------------------------------------------------------------------------

create or replace function extensions.distance_meters(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
)
returns double precision
language sql
immutable
strict
set search_path = ''
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
      * power(sin(radians(lon2 - lon1) / 2), 2)
  )));
$$;

revoke all on function extensions.distance_meters(
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;

create or replace function public.set_journey_target(
  p_group_id uuid,
  p_destination_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  if p_destination_id is not null and not exists (
    select 1
    from public.itinerary_items i
    where i.id = p_destination_id
      and i.group_id = p_group_id
  ) then
    raise exception 'destination does not belong to group' using errcode = '23503';
  end if;

  update public.memberships
  set status = 'active'
  where status = 'arrived'
    and group_id = p_group_id;

  update public.groups
  set active_destination_id = p_destination_id,
      journey_started_at = case when p_destination_id is null then null else now() end,
      journey_status = case when p_destination_id is null then 'paused' else 'going' end
  where id = p_group_id;
end;
$$;

revoke all on function public.set_journey_target(uuid, uuid) from public, anon;
grant execute on function public.set_journey_target(uuid, uuid) to authenticated;

-- Direct group updates still pass through the existing leader RLS policy. This
-- trigger additionally prevents a destination from another group being used.
create or replace function public.validate_active_destination()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active_destination_id is not null and not exists (
    select 1 from public.itinerary_items i
    where i.id = new.active_destination_id and i.group_id = new.id
  ) then
    raise exception 'destination does not belong to group' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_active_destination on public.groups;
create trigger trg_validate_active_destination
  before insert or update of active_destination_id on public.groups
  for each row execute function public.validate_active_destination();

-- -------------------------------------------------------------------------
-- Vault-authenticated Edge Function webhook
-- -------------------------------------------------------------------------

create or replace function extensions.notify_push(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := current_setting('app.settings.edge_url', true);
  v_secret text;
begin
  select ds.decrypted_secret
  into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'push_webhook_secret'
  order by ds.created_at desc
  limit 1;

  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hither-webhook-secret', v_secret
    ),
    body := payload
  );
end;
$$;

revoke all on function extensions.notify_push(jsonb)
  from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- Location -> personal progress + sticky arrival
-- -------------------------------------------------------------------------

create or replace function public.on_member_location_arrival()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destination_id uuid;
  v_destination_lat double precision;
  v_destination_lon double precision;
  v_distance_m double precision;
begin
  if new.latitude is null or new.longitude is null then
    return new;
  end if;

  select g.active_destination_id, i.latitude, i.longitude
  into v_destination_id, v_destination_lat, v_destination_lon
  from public.groups g
  join public.itinerary_items i on i.id = g.active_destination_id
  where g.id = new.group_id
    and g.journey_status = 'going';

  if v_destination_id is null
     or v_destination_lat is null
     or v_destination_lon is null then
    return new;
  end if;

  v_distance_m := extensions.distance_meters(
    new.latitude,
    new.longitude,
    v_destination_lat,
    v_destination_lon
  );

  update public.live_activity_sessions s
  set current_distance_m = v_distance_m,
      eta_seconds = round(v_distance_m / case s.travel_mode
        when 'drive' then 13.9
        when 'transit' then 8.3
        else 1.4
      end)::integer,
      last_progress_bucket = floor(
        greatest(0, least(1, 1 - v_distance_m / s.initial_distance_m)) * 20
      )::integer,
      updated_at = now()
  where s.group_id = new.group_id
    and s.user_id = new.user_id
    and s.destination_id = v_destination_id;

  if v_distance_m <= 30 then
    update public.memberships m
    set status = 'arrived'
    where m.group_id = new.group_id
      and m.user_id = new.user_id
      and m.status <> 'arrived';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_member_location_arrival on public.member_locations;
create trigger trg_member_location_arrival
  after insert or update of latitude, longitude on public.member_locations
  for each row execute function public.on_member_location_arrival();

-- A personal bucket change can refresh that member's Live Activity remotely.
create or replace function public.on_live_activity_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_progress_bucket is distinct from old.last_progress_bucket
     or abs(new.current_distance_m - old.current_distance_m) >= 50
     or abs(coalesce(new.eta_seconds, 0) - coalesce(old.eta_seconds, 0)) >= 60 then
    perform extensions.notify_push(jsonb_build_object(
      'category', 'live_activity',
      'group_id', new.group_id,
      'sender_id', new.user_id,
      'target_user_id', new.user_id,
      'destination_id', new.destination_id
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_live_activity_progress on public.live_activity_sessions;
create trigger trg_live_activity_progress
  after update of current_distance_m, eta_seconds, last_progress_bucket
  on public.live_activity_sessions
  for each row execute function public.on_live_activity_progress();

-- Team arrival/straggler changes update every member's Activity and also drive
-- the matching general APNs notification from the same Edge Function request.
create or replace function public.on_membership_presence_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
begin
  if new.status = 'arrived' and old.status is distinct from 'arrived' then
    v_category := 'arrival';
  elsif (new.solo and not old.solo)
        or (new.status in ('idle', 'offline') and old.status = 'active') then
    v_category := 'straggler';
  else
    return new;
  end if;

  perform extensions.notify_push(jsonb_build_object(
    'category', v_category,
    'group_id', new.group_id,
    'sender_id', new.user_id,
    'member_id', new.user_id
  ));
  return new;
end;
$$;

drop trigger if exists trg_membership_presence_change on public.memberships;
create trigger trg_membership_presence_change
  after update of status, solo on public.memberships
  for each row execute function public.on_membership_presence_change();

alter table public.memberships replica identity full;

