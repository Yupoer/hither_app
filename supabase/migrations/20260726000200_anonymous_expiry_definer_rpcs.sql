-- OTA-05 P1 follow-up: SECURITY DEFINER RPCs must authorize through
-- expiry-aware helpers (extensions.is_member / anonymous_access_is_active),
-- not raw public.memberships rows alone.
-- Covers coordination create/override/cancel/respond/resolve and
-- request_group_location_refresh.

-- ============================================================
-- coordination_user_eligible: membership + active anonymous access
-- ============================================================

create or replace function public.coordination_user_eligible(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = p_user_id
      and (
        p_subgroup_id is null
        or m.subgroup_id is not distinct from p_subgroup_id
        or m.role = 'leader'
      )
  )
  and public.anonymous_access_is_active(p_user_id);
$$;

revoke all on function public.coordination_user_eligible(uuid, uuid, uuid)
  from public, anon, authenticated;

-- ============================================================
-- create_coordination_request — leader + active membership
-- ============================================================

create or replace function public.create_coordination_request(
  p_group_id uuid,
  p_subgroup_id uuid,
  p_subject text,
  p_subject_kind text,
  p_options jsonb,
  p_deadline timestamptz,
  p_policy text,
  p_default_outcome text
)
returns public.coordination_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Expiry-aware: is_member requires anonymous_access_is_active.
  if not extensions.is_member(p_group_id)
     or not exists (
       select 1 from public.memberships m
       where m.group_id = p_group_id
         and m.user_id = (select auth.uid())
         and m.role = 'leader'
     ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  if p_subgroup_id is not null and not exists (
    select 1 from public.subgroups s
    where s.id = p_subgroup_id and s.group_id = p_group_id
  ) then
    raise exception 'subgroup does not belong to group' using errcode = '42501';
  end if;

  -- Any group leader may target the main list or any subgroup (top-down model).
  if nullif(btrim(p_subject), '') is null then
    raise exception 'subject required' using errcode = '22023';
  end if;

  if p_subject_kind not in ('gathering_point', 'meet_time', 'route', 'itinerary') then
    raise exception 'invalid subject_kind' using errcode = '22023';
  end if;

  if p_policy not in (
    'organizer_override', 'unanimity', 'majority', 'timeout_default'
  ) then
    raise exception 'invalid policy' using errcode = '22023';
  end if;

  if p_deadline is null or p_deadline <= now() then
    raise exception 'deadline must be in the future' using errcode = '22023';
  end if;

  perform public.coordination_validate_options(p_options, p_default_outcome);

  insert into public.coordination_requests(
    group_id, subgroup_id, created_by, subject, subject_kind,
    options, deadline, policy, default_outcome, status
  ) values (
    p_group_id,
    p_subgroup_id,
    (select auth.uid()),
    btrim(p_subject),
    p_subject_kind,
    p_options,
    p_deadline,
    p_policy,
    p_default_outcome,
    'open'
  )
  returning * into v_request;

  return v_request;
end;
$$;

revoke all on function public.create_coordination_request(
  uuid, uuid, text, text, jsonb, timestamptz, text, text
) from public, anon;
grant execute on function public.create_coordination_request(
  uuid, uuid, text, text, jsonb, timestamptz, text, text
) to authenticated;

-- ============================================================
-- respond_to_coordination_request — active membership first
-- ============================================================

create or replace function public.respond_to_coordination_request(
  p_request_id uuid,
  p_option_id text
)
returns public.coordination_responses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
  v_response public.coordination_responses;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_request
  from public.coordination_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'open' then
    raise exception 'request already closed' using errcode = '23514';
  end if;

  if v_request.deadline <= now() then
    -- Close first so callers observe a resolved outcome, then reject.
    perform public.resolve_coordination_request_deadline(p_request_id);
    raise exception 'request already closed' using errcode = '23514';
  end if;

  -- Expiry-aware membership before subgroup eligibility.
  if not extensions.is_member(v_request.group_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;

  -- Eligible participants only (subgroup scope + leaders; main = all members).
  -- coordination_user_eligible also requires anonymous_access_is_active.
  if not public.coordination_user_eligible(
    v_request.group_id,
    v_request.subgroup_id,
    (select auth.uid())
  ) then
    raise exception 'not eligible for this request' using errcode = '42501';
  end if;

  if nullif(btrim(p_option_id), '') is null
     or not (p_option_id = any(public.coordination_option_ids(v_request.options))) then
    raise exception 'invalid option' using errcode = '22023';
  end if;

  insert into public.coordination_responses(request_id, user_id, option_id)
  values (p_request_id, (select auth.uid()), p_option_id)
  on conflict (request_id, user_id) do update
    set option_id = excluded.option_id,
        updated_at = now()
  returning * into v_response;

  return v_response;
end;
$$;

revoke all on function public.respond_to_coordination_request(uuid, text)
  from public, anon;
grant execute on function public.respond_to_coordination_request(uuid, text)
  to authenticated;

-- ============================================================
-- override_coordination_request — leader + active membership
-- ============================================================

create or replace function public.override_coordination_request(
  p_request_id uuid,
  p_option_id text
)
returns public.coordination_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_request
  from public.coordination_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'open' then
    return v_request;
  end if;

  if not extensions.is_member(v_request.group_id)
     or not exists (
       select 1 from public.memberships m
       where m.group_id = v_request.group_id
         and m.user_id = (select auth.uid())
         and m.role = 'leader'
     ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  return public.coordination_close_request(
    p_request_id,
    p_option_id,
    'organizer_override',
    (select auth.uid()),
    'resolved'
  );
end;
$$;

revoke all on function public.override_coordination_request(uuid, text)
  from public, anon;
grant execute on function public.override_coordination_request(uuid, text)
  to authenticated;

-- ============================================================
-- resolve_coordination_request_deadline — active membership for caller
-- ============================================================

create or replace function public.resolve_coordination_request_deadline(
  p_request_id uuid
)
returns public.coordination_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
  v_user_ids uuid[];
  v_option_ids text[];
  v_eligible uuid[];
  v_outcome jsonb;
begin
  select * into v_request
  from public.coordination_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  -- Repeated triggers: one authoritative closed outcome.
  if v_request.status <> 'open' then
    return v_request;
  end if;

  if v_request.deadline > now() then
    raise exception 'deadline not reached' using errcode = '22023';
  end if;

  -- Authenticated callers must have expiry-aware active membership.
  -- Null auth.uid() is allowed for internal/deadline paths.
  if (select auth.uid()) is not null
     and not extensions.is_member(v_request.group_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;

  -- Eligible voters exclude expired anonymous members.
  select coalesce(array_agg(m.user_id), array[]::uuid[])
  into v_eligible
  from public.memberships m
  where m.group_id = v_request.group_id
    and public.anonymous_access_is_active(m.user_id)
    and (
      v_request.subgroup_id is null
      or m.subgroup_id is not distinct from v_request.subgroup_id
      or m.role = 'leader'
    );

  -- Defense-in-depth: only count responses from eligible participants.
  select
    coalesce(array_agg(cr.user_id order by cr.responded_at), array[]::uuid[]),
    coalesce(array_agg(cr.option_id order by cr.responded_at), array[]::text[])
  into v_user_ids, v_option_ids
  from public.coordination_responses cr
  where cr.request_id = p_request_id
    and cr.user_id = any(v_eligible);

  v_outcome := public.coordination_compute_outcome(
    v_request.policy,
    v_request.default_outcome,
    v_eligible,
    v_user_ids,
    v_option_ids
  );

  return public.coordination_close_request(
    p_request_id,
    v_outcome->>'option_id',
    v_outcome->>'source',
    coalesce((select auth.uid()), v_request.created_by),
    case
      when v_outcome->>'source' = 'timeout_default' then 'expired'
      else 'resolved'
    end
  );
end;
$$;

revoke all on function public.resolve_coordination_request_deadline(uuid)
  from public, anon;
grant execute on function public.resolve_coordination_request_deadline(uuid)
  to authenticated;

-- ============================================================
-- cancel_coordination_request — leader + active membership
-- ============================================================

create or replace function public.cancel_coordination_request(
  p_request_id uuid
)
returns public.coordination_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.coordination_requests;
  v_closed public.coordination_requests;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_request
  from public.coordination_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'open' then
    return v_request;
  end if;

  if not extensions.is_member(v_request.group_id)
     or not exists (
       select 1 from public.memberships m
       where m.group_id = v_request.group_id
         and m.user_id = (select auth.uid())
         and m.role = 'leader'
     ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  update public.coordination_requests
  set status = 'cancelled',
      resolved_outcome = null,
      resolution_source = 'cancelled',
      resolved_at = now(),
      resolved_by = (select auth.uid()),
      applied_operation_id = null,
      updated_at = now()
  where id = p_request_id
    and status = 'open'
  returning * into v_closed;

  if not found then
    select * into v_closed from public.coordination_requests where id = p_request_id;
  end if;

  return v_closed;
end;
$$;

revoke all on function public.cancel_coordination_request(uuid)
  from public, anon;
grant execute on function public.cancel_coordination_request(uuid)
  to authenticated;

-- ============================================================
-- request_group_location_refresh — active membership
-- ============================================================

create or replace function public.request_group_location_refresh(
  p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_requested_at timestamptz;
  v_retry integer;
begin
  if v_uid is null or not extensions.is_member(p_group_id) then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  insert into public.location_refresh_requests(group_id, requested_by, requested_at)
  values (p_group_id, v_uid, v_now)
  on conflict (group_id) do nothing;

  if not found then
    select r.requested_at
    into v_requested_at
    from public.location_refresh_requests r
    where r.group_id = p_group_id
    for update;

    if v_requested_at > v_now - interval '60 seconds' then
      v_retry := greatest(
        0,
        ceil(extract(epoch from (v_requested_at + interval '60 seconds' - v_now)))
      )::integer;
      return jsonb_build_object(
        'accepted', false,
        'retry_after_seconds', v_retry
      );
    end if;

    update public.location_refresh_requests
    set requested_by = v_uid,
        requested_at = v_now
    where group_id = p_group_id;
  end if;

  perform extensions.notify_push(jsonb_build_object(
    'category', 'location_refresh',
    'group_id', p_group_id,
    'sender_id', v_uid
  ));

  return jsonb_build_object(
    'accepted', true,
    'retry_after_seconds', 60
  );
end;
$$;

revoke all on function public.request_group_location_refresh(uuid)
  from public, anon;
grant execute on function public.request_group_location_refresh(uuid)
  to authenticated;

comment on function public.request_group_location_refresh(uuid) is
  'OTA-05: requires extensions.is_member (expiry-aware) before group location refresh.';
