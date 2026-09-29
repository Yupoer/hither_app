-- Re-assert the security-hardening navigation function after deploying the
-- older active-navigation prerequisite out of order. The prerequisite is
-- retained for its trigger/arrival behavior, but it predates the hardened
-- leader and anonymous-expiry checks.
begin;

create or replace function public.start_navigation_session(
  p_group_id uuid,
  p_destination_id uuid,
  p_request_id uuid
)
returns public.navigation_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.navigation_sessions;
  v_active public.navigation_sessions;
  v_destination public.itinerary_items;
  v_session public.navigation_sessions;
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not extensions.is_member(p_group_id) then
    raise exception 'not a group member' using errcode = '42501';
  end if;
  if not public.anonymous_access_is_active(v_caller) then
    raise exception 'anonymous access expired' using errcode = '42501';
  end if;

  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_caller
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
    v_caller, p_request_id
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

revoke all on function public.start_navigation_session(uuid, uuid, uuid) from public, anon;
grant execute on function public.start_navigation_session(uuid, uuid, uuid) to authenticated;

-- These legacy SECURITY DEFINER RPCs must remain authenticated-only. The
-- durable v2 RPC below has its own explicit grant, but does not change legacy
-- function ACLs when it is created with CREATE OR REPLACE.
revoke all on function public.apply_core_operation(
  uuid, uuid, text, text, integer, text, jsonb, timestamptz
) from public, anon;
grant execute on function public.apply_core_operation(
  uuid, uuid, text, text, integer, text, jsonb, timestamptz
) to authenticated;

revoke all on function public.apply_leader_gathering_switch(
  uuid, uuid, text, integer, text, timestamptz
) from public, anon;
grant execute on function public.apply_leader_gathering_switch(
  uuid, uuid, text, integer, text, timestamptz
) to authenticated;

commit;
