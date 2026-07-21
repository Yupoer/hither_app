-- Sequential arrival gate must match the gathering-card carousel:
-- past trip days are removed from the active list (and cannot be completed),
-- so they must not block marking today's first visible stop.
--
-- Client filterActiveDestinations keeps open stops with day >= current trip day
-- (or all open when departure/trip_days gate is off). Mirror that here.

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
  v_session_id uuid;
  v_departure date;
  v_trip_days integer;
  v_current_day integer;
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

  select
    g.active_destination_id,
    g.journey_status,
    g.departure_date,
    g.trip_days
  into
    v_active_destination,
    v_journey_status,
    v_departure,
    v_trip_days
  from public.groups g
  where g.id = v_destination.group_id;

  if v_journey_status = 'paused' and not p_arrived and not exists (
    select 1 from public.destination_arrivals a
    where a.destination_id = p_destination_id
  ) then
    raise exception 'paused destination requires an existing arrival' using errcode = '22023';
  end if;

  -- Current trip day from server calendar date (same shape as client gate).
  if v_departure is not null and v_trip_days is not null and v_trip_days > 0 then
    v_current_day := (current_date - v_departure) + 1;
  else
    v_current_day := null;
  end if;

  -- Sequential gate only when marking arrived (undo never blocked by order).
  -- Only earlier stops that would still appear on gathering cards count.
  if p_arrived and exists (
    select 1
    from public.itinerary_items i
    where i.group_id = v_destination.group_id
      and i.subgroup_id is not distinct from v_destination.subgroup_id
      and i.position < v_destination.position
      and i.closed_at is null
      and not exists (
        select 1
        from public.destination_arrivals a
        where a.destination_id = i.id
          and a.user_id = p_target_user_id
      )
      and (
        -- Gate off / before trip start: all open stops are on the carousel.
        v_current_day is null
        or v_current_day <= 0
        or (
          -- In-trip: only today and future days are visible (past days → history).
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
