-- Database security slice: keep membership mutations behind the existing RPCs
-- and make profile entitlement/expiry fields server-owned.

-- memberships ---------------------------------------------------------------
-- Direct membership creation and role/status changes bypass the atomic RPC
-- invariants. Self DELETE remains the intentional leave path; leader removal
-- is owned by kick_group_member so invite rotation stays atomic.
revoke all on table public.memberships from public, anon, authenticated;
grant select, delete on table public.memberships to authenticated;

drop policy if exists "memberships: insert self" on public.memberships;
drop policy if exists "memberships: update if leader" on public.memberships;
drop policy if exists "memberships: delete if leader or self" on public.memberships;
create policy "memberships: delete self"
  on public.memberships for delete to authenticated
  using (user_id = (select auth.uid()));

-- profiles -------------------------------------------------------------------
-- Keep the existing SELECT surface for current mobile select(*) callers. The
-- role test records that same-group peers can still see all profile columns;
-- narrowing that read surface needs a client/view contract change.
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant insert (id, nickname, avatar, avatar_color, onboarding, preferences)
  on table public.profiles to authenticated;
grant update (id, nickname, avatar, avatar_color, onboarding, preferences)
  on table public.profiles to authenticated;

-- The client only needs to clear its own expiry. Keep that RPC available but
-- prevent an authenticated caller from naming another user's profile. The
-- trusted server role may still process arbitrary identities.
create or replace function public.ensure_anonymous_expiry(p_uid uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    ''
  );
begin
  if p_uid is null then
    return null;
  end if;
  if p_uid is distinct from (select auth.uid())
     and v_request_role <> 'service_role'
     and not (
       session_user = 'postgres'
       and current_setting('role') in ('none', 'postgres')
       and v_request_role in ('', 'postgres')
     ) then
    raise exception 'profile server write forbidden' using errcode = '42501';
  end if;
  if not public.is_auth_user_anonymous(p_uid) then
    return null;
  end if;

  perform public.allow_anonymous_expiry_write();
  update public.profiles
  set anonymous_expires_at = coalesce(anonymous_expires_at, now() + interval '14 days')
  where id = p_uid
  returning anonymous_expires_at into v_expires;
  return v_expires;
end;
$$;

revoke all on function public.ensure_anonymous_expiry(uuid) from public, anon, authenticated;
grant execute on function public.ensure_anonymous_expiry(uuid) to service_role;

create or replace function public.clear_anonymous_expiry_if_registered(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    ''
  );
begin
  if p_uid is null then
    return;
  end if;
  if v_request_role <> 'service_role'
     and (v_caller is null or p_uid is distinct from v_caller) then
    raise exception 'profile server write forbidden' using errcode = '42501';
  end if;
  if public.is_auth_user_anonymous(p_uid) then
    return;
  end if;

  perform public.allow_anonymous_expiry_write();
  update public.profiles
  set anonymous_expires_at = null
  where id = p_uid and anonymous_expires_at is not null;
end;
$$;

revoke all on function public.clear_anonymous_expiry_if_registered(uuid) from public, anon;
grant execute on function public.clear_anonymous_expiry_if_registered(uuid) to authenticated, service_role;

-- These client RPCs also update membership status. Preserve their actor and
-- group checks while moving the mutation behind the owner, because direct
-- authenticated UPDATE is intentionally no longer available.
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

  select s.group_id, s.destination_id into v_group_id, v_destination_id
  from public.navigation_sessions s
  where s.id = p_session_id and extensions.is_member(s.group_id);
  if not found then
    raise exception 'navigation session not found' using errcode = 'P0002';
  end if;
  if not public.anonymous_access_is_active(v_caller) then
    raise exception 'anonymous access expired' using errcode = '42501';
  end if;

  insert into public.navigation_member_states (
    navigation_session_id, user_id, local_status, detail,
    acknowledged_at, arrived_at, updated_at
  ) values (
    p_session_id, v_caller, p_status, coalesce(p_detail, '{}'::jsonb),
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
      v_group_id, v_destination_id, v_caller, 'automatic', v_caller
    );
    update public.memberships
    set status = 'arrived'
    where group_id = v_group_id and user_id = v_caller;
  end if;
  return v_state;
end;
$$;
revoke all on function public.ack_navigation_session(uuid, text, jsonb) from public, anon;
grant execute on function public.ack_navigation_session(uuid, text, jsonb) to authenticated;

create or replace function public.start_navigation_session_switch(
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
  if not found then raise exception 'group not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = v_caller and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  select s.* into v_existing
  from public.navigation_sessions s
  where s.group_id = p_group_id and s.request_id = p_request_id;
  if found then return v_existing; end if;

  update public.navigation_sessions
  set status = 'cancelled', ended_at = now(), version = version + 1, updated_at = now()
  where group_id = p_group_id and status = 'active';

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

  insert into public.navigation_sessions (
    group_id, destination_id, destination_name,
    destination_latitude, destination_longitude, started_by, request_id
  ) values (
    p_group_id, p_destination_id, v_destination.title,
    v_destination.latitude, v_destination.longitude,
    v_caller, p_request_id
  ) returning * into v_session;

  update public.memberships set status = 'active'
  where group_id = p_group_id and status = 'arrived';
  update public.groups
  set journey_status = 'going', active_destination_id = p_destination_id,
      journey_started_at = v_session.started_at
  where id = p_group_id;
  return v_session;
end;
$$;
revoke all on function public.start_navigation_session_switch(uuid, uuid, uuid) from public, anon;
grant execute on function public.start_navigation_session_switch(uuid, uuid, uuid) to authenticated;

-- This RPC updates memberships as part of a leader-only atomic transition.
-- It remains callable by clients after direct table UPDATE is removed, but
-- keeps explicit actor, leader, and anonymous-expiry checks under the locked
-- SECURITY DEFINER search path.
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

-- Trigger-only SECURITY DEFINER functions do not need API EXECUTE grants.
revoke all on function public.delete_empty_group_or_subgroup() from public, anon, authenticated;
revoke all on function public.enforce_itinerary_point_limit() from public, anon, authenticated;
revoke all on function public.on_command_insert() from public, anon, authenticated;
revoke all on function public.on_itinerary_insert() from public, anon, authenticated;
revoke all on function public.prevent_client_anonymous_expires_mutation() from public, anon, authenticated;
revoke all on function public.prevent_client_pro_self_grant() from public, anon, authenticated;
revoke all on function public.trg_memberships_enforce_anonymous_rules() from public, anon, authenticated;
revoke all on function public.trg_memberships_set_anonymous_expiry() from public, anon, authenticated;
