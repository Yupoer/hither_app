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
        if not exists (
          select 1 from public.location_upload_events e
          where e.id = v_id and e.user_id = (select auth.uid()) and e.group_id = v_group_id
            and e.captured_at = to_timestamp((v_event->>'capturedAt')::double precision / 1000.0)
            and e.latitude = (v_event#>>'{coords,latitude}')::double precision
            and e.longitude = (v_event#>>'{coords,longitude}')::double precision
        ) then
          raise exception 'event id reused with different payload' using errcode = '22023';
        end if;
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
        -- Roll back the event insert too: a rejected event must never become an accepted duplicate.
        raise exception 'stale_sample' using errcode = 'P0001';
      end if;
    exception
      when others then
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
          'id', coalesce(v_event->>'id', ''),
          'reason', case when sqlstate = 'P0001' and sqlerrm = 'stale_sample' then 'stale_sample' when sqlstate = '42501' then 'forbidden' when left(sqlstate, 2) in ('22', '23') then 'invalid_event' else 'retryable' end
        ));
    end;
  end loop;

  return jsonb_build_object('acceptedIds', v_accepted, 'rejected', v_rejected);
end;
$$;
