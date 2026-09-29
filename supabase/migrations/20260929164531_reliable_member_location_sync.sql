-- Reliable location ingestion, recovery and server-clock refresh accounting.
create or replace function public.ingest_location_batch(p_events jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event jsonb;
  v_id uuid;
  v_group_id uuid;
  v_session_id uuid;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) > 100
     or octet_length(p_events::text) > 262144 then
    raise exception 'location batch must contain at most 100 events'
      using errcode = '22023';
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    begin
      v_id := (v_event->>'id')::uuid;
      v_group_id := (v_event->>'groupId')::uuid;
      v_session_id := nullif(v_event->>'navigationSessionId', '')::uuid;

      if not extensions.is_member(v_group_id) then
        raise exception 'not a group member' using errcode = '42501';
      end if;
      if not coalesce((
        select p.sharing_enabled from public.member_privacy_settings p
        where p.user_id = (select auth.uid())
      ), true) then
        v_rejected := v_rejected || jsonb_build_array(
          jsonb_build_object('id', v_id, 'reason', 'sharing_disabled')
        );
        continue;
      end if;
      if v_session_id is not null and not exists (
        select 1 from public.navigation_sessions s
        where s.id = v_session_id and s.group_id = v_group_id
      ) then
        raise exception 'navigation session does not belong to group' using errcode = '23503';
      end if;

      if to_timestamp((v_event->>'capturedAt')::double precision / 1000.0) > clock_timestamp() + interval '2 minutes'
         or to_timestamp((v_event->>'capturedAt')::double precision / 1000.0) < clock_timestamp() - interval '24 hours' then
        raise exception 'invalid sample timestamp' using errcode = '22023';
      end if;

      insert into public.location_upload_events (
        id, user_id, group_id, navigation_session_id, captured_at,
        latitude, longitude, horizontal_accuracy, speed, course,
        tracking_mode, source, sequence
      ) values (
        v_id, (select auth.uid()), v_group_id, v_session_id,
        to_timestamp((v_event->>'capturedAt')::double precision / 1000.0),
        (v_event#>>'{coords,latitude}')::double precision,
        (v_event#>>'{coords,longitude}')::double precision,
        (v_event#>>'{coords,accuracy}')::double precision,
        nullif(v_event#>>'{coords,speed}', '')::double precision,
        nullif(v_event#>>'{coords,course}', '')::double precision,
        v_event->>'trackingMode', v_event->>'source',
        (v_event->>'sequence')::bigint
      ) on conflict (id) do nothing;

      if not found then
        v_accepted := v_accepted || jsonb_build_array(v_id);
        continue;
      end if;

      insert into public.member_locations (
        group_id, user_id, latitude, longitude, updated_at,
        horizontal_accuracy, speed, course, captured_at,
        tracking_mode, navigation_session_id, source, sequence
      ) values (
        v_group_id, (select auth.uid()),
        (v_event#>>'{coords,latitude}')::double precision,
        (v_event#>>'{coords,longitude}')::double precision,
        now(), (v_event#>>'{coords,accuracy}')::double precision,
        nullif(v_event#>>'{coords,speed}', '')::double precision,
        nullif(v_event#>>'{coords,course}', '')::double precision,
        to_timestamp((v_event->>'capturedAt')::double precision / 1000.0),
        v_event->>'trackingMode', v_session_id, v_event->>'source',
        (v_event->>'sequence')::bigint
      )
      on conflict (group_id, user_id) do update
      set latitude = excluded.latitude,
          longitude = excluded.longitude,
          updated_at = excluded.updated_at,
          horizontal_accuracy = excluded.horizontal_accuracy,
          speed = excluded.speed,
          course = excluded.course,
          captured_at = excluded.captured_at,
          tracking_mode = excluded.tracking_mode,
          navigation_session_id = excluded.navigation_session_id,
          source = excluded.source,
          sequence = excluded.sequence
      where public.member_locations.captured_at is null
         or excluded.captured_at > public.member_locations.captured_at;

      if found then
        v_accepted := v_accepted || jsonb_build_array(v_id);
      else
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', 'stale_sample'));
      end if;
    exception
      when others then
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
          'id', coalesce(v_event->>'id', ''),
          'reason', case when sqlstate = '42501' then 'forbidden' when left(sqlstate, 2) in ('22', '23') then 'invalid_event' else 'retryable' end
        ));
    end;
  end loop;

  return jsonb_build_object('acceptedIds', v_accepted, 'rejected', v_rejected);
end;
$$;

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
  v_recipient_ids uuid[];
begin
  if v_uid is null or not extensions.is_member(p_group_id) then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  -- Serialize only the existing cooldown row so concurrent requests cannot
  -- fan out two refresh waves inside the same 60-second window.
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
      return jsonb_build_object('accepted', false, 'retry_after_seconds', v_retry, 'requested_at', v_requested_at);
    end if;

    update public.location_refresh_requests
       set requested_by = v_uid, requested_at = v_now
     where group_id = p_group_id;
  end if;

  -- This is the single expiry-aware recipient set shared with the durable
  -- ledger, the Edge fan-out, and the initiator's response accounting.
  select coalesce(array_agg(m.user_id order by m.user_id), '{}'::uuid[])
    into v_recipient_ids
    from public.memberships m
   where m.group_id = p_group_id
     and m.user_id <> v_uid
     and coalesce((select p.sharing_enabled from public.member_privacy_settings p where p.user_id = m.user_id), true)
     and coalesce(m.status, 'active') <> 'offline'
     and public.anonymous_access_is_active(m.user_id);

  insert into public.location_refresh_pending(group_id, user_id, requested_by, requested_at)
  select p_group_id, recipients.user_id, v_uid, v_now
    from unnest(v_recipient_ids) as recipients(user_id)
  on conflict (group_id, user_id) do update
        set requested_by = excluded.requested_by,
            requested_at = excluded.requested_at;

  perform extensions.notify_push(jsonb_build_object(
    'category', 'location_refresh',
    'group_id', p_group_id,
    'sender_id', v_uid,
    'recipient_ids', to_jsonb(v_recipient_ids)
  ));

  return jsonb_build_object(
    'accepted', true,
    'requested_at', v_now,
    'retry_after_seconds', 60,
    'recipient_ids', to_jsonb(v_recipient_ids)
  );
end;
$$;

-- Ticket 2: one authoritative recovery read for a group.
-- Realtime remains the fast path; this RPC is the 60-second/missed-event
-- recovery path and intentionally has no mutating fallback. The generation
-- timestamp is intentionally independent of core_entity_versions: existing
-- direct writes and member-location updates do not all create a core version,
-- while the client still needs a newer recovery response to clear a Realtime
-- revision fence.

create or replace function public.get_group_recovery_snapshot(p_group_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_revision text := to_char(
    now() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- SECURITY DEFINER bypasses table RLS; use the expiry-aware membership
  -- predicate so expired anonymous accounts cannot read full group state.
  if not extensions.is_member(p_group_id) then
    raise exception 'not_member' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'schema_version', 'group-recovery-v1',
    'generated_at', now(),
    'realtime_revision', v_revision,
    'group', (
      select to_jsonb(g)
        from public.groups g
       where g.id = p_group_id
    ),
    'memberships', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.user_id)
        from public.memberships m
       where m.group_id = p_group_id
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.id)
        from public.profiles p
       where p.id in (
         select m.user_id from public.memberships m where m.group_id = p_group_id
       )
    ), '[]'::jsonb),
    'subgroups', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.id)
        from public.subgroups s
       where s.group_id = p_group_id
    ), '[]'::jsonb),
    'itinerary', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.position, i.id)
        from public.itinerary_items i
       where i.group_id = p_group_id
    ), '[]'::jsonb),
    'location_sharing', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'sharing_enabled', coalesce(p.sharing_enabled, true)))
        from public.memberships m left join public.member_privacy_settings p on p.user_id = m.user_id
       where m.group_id = p_group_id
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.user_id)
        from public.member_locations l
       where l.group_id = p_group_id
         and coalesce((select p.sharing_enabled from public.member_privacy_settings p where p.user_id = l.user_id), true)
    ), '[]'::jsonb),
    'entity_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entity_type', v.entity_type,
        'entity_id', v.entity_id,
        'entity_version', v.entity_version,
        'updated_at', v.updated_at,
        'state', v.state
      ) order by v.entity_type, v.entity_id)
        from public.core_entity_versions v
       where v.group_id = p_group_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_group_recovery_snapshot(uuid) from public, anon;
grant execute on function public.get_group_recovery_snapshot(uuid) to authenticated;

comment on function public.get_group_recovery_snapshot(uuid) is
  'Single read snapshot for recovery; callers must merge by realtime_revision/entity_version.';

-- Keep legacy direct writers on the same server receipt clock.
create or replace function public.stamp_member_location_received_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists stamp_member_location_received_at on public.member_locations;
create trigger stamp_member_location_received_at before insert or update on public.member_locations
for each row execute function public.stamp_member_location_received_at();
revoke all on function public.stamp_member_location_received_at() from public, anon, authenticated;
revoke all on function public.ingest_location_batch(jsonb) from public, anon;
grant execute on function public.ingest_location_batch(jsonb) to authenticated;
revoke all on function public.request_group_location_refresh(uuid) from public, anon;
grant execute on function public.request_group_location_refresh(uuid) to authenticated;
