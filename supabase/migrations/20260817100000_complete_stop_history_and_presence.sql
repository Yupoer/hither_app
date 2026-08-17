-- #193 / #195 / #197
-- 1) complete_gathering_stop writes visited_waypoints so history is not empty
--    when destination_arrivals lag.
-- 2) Drop dest-less arrival fan-out from memberships presence (generic 隊友已抵達).

create unique index if not exists idx_visited_waypoints_group_dest_user
  on public.visited_waypoints (group_id, destination_id, user_id)
  where destination_id is not null and group_id is not null;

create or replace function public.complete_gathering_stop(
  p_group_id uuid,
  p_destination_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.itinerary_items;
  v_cancelled integer := 0;
  v_member record;
  v_uid uuid := (select auth.uid());
  v_closed_at timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  select * into v_item
  from public.itinerary_items i
  where i.id = p_destination_id
    and i.group_id = p_group_id
  for update;
  if not found then
    raise exception 'destination not found' using errcode = 'P0002';
  end if;

  update public.navigation_sessions s
  set status = 'cancelled',
      ended_at = now(),
      version = s.version + 1,
      updated_at = now()
  where s.group_id = p_group_id
    and s.destination_id = p_destination_id
    and s.status = 'active';
  get diagnostics v_cancelled = row_count;

  if v_cancelled > 0 or exists (
    select 1 from public.groups g
    where g.id = p_group_id
      and g.active_destination_id = p_destination_id
  ) then
    update public.groups g
    set journey_status = 'paused',
        active_destination_id = null,
        journey_started_at = null
    where g.id = p_group_id;
  end if;

  update public.itinerary_items
  set closed_at = coalesce(closed_at, now())
  where id = p_destination_id
    and group_id = p_group_id
  returning closed_at into v_closed_at;

  -- History rows for every scoped member so the overlay is not empty when
  -- destination_arrivals / visited_waypoints lag. Arrived members reuse the
  -- arrival timestamp; missing members are recorded at close time.
  insert into public.visited_waypoints (
    user_id, group_id, destination_id, arrival_id, name, latitude, longitude, arrived_at
  )
  select
    m.user_id,
    p_group_id,
    p_destination_id,
    a.id,
    coalesce(v_item.title, '集合點'),
    coalesce(v_item.latitude, 0),
    coalesce(v_item.longitude, 0),
    coalesce(a.arrived_at, v_closed_at, now())
  from public.memberships m
  left join public.destination_arrivals a
    on a.destination_id = p_destination_id
   and a.user_id = m.user_id
  where m.group_id = p_group_id
    and (
      v_item.subgroup_id is null
      or m.subgroup_id is not distinct from v_item.subgroup_id
    )
  on conflict (group_id, destination_id, user_id)
    where destination_id is not null and group_id is not null
  do update set
    name = excluded.name,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    arrival_id = coalesce(public.visited_waypoints.arrival_id, excluded.arrival_id);

  for v_member in
    select m.user_id
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id is distinct from v_uid
      and not exists (
        select 1 from public.destination_arrivals a
        where a.destination_id = p_destination_id
          and a.user_id = m.user_id
      )
  loop
    begin
      perform extensions.notify_push(jsonb_build_object(
        'category', 'journey',
        'group_id', p_group_id,
        'sender_id', v_uid,
        'target_user_id', v_member.user_id,
        'destination_id', p_destination_id,
        'status', 'gathering_completed',
        'title', v_item.title,
        'message', '隊長已完成此卡片，將前往下一個集合點'
      ));
    exception when others then
      null;
    end;
  end loop;

  begin
    perform extensions.notify_push(jsonb_build_object(
      'category', 'journey',
      'group_id', p_group_id,
      'sender_id', v_uid,
      'target_user_id', v_uid,
      'destination_id', p_destination_id,
      'status', 'gathering_completed',
      'title', v_item.title,
      'message', '集合點已完成'
    ));
  exception when others then
    null;
  end;
end;
$$;

revoke all on function public.complete_gathering_stop(uuid, uuid) from public, anon;
grant execute on function public.complete_gathering_stop(uuid, uuid) to authenticated;

create or replace function public.on_membership_presence_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Arrival notify is destination_arrivals insert only. Memberships have no
  -- destination_id — dest-less 「隊友已抵達」must not fan out.
  if (new.solo and not old.solo)
     or (new.status in ('idle', 'offline') and old.status = 'active') then
    perform extensions.notify_push(jsonb_build_object(
      'category', 'straggler',
      'group_id', new.group_id,
      'sender_id', new.user_id,
      'member_id', new.user_id
    ));
  end if;
  return new;
end;
$$;
