-- History visibility: own rows OR current leader of the row's group.
-- Complete gathering stop: leader closes stop for whole team + notifies non-arrived.

drop policy if exists "visited_waypoints: select own or group member"
  on public.visited_waypoints;
drop policy if exists "visited_waypoints: select own or leader"
  on public.visited_waypoints;

create policy "visited_waypoints: select own or leader"
  on public.visited_waypoints for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      group_id is not null
      and exists (
        select 1 from public.memberships m
        where m.group_id = visited_waypoints.group_id
          and m.user_id = (select auth.uid())
          and m.role = 'leader'
      )
    )
  );

create or replace function public.complete_gathering_stop(
  p_group_id uuid,
  p_destination_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.itinerary_items;
  v_cancelled integer := 0;
  v_member record;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
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

  -- Cancel active navigation for this stop (or any active session on this dest).
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
    and group_id = p_group_id;

  -- Notify members who have not marked arrived.
  for v_member in
    select m.user_id
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id is distinct from (select auth.uid())
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
        'sender_id', (select auth.uid()),
        'target_user_id', v_member.user_id,
        'destination_id', p_destination_id,
        'status', 'gathering_completed',
        'title', v_item.title,
        'message', '隊長已完成此卡片，將前往下一個集合點'
      ));
    exception when others then
      null; -- push must never block close
    end;
  end loop;
end;
$$;

revoke all on function public.complete_gathering_stop(uuid, uuid) from public, anon;
grant execute on function public.complete_gathering_stop(uuid, uuid) to authenticated;
