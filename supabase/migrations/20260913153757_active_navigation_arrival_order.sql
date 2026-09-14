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
  v_target_subgroup uuid;
  v_active_destination uuid;
  v_journey_status text;
  v_session_id uuid;
  v_departure date;
  v_trip_days integer;
  v_current_day integer;
begin
  select * into v_destination from public.itinerary_items where id = p_destination_id;
  if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;

  if p_target_user_id is distinct from (select auth.uid())
     and not public.can_manage_itinerary_scope(
       v_destination.group_id, v_destination.subgroup_id
     ) then
    raise exception 'cannot mark this member' using errcode = '42501';
  end if;

  select m.subgroup_id into v_target_subgroup from public.memberships m
  where m.group_id = v_destination.group_id and m.user_id = p_target_user_id;
  if not found or v_target_subgroup is distinct from v_destination.subgroup_id then
    raise exception 'destination outside member scope' using errcode = '42501';
  end if;

  select g.active_destination_id, g.journey_status, g.departure_date, g.trip_days
  into v_active_destination, v_journey_status, v_departure, v_trip_days
  from public.groups g where g.id = v_destination.group_id;
  if v_journey_status = 'paused' and not p_arrived and not exists (
    select 1 from public.destination_arrivals a
    where a.destination_id = p_destination_id
  ) then
    raise exception 'paused destination requires an existing arrival' using errcode = '22023';
  end if;

  if v_departure is not null and v_trip_days is not null and v_trip_days > 0 then
    v_current_day := (current_date - v_departure) + 1;
  else
    v_current_day := null;
  end if;

  -- A confirmed active navigation target is markable even before reordered rows reach clients.
  -- Scope/auth checks above still apply; ordinary future stops retain sequential rules.
  if p_arrived and not exists (
    select 1 from public.navigation_sessions s
    where s.group_id = v_destination.group_id and s.destination_id = p_destination_id
      and s.status = 'active' and s.expires_at > now()
  ) and exists (
    select 1
    from public.itinerary_items i
    where i.group_id = v_destination.group_id
      and i.subgroup_id is not distinct from v_destination.subgroup_id
      and i.position < v_destination.position
      and i.closed_at is null
      and not exists (
        select 1 from public.destination_arrivals a
        where a.destination_id = i.id and a.user_id = p_target_user_id
      )
      and (
        v_current_day is null
        or v_current_day <= 0
        or (
          v_current_day <= v_trip_days
          and coalesce(i.day, 1) >= v_current_day
        )
      )
  ) then
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
    select s.id into v_session_id
    from public.navigation_sessions s
    where s.destination_id = p_destination_id
      and s.group_id = v_destination.group_id
      and s.status in ('active', 'completed')
    order by s.started_at desc
    limit 1;
    if v_session_id is not null then
      update public.navigation_member_states
      set local_status = 'arrived', arrived_at = coalesce(arrived_at, now()),
          acknowledged_at = coalesce(acknowledged_at, now()), updated_at = now()
      where navigation_session_id = v_session_id and user_id = p_target_user_id;
    end if;
  else
    delete from public.destination_arrivals
    where destination_id = p_destination_id and user_id = p_target_user_id;
    if v_active_destination = p_destination_id then
      update public.memberships set status = 'active'
      where group_id = v_destination.group_id and user_id = p_target_user_id;
    end if;
    select s.id into v_session_id
    from public.navigation_sessions s
    where s.destination_id = p_destination_id
      and s.group_id = v_destination.group_id
      and s.status in ('active', 'completed')
    order by s.started_at desc
    limit 1;
    if v_session_id is not null then
      update public.navigation_member_states
      set local_status = case when v_destination.closed_at is null then 'pending' else 'missed' end,
          updated_at = now()
      where navigation_session_id = v_session_id and user_id = p_target_user_id;
    end if;
  end if;
end;
$$;

revoke all on function public.set_destination_arrival(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_destination_arrival(uuid, uuid, boolean) to authenticated;

-- Use the existing locked/authorized reorder RPC in the navigation transaction.
-- This also covers retries/older clients that do not send a separate reorder first.
create or replace function public.promote_navigation_destination()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_target public.itinerary_items;
  v_updates jsonb;
begin
  if new.status <> 'active' then return new; end if;
  perform 1 from public.groups where id = new.group_id for update;
  select * into v_target from public.itinerary_items
    where id = new.destination_id and group_id = new.group_id;
  if not found or v_target.closed_at is not null then
    raise exception 'navigation destination missing or closed' using errcode = '22023';
  end if;
  if exists (select 1 from public.itinerary_items i
    where i.group_id = new.group_id and i.subgroup_id is not distinct from v_target.subgroup_id
      and coalesce(i.day, 1) = coalesce(v_target.day, 1) and i.closed_at is null
      and i.position < v_target.position) then
    select jsonb_agg(jsonb_build_object('id', i.id, 'day', coalesce(i.day, 1), 'position', i.position)
      order by (i.id = v_target.id) desc, i.position, i.id)
    into v_updates from public.itinerary_items i
    where i.group_id = new.group_id and i.subgroup_id is not distinct from v_target.subgroup_id
      and coalesce(i.day, 1) = coalesce(v_target.day, 1) and i.closed_at is null;
    perform public.reorder_itinerary_items(new.group_id, v_updates);
  end if;
  return new;
end;
$$;
revoke all on function public.promote_navigation_destination() from public, anon, authenticated;
drop trigger if exists promote_navigation_destination on public.navigation_sessions;
create trigger promote_navigation_destination before insert on public.navigation_sessions
  for each row execute function public.promote_navigation_destination();

-- Switching destinations preserves unfinished history.
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
  v_active public.navigation_sessions;
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

  -- The request id is the first idempotency key. It intentionally returns a
  -- terminal session too, so a retry cannot create a second transition.
  select s.* into v_existing
  from public.navigation_sessions s
  where s.group_id = p_group_id and s.request_id = p_request_id;
  if found then
    return v_existing;
  end if;

  update public.navigation_sessions
  set status = 'expired', ended_at = now(), version = version + 1, updated_at = now()
  where group_id = p_group_id and status = 'active' and expires_at <= now();

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

  select s.* into v_active
  from public.navigation_sessions s
  where s.group_id = p_group_id and s.status = 'active'
  order by s.started_at desc
  limit 1
  for update;

  -- A different request for the same active stop is safe to retry and should
  -- never report the old "active session exists" error.
  if found and v_active.destination_id = p_destination_id then
    return v_active;
  end if;

  if found then
    update public.navigation_sessions
    set status = 'cancelled', ended_at = now(), version = version + 1, updated_at = now()
    where id = v_active.id;

    update public.navigation_member_states n
    set local_status = 'missed',
        detail = coalesce(n.detail, '{}'::jsonb) || jsonb_build_object('reason', 'session_switched'),
        updated_at = now()
    where n.navigation_session_id = v_active.id
      and n.local_status <> 'arrived'
      and not exists (
        select 1 from public.destination_arrivals a
        where a.destination_id = v_active.destination_id
          and a.user_id = n.user_id
      );
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
