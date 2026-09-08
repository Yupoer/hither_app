-- Route progress belongs to the device's same-metric model, never a server
-- straight-line distance divided by a route-length baseline.
alter table public.notification_preferences add column if not exists arrival boolean not null default true;
alter table public.live_activity_sessions add column if not exists accent_hex text
  check (accent_hex is null or accent_hex ~ '^#[0-9A-Fa-f]{6}$');
alter table public.device_live_activity_tokens add column if not exists accent_hex text
  check (accent_hex is null or accent_hex ~ '^#[0-9A-Fa-f]{6}$');

-- Accurate foreground/background ACKs persist arrival. A single uploaded GPS
-- fix must neither invent arrival nor overwrite client route progress.
create or replace function public.on_member_location_arrival()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  return new;
end;
$$;
revoke all on function public.on_member_location_arrival() from public, anon, authenticated;

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
  v_uid uuid := (select auth.uid());
  v_closed_at timestamptz;
  v_member record;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_item from public.itinerary_items i
  where i.id = p_destination_id and i.group_id = p_group_id for update;
  if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;
  if not public.can_manage_itinerary_scope(p_group_id, v_item.subgroup_id, v_uid)
    and not (
      exists (select 1 from public.memberships caller where caller.group_id = p_group_id
        and caller.user_id = v_uid and caller.subgroup_id is not distinct from v_item.subgroup_id)
      and exists (select 1 from public.memberships m where m.group_id = p_group_id
        and m.subgroup_id is not distinct from v_item.subgroup_id)
      and not exists (
        select 1 from public.memberships m where m.group_id = p_group_id
          and m.subgroup_id is not distinct from v_item.subgroup_id
          and not exists (select 1 from public.destination_arrivals a
            where a.destination_id = p_destination_id and a.user_id = m.user_id)
      )
    ) then
    raise exception 'scope leader membership required' using errcode = '42501';
  end if;
  if v_item.closed_at is not null then return; end if;
  update public.itinerary_items set closed_at = coalesce(closed_at, now())
  where id = p_destination_id and group_id = p_group_id returning closed_at into v_closed_at;
  update public.navigation_sessions s
  set status = 'completed', ended_at = now(), version = s.version + 1, updated_at = now()
  where s.group_id = p_group_id and s.destination_id = p_destination_id and s.status = 'active';
  get diagnostics v_cancelled = row_count;
  if v_cancelled > 0 or exists (
    select 1 from public.groups g where g.id = p_group_id and g.active_destination_id = p_destination_id
  ) then
    update public.groups g
    set journey_status = 'paused', active_destination_id = null, journey_started_at = null
    where g.id = p_group_id;
  end if;
  insert into public.visited_waypoints (
    user_id, group_id, destination_id, arrival_id, name, latitude, longitude, arrived_at
  )
  select m.user_id, p_group_id, p_destination_id, a.id,
    coalesce(v_item.title, '集合點'), coalesce(v_item.latitude, 0), coalesce(v_item.longitude, 0),
    coalesce(a.arrived_at, v_closed_at, now())
  from public.memberships m
  left join public.destination_arrivals a
    on a.destination_id = p_destination_id and a.user_id = m.user_id
  where m.group_id = p_group_id
    and m.subgroup_id is not distinct from v_item.subgroup_id
  on conflict (group_id, destination_id, user_id)
    where destination_id is not null and group_id is not null
  do update set name = excluded.name, latitude = excluded.latitude, longitude = excluded.longitude,
    arrival_id = coalesce(public.visited_waypoints.arrival_id, excluded.arrival_id);
  for v_member in select m.user_id from public.memberships m
    where m.group_id = p_group_id and m.user_id is distinct from v_uid
      and m.subgroup_id is not distinct from v_item.subgroup_id
      and not exists (select 1 from public.destination_arrivals a
        where a.destination_id = p_destination_id and a.user_id = m.user_id)
  loop
    begin
      perform extensions.notify_push(jsonb_build_object(
        'category', 'journey', 'group_id', p_group_id, 'sender_id', v_uid,
        'target_user_id', v_member.user_id, 'destination_id', p_destination_id,
        'status', 'gathering_completed', 'title', v_item.title,
        'message', '隊長已完成此卡片，將前往下一個集合點'
      ));
    exception when others then null;
    end;
  end loop;
  begin
    perform extensions.notify_push(jsonb_build_object(
      'category', 'journey', 'group_id', p_group_id, 'sender_id', v_uid,
      'target_user_id', v_uid, 'destination_id', p_destination_id,
      'status', 'gathering_completed', 'title', v_item.title, 'message', '集合點已完成'
    ));
  exception when others then null;
  end;
end;
$$;

revoke all on function public.complete_gathering_stop(uuid, uuid) from public, anon;
grant execute on function public.complete_gathering_stop(uuid, uuid) to authenticated;


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
  where id = p_destination_id and group_id = p_group_id for update;
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
    )
    on conflict (group_id, destination_id, user_id)
      where destination_id is not null and group_id is not null
    do update set arrival_id = excluded.arrival_id, arrived_at = excluded.arrived_at;
  end if;
  -- Serialize arrivals on the stop row, then inspect committed scoped attendance.
  -- Run after the personal history insert; complete_gathering_stop upserts history.
  if v_destination.closed_at is null
    and exists (select 1 from public.memberships m where m.group_id = p_group_id
      and m.subgroup_id is not distinct from v_destination.subgroup_id)
    and not exists (select 1 from public.memberships m where m.group_id = p_group_id
      and m.subgroup_id is not distinct from v_destination.subgroup_id
      and not exists (select 1 from public.destination_arrivals a
        where a.destination_id = p_destination_id and a.user_id = m.user_id))
  then
    perform public.complete_gathering_stop(p_group_id, p_destination_id);
  end if;
  return v_arrival_id;
end;
$$;


revoke all on function public.record_destination_arrival(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;

-- Completing a stop is not a user pause. The stop is closed before groups changes.
create or replace function public.on_journey_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.journey_status is distinct from old.journey_status
    and not (new.journey_status = 'paused' and exists (
      select 1 from public.itinerary_items i where i.id = old.active_destination_id and i.closed_at is not null
    )) then
    perform extensions.notify_push(jsonb_build_object(
      'category', 'journey', 'group_id', new.id, 'sender_id', (select auth.uid()),
      'status', new.journey_status, 'destination_id', coalesce(new.active_destination_id, old.active_destination_id)
    ));
  end if;
  return new;
end;
$$;
revoke all on function public.on_journey_change() from public, anon, authenticated;

-- One identity per committed arrival, shared by local Realtime and APNs/FCM.
create or replace function public.on_destination_arrival_insert_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform extensions.notify_push(jsonb_build_object(
    'category', 'arrival', 'group_id', new.group_id, 'sender_id', new.user_id,
    'member_id', new.user_id, 'destination_id', new.destination_id,
    'entity_id', new.id, 'type', coalesce(new.source, 'manual')
  ));
  return new;
end;
$$;
revoke all on function public.on_destination_arrival_insert_notify() from public, anon, authenticated;
