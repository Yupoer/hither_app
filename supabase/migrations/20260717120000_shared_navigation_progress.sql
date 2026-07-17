-- Shared journey progress: a destination is closed once the team leaves it,
-- while each member keeps an independent arrived/missed result.

alter table public.itinerary_items
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by_session_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'itinerary_items_closed_by_session_id_fkey'
      and conrelid = 'public.itinerary_items'::regclass
  ) then
    alter table public.itinerary_items
      add constraint itinerary_items_closed_by_session_id_fkey
      foreign key (closed_by_session_id)
      references public.navigation_sessions(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists itinerary_items_open_scope
  on public.itinerary_items(group_id, subgroup_id, position)
  where closed_at is null;

alter table public.navigation_member_states
  drop constraint if exists navigation_member_states_local_status_check;
alter table public.navigation_member_states
  add constraint navigation_member_states_local_status_check check (local_status in (
    'pending','activity_started','tracking_active','permission_denied',
    'location_disabled','app_force_quit_suspected','offline','push_unavailable',
    'sharing_disabled','arriving','arrived','missed','cancelled'
  ));

drop policy if exists "navigation_member_states: leaders update" on public.navigation_member_states;
create policy "navigation_member_states: leaders update"
  on public.navigation_member_states for update to authenticated
  using (exists (
    select 1
    from public.navigation_sessions s
    join public.memberships m on m.group_id = s.group_id
    where s.id = navigation_member_states.navigation_session_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ))
  with check (exists (
    select 1
    from public.navigation_sessions s
    join public.memberships m on m.group_id = s.group_id
    where s.id = navigation_member_states.navigation_session_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ));

comment on column public.itinerary_items.closed_at is
  'When the team left this gathering point; null means it remains in the active itinerary.';
comment on column public.itinerary_items.closed_by_session_id is
  'Navigation session that closed this gathering point.';

-- Existing completed sessions were already a team-level stop transition. Keep
-- cancelled sessions open, and preserve any prior arrival acknowledgements.
update public.itinerary_items i
set closed_at = coalesce(i.closed_at, s.ended_at, s.updated_at, now()),
    closed_by_session_id = coalesce(i.closed_by_session_id, s.id)
from public.navigation_sessions s
where s.destination_id = i.id
  and s.status = 'completed'
  and i.closed_at is null;

update public.navigation_member_states n
set local_status = 'missed',
    detail = coalesce(n.detail, '{}'::jsonb) || jsonb_build_object('reason', 'legacy_session_closed'),
    updated_at = now()
from public.navigation_sessions s
where s.id = n.navigation_session_id
  and s.status = 'completed'
  and n.local_status <> 'arrived'
  and not exists (
    select 1
    from public.destination_arrivals a
    where a.destination_id = s.destination_id
      and a.user_id = n.user_id
  );

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
    set status = 'completed', ended_at = now(), version = version + 1, updated_at = now()
    where id = v_active.id;

    update public.itinerary_items
    set closed_at = coalesce(closed_at, now()),
        closed_by_session_id = coalesce(closed_by_session_id, v_active.id)
    where id = v_active.destination_id;

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

  update public.itinerary_items
  set closed_at = coalesce(closed_at, v_session.ended_at, now()),
      closed_by_session_id = coalesce(closed_by_session_id, v_session.id)
  where id = v_session.destination_id;

  update public.navigation_member_states n
  set local_status = 'missed',
      detail = coalesce(n.detail, '{}'::jsonb) || jsonb_build_object('reason', 'session_completed'),
      updated_at = now()
  where n.navigation_session_id = v_session.id
    and n.local_status <> 'arrived'
    and not exists (
      select 1 from public.destination_arrivals a
      where a.destination_id = v_session.destination_id
        and a.user_id = n.user_id
    );

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
  v_destination_id uuid;
begin
  if p_status not in (
    'pending','activity_started','tracking_active','permission_denied',
    'location_disabled','app_force_quit_suspected','offline','push_unavailable',
    'sharing_disabled','arriving','arrived','missed','cancelled'
  ) then
    raise exception 'invalid navigation member status' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_detail, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_detail, '{}'::jsonb)::text) > 8192 then
    raise exception 'invalid navigation member detail' using errcode = '22023';
  end if;

  select s.group_id, s.destination_id into v_group_id, v_destination_id
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
    perform public.record_destination_arrival(
      v_group_id, v_destination_id, (select auth.uid()),
      'automatic', (select auth.uid())
    );
    update public.memberships
    set status = 'arrived'
    where group_id = v_group_id and user_id = (select auth.uid());
  end if;
  return v_state;
end;
$$;

-- Manual correction of a missed result must not reopen the closed itinerary
-- item. Undoing a closed stop keeps the member in the explicit missed state.
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
  v_session_id uuid;
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
  if v_journey_status = 'paused' and not p_arrived and not exists (
    select 1 from public.destination_arrivals a
    where a.destination_id = p_destination_id
  ) then
    raise exception 'paused destination requires an existing arrival' using errcode = '22023';
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
