-- Allow the first manual arrival while paused and let the client choose the
-- timestamp source without changing the existing RPC contract.

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
  -- Paused journeys may still record their first arrival. Keep the guard for
  -- undo so an unrelated destination cannot be toggled while paused.
  if v_journey_status = 'paused' and not p_arrived and not exists (
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

-- Timestamp-aware wrapper. The existing guarded RPC performs all authorization
-- and ordering checks; this wrapper only applies the selected timestamp after
-- a successful manual mark. NULL deliberately means server-side now().
create or replace function public.set_destination_arrival_at(
  p_destination_id uuid,
  p_target_user_id uuid,
  p_arrived boolean,
  p_arrived_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.set_destination_arrival(
    p_destination_id, p_target_user_id, p_arrived
  );

  if p_arrived and p_arrived_at is not null then
    update public.destination_arrivals
    set arrived_at = p_arrived_at
    where destination_id = p_destination_id
      and user_id = p_target_user_id;
    update public.visited_waypoints
    set arrived_at = p_arrived_at
    where arrival_id = (
      select a.id
      from public.destination_arrivals a
      where a.destination_id = p_destination_id
        and a.user_id = p_target_user_id
    );
  end if;
end;
$$;

revoke all on function public.set_destination_arrival_at(uuid, uuid, boolean, timestamptz)
  from public, anon;
grant execute on function public.set_destination_arrival_at(uuid, uuid, boolean, timestamptz)
  to authenticated;
