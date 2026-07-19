-- Terminal navigation RPCs: same-terminal replay is idempotent; active version
-- mismatches still raise SQLSTATE 40001. Opposite-terminal actions raise P0001.

create or replace function public.cancel_navigation_session(
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
  select * into v_session
  from public.navigation_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'navigation session not found' using errcode = 'P0002';
  end if;

  if v_session.status = 'cancelled' then
    return v_session;
  end if;

  if v_session.status <> 'active' then
    raise exception 'navigation session is already %', v_session.status
      using errcode = 'P0001';
  end if;

  if v_session.version <> p_expected_version then
    raise exception 'active navigation session version mismatch'
      using errcode = '40001';
  end if;

  update public.navigation_sessions s
  set status = 'cancelled',
      ended_at = now(),
      version = s.version + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  update public.groups
  set journey_status = 'paused',
      active_destination_id = null,
      journey_started_at = null
  where id = v_session.group_id;

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
  select * into v_session
  from public.navigation_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'navigation session not found' using errcode = 'P0002';
  end if;

  if v_session.status = 'completed' then
    return v_session;
  end if;

  if v_session.status <> 'active' then
    raise exception 'navigation session is already %', v_session.status
      using errcode = 'P0001';
  end if;

  if v_session.version <> p_expected_version then
    raise exception 'active navigation session version mismatch'
      using errcode = '40001';
  end if;

  update public.navigation_sessions s
  set status = 'completed',
      ended_at = now(),
      version = s.version + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  update public.itinerary_items
  set closed_at = coalesce(closed_at, v_session.ended_at, now()),
      closed_by_session_id = coalesce(closed_by_session_id, v_session.id)
  where id = v_session.destination_id;

  update public.navigation_member_states n
  set local_status = 'missed',
      detail = coalesce(n.detail, '{}'::jsonb)
        || jsonb_build_object('reason', 'session_completed'),
      updated_at = now()
  where n.navigation_session_id = v_session.id
    and n.local_status <> 'arrived'
    and not exists (
      select 1 from public.destination_arrivals a
      where a.destination_id = v_session.destination_id
        and a.user_id = n.user_id
    );

  update public.groups
  set journey_status = 'paused',
      active_destination_id = null,
      journey_started_at = null
  where id = v_session.group_id;

  return v_session;
end;
$$;

revoke all on function public.cancel_navigation_session(uuid, integer)
  from public, anon;
grant execute on function public.cancel_navigation_session(uuid, integer)
  to authenticated;

revoke all on function public.complete_navigation_session(uuid, integer)
  from public, anon;
grant execute on function public.complete_navigation_session(uuid, integer)
  to authenticated;
