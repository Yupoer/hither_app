-- Leader-approved gathering points, per-destination arrival completion, and
-- deletable history. Existing history rows remain valid and are not backfilled.

-- Followers, including subgroup members, may no longer mutate itineraries.
drop policy if exists "itinerary_items: insert if in that subgroup" on public.itinerary_items;
drop policy if exists "itinerary_items: update if in that subgroup" on public.itinerary_items;
drop policy if exists "itinerary_items: delete if in that subgroup" on public.itinerary_items;

create table public.gather_point_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  subgroup_id uuid references public.subgroups(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  items jsonb not null check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 100
  ),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_gather_point_requests_group_status
  on public.gather_point_requests(group_id, status, created_at);
alter table public.gather_point_requests enable row level security;
create policy "gather requests: requester or leader reads"
  on public.gather_point_requests for select to authenticated
  using (
    requester_id = (select auth.uid())
    or exists (
      select 1 from public.memberships m
      where m.group_id = gather_point_requests.group_id
        and m.user_id = (select auth.uid())
        and m.role = 'leader'
    )
  );
grant select on public.gather_point_requests to authenticated;

create or replace function public.submit_gather_point_request(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_member_subgroup uuid;
  v_item jsonb;
  v_lat double precision;
  v_lon double precision;
begin
  select m.subgroup_id into v_member_subgroup
  from public.memberships m
  where m.group_id = p_group_id and m.user_id = (select auth.uid());
  if not found then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  if v_member_subgroup is distinct from p_subgroup_id then
    raise exception 'request subgroup must match membership' using errcode = '42501';
  end if;
  if p_subgroup_id is not null and not exists (
    select 1 from public.subgroups s
    where s.id = p_subgroup_id and s.group_id = p_group_id
  ) then
    raise exception 'subgroup does not belong to group' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'items must contain 1 to 100 places' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or nullif(btrim(v_item->>'title'), '') is null
       or jsonb_typeof(v_item->'latitude') is distinct from 'number'
       or jsonb_typeof(v_item->'longitude') is distinct from 'number' then
      raise exception 'invalid gathering point' using errcode = '22023';
    end if;
    v_lat := (v_item->>'latitude')::double precision;
    v_lon := (v_item->>'longitude')::double precision;
    if v_lat not between -90 and 90 or v_lon not between -180 and 180 then
      raise exception 'invalid coordinates' using errcode = '22023';
    end if;
  end loop;

  insert into public.gather_point_requests(group_id, subgroup_id, requester_id, items)
  values (p_group_id, p_subgroup_id, (select auth.uid()), p_items)
  returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.resolve_gather_point_request(
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.gather_point_requests;
  v_item jsonb;
  v_position integer;
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
    end loop;
  end if;

  update public.gather_point_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_request_id;
end;
$$;
revoke all on function public.submit_gather_point_request(uuid, uuid, jsonb) from public, anon;
revoke all on function public.resolve_gather_point_request(uuid, boolean) from public, anon;
grant execute on function public.submit_gather_point_request(uuid, uuid, jsonb) to authenticated;
grant execute on function public.resolve_gather_point_request(uuid, boolean) to authenticated;

create or replace function public.on_gather_point_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform extensions.notify_push(jsonb_build_object(
    'category', 'gathering_request',
    'group_id', new.group_id,
    'sender_id', new.requester_id,
    'request_id', new.id,
    'title', coalesce(new.items->0->>'title', '集合點'),
    'count', jsonb_array_length(new.items)
  ));
  return new;
end;
$$;
create trigger trg_gather_point_request_insert
  after insert on public.gather_point_requests
  for each row execute function public.on_gather_point_request_insert();

create table public.destination_arrivals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  destination_id uuid not null references public.itinerary_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  arrived_at timestamptz not null default now(),
  source text not null check (source in ('automatic', 'manual')),
  marked_by uuid not null references auth.users(id) on delete cascade,
  unique (destination_id, user_id)
);
create index idx_destination_arrivals_group_destination
  on public.destination_arrivals(group_id, destination_id);
alter table public.destination_arrivals enable row level security;
create policy "destination arrivals: group members read"
  on public.destination_arrivals for select to authenticated
  using (extensions.is_member(group_id));
grant select on public.destination_arrivals to authenticated;

alter table public.visited_waypoints
  add column if not exists arrival_id uuid unique
    references public.destination_arrivals(id) on delete cascade,
  add column if not exists destination_id uuid
    references public.itinerary_items(id) on delete set null;

drop policy if exists "visited_waypoints: delete own or leader" on public.visited_waypoints;
create policy "visited_waypoints: delete own or leader"
  on public.visited_waypoints for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.memberships m
      where m.group_id = visited_waypoints.group_id
        and m.user_id = (select auth.uid())
        and m.role = 'leader'
    )
  );
grant delete on public.visited_waypoints to authenticated;

create or replace function public.record_destination_arrival(
  p_group_id uuid,
  p_destination_id uuid,
  p_user_id uuid,
  p_source text,
  p_marked_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arrival_id uuid;
  v_destination public.itinerary_items;
begin
  select * into v_destination from public.itinerary_items
  where id = p_destination_id and group_id = p_group_id;
  if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;

  insert into public.destination_arrivals(
    group_id, destination_id, user_id, source, marked_by
  ) values (p_group_id, p_destination_id, p_user_id, p_source, p_marked_by)
  on conflict (destination_id, user_id) do nothing
  returning id into v_arrival_id;

  if v_arrival_id is not null then
    insert into public.visited_waypoints(
      user_id, group_id, arrival_id, destination_id, name, latitude, longitude
    ) values (
      p_user_id, p_group_id, v_arrival_id, p_destination_id,
      v_destination.title, v_destination.latitude, v_destination.longitude
    );
  end if;
  return v_arrival_id;
end;
$$;

create or replace function public.set_destination_arrival(
  p_destination_id uuid,
  p_target_user_id uuid,
  p_arrived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destination public.itinerary_items;
  v_caller_role text;
  v_target_subgroup uuid;
  v_active_destination uuid;
  v_journey_status text;
  v_boundary integer;
begin
  select * into v_destination from public.itinerary_items where id = p_destination_id;
  if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;

  select m.role into v_caller_role from public.memberships m
  where m.group_id = v_destination.group_id and m.user_id = (select auth.uid());
  if not found or (p_target_user_id <> (select auth.uid()) and v_caller_role <> 'leader') then
    raise exception 'cannot mark this member' using errcode = '42501';
  end if;

  select m.subgroup_id into v_target_subgroup from public.memberships m
  where m.group_id = v_destination.group_id and m.user_id = p_target_user_id;
  if not found or v_target_subgroup is distinct from v_destination.subgroup_id then
    raise exception 'destination outside member scope' using errcode = '42501';
  end if;

  select g.active_destination_id, g.journey_status
  into v_active_destination, v_journey_status
  from public.groups g where g.id = v_destination.group_id;
  if v_journey_status = 'paused' and not exists (
    select 1 from public.destination_arrivals a
    where a.destination_id = p_destination_id
  ) then
    raise exception 'paused destination requires an existing arrival'
      using errcode = '22023';
  end if;
  select max(boundary_position) into v_boundary from (
    select i.position as boundary_position
    from public.itinerary_items i
    where i.id = v_active_destination
      and i.subgroup_id is not distinct from v_destination.subgroup_id
    union all
    select i.position
    from public.destination_arrivals a
    join public.itinerary_items i on i.id = a.destination_id
    where a.group_id = v_destination.group_id
      and i.subgroup_id is not distinct from v_destination.subgroup_id
  ) boundaries;
  if v_boundary is null then
    select min(i.position) into v_boundary from public.itinerary_items i
    where i.group_id = v_destination.group_id
      and i.subgroup_id is not distinct from v_destination.subgroup_id;
  end if;
  if v_destination.position > v_boundary then
    raise exception 'future destination cannot be completed' using errcode = '22023';
  end if;

  if p_arrived then

    perform public.record_destination_arrival(
      v_destination.group_id, p_destination_id, p_target_user_id,
      'manual', (select auth.uid())
    );
    if v_active_destination = p_destination_id then
      update public.memberships set status = 'arrived'
      where group_id = v_destination.group_id and user_id = p_target_user_id;
    end if;
  else
    delete from public.destination_arrivals
    where destination_id = p_destination_id and user_id = p_target_user_id;
    if (select active_destination_id from public.groups where id = v_destination.group_id) = p_destination_id then
      update public.memberships set status = 'active'
      where group_id = v_destination.group_id and user_id = p_target_user_id;
    end if;
  end if;
end;
$$;
revoke all on function public.record_destination_arrival(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.set_destination_arrival(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_destination_arrival(uuid, uuid, boolean) to authenticated;

-- Replace the existing location trigger body with durable per-destination completion.
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
  if new.latitude is null or new.longitude is null then return new; end if;
  select g.active_destination_id, i.latitude, i.longitude
  into v_destination_id, v_destination_lat, v_destination_lon
  from public.groups g
  join public.itinerary_items i on i.id = g.active_destination_id
  where g.id = new.group_id
    and g.journey_status = 'going'
    and exists (
      select 1 from public.memberships m
      where m.group_id = new.group_id
        and m.user_id = new.user_id
        and m.subgroup_id is not distinct from i.subgroup_id
    );
  if v_destination_id is null then return new; end if;

  v_distance_m := extensions.distance_meters(
    new.latitude, new.longitude, v_destination_lat, v_destination_lon
  );
  update public.live_activity_sessions s
  set current_distance_m = v_distance_m,
      eta_seconds = round(v_distance_m / case s.travel_mode
        when 'drive' then 13.9 when 'transit' then 8.3 else 1.4 end)::integer,
      last_progress_bucket = floor(
        greatest(0, least(1, 1 - v_distance_m / s.initial_distance_m)) * 20
      )::integer,
      updated_at = now()
  where s.group_id = new.group_id and s.user_id = new.user_id
    and s.destination_id = v_destination_id;

  if v_distance_m <= 30 then
    perform public.record_destination_arrival(
      new.group_id, v_destination_id, new.user_id, 'automatic', new.user_id
    );
    update public.memberships m set status = 'arrived'
    where m.group_id = new.group_id and m.user_id = new.user_id
      and m.status <> 'arrived';
  end if;
  return new;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.gather_point_requests;
exception when duplicate_object then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.destination_arrivals;
exception when duplicate_object then null;
end;
$$;

revoke execute on function public.on_gather_point_request_insert() from public, anon, authenticated;
