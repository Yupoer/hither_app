begin;

revoke insert, update on table public.navigation_member_states from authenticated;
grant update (local_status, detail, updated_at) on table public.navigation_member_states to authenticated;

create function extensions.enforce_navigation_member_cleanup()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.detail is distinct from old.detail
      and new.detail is distinct from (old.detail || jsonb_build_object('reason', 'session_completed')))
     or (new.updated_at is distinct from old.updated_at and new.updated_at is distinct from now()) then
    raise exception 'invalid navigation member cleanup' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function extensions.enforce_navigation_member_cleanup() from public, anon, authenticated;

create trigger enforce_navigation_member_cleanup
before update of detail, updated_at on public.navigation_member_states
for each row when (current_user = 'authenticated')
execute function extensions.enforce_navigation_member_cleanup();

drop policy if exists "navigation_member_states: own insert"
  on public.navigation_member_states;

drop policy if exists "navigation_member_states: own update"
  on public.navigation_member_states;

drop policy if exists "navigation_member_states: leaders update"
  on public.navigation_member_states;
create policy "navigation_member_states: leaders update"
  on public.navigation_member_states for update to authenticated
  using (
    navigation_member_states.local_status not in ('arrived', 'missed')
    and navigation_member_states.arrived_at is null
    and exists (
      select 1
      from public.navigation_sessions s
      join public.memberships m
        on m.group_id = s.group_id
       and m.user_id = (select auth.uid())
       and m.role = 'leader'
       and m.subgroup_id is not distinct from s.scope_subgroup_id
      where s.id = navigation_member_states.navigation_session_id
        and s.status in ('cancelled', 'expired', 'completed')
        and not exists (
          select 1
          from public.destination_arrivals a
          where a.destination_id = s.destination_id
            and a.user_id = navigation_member_states.user_id
        )
    )
  )
  with check (
    exists (
      select 1
      from public.navigation_sessions s
      join public.memberships m
        on m.group_id = s.group_id
       and m.user_id = (select auth.uid())
       and m.role = 'leader'
       and m.subgroup_id is not distinct from s.scope_subgroup_id
      where s.id = navigation_member_states.navigation_session_id
        and s.status in ('cancelled', 'expired', 'completed')
        and navigation_member_states.local_status = 'missed'
    )
  );

create or replace function public.ack_navigation_session(
  p_session_id uuid,
  p_status text,
  p_detail jsonb default '{}'::jsonb
)
returns public.navigation_member_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.navigation_member_states;
  v_group_id uuid;
  v_destination_id uuid;
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
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

  select s.group_id, s.destination_id
  into v_group_id, v_destination_id
  from public.navigation_sessions s
  join public.navigation_member_states n
    on n.navigation_session_id = s.id
   and n.user_id = v_caller
  join public.memberships m
    on m.group_id = s.group_id
   and m.user_id = v_caller
   and m.subgroup_id is not distinct from s.scope_subgroup_id
  where s.id = p_session_id
    and s.status = 'active'
    and s.expires_at > now()
    and extensions.is_member(s.group_id)
  for update of s, n, m;
  if not found then
    raise exception 'navigation session not found' using errcode = 'P0002';
  end if;
  if not public.anonymous_access_is_active(v_caller) then
    raise exception 'anonymous access expired' using errcode = '42501';
  end if;

  update public.navigation_member_states
  set local_status = p_status,
      detail = coalesce(p_detail, '{}'::jsonb),
      acknowledged_at = now(),
      arrived_at = case
        when p_status = 'arrived' then coalesce(arrived_at, now())
        else arrived_at
      end,
      updated_at = now()
  where navigation_session_id = p_session_id
    and user_id = v_caller
  returning * into v_state;

  if p_status = 'arrived' then
    perform public.record_destination_arrival(
      v_group_id, v_destination_id, v_caller, 'automatic', v_caller
    );
    update public.memberships
    set status = 'arrived'
    where group_id = v_group_id and user_id = v_caller;
  end if;
  return v_state;
end;
$$;

revoke all on function public.ack_navigation_session(uuid, text, jsonb)
  from public, anon;
grant execute on function public.ack_navigation_session(uuid, text, jsonb)
  to authenticated;

commit;
