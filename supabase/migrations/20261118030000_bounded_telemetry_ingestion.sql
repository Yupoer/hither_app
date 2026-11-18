revoke insert, update on public.diagnostic_sessions from anon, authenticated;
revoke insert on public.diagnostic_events, public.metric_payloads,
  public.performance_events from anon, authenticated;

drop policy if exists "diagnostic_sessions: own rows" on public.diagnostic_sessions;
create policy "diagnostic_sessions: own read"
  on public.diagnostic_sessions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "diagnostic_events: own insert" on public.diagnostic_events;
drop policy if exists "metric_payloads: own insert" on public.metric_payloads;
drop policy if exists "performance_events: own insert" on public.performance_events;

create table public.telemetry_quota_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null check (period in ('hour', 'day')),
  bucket_start timestamptz not null,
  event_count bigint not null check (event_count >= 0),
  payload_bytes bigint not null check (payload_bytes >= 0),
  primary key (user_id, period, bucket_start)
);

create table public.telemetry_retained_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  event_count bigint not null check (event_count >= 0),
  payload_bytes bigint not null check (payload_bytes >= 0),
  updated_at timestamptz not null default now()
);

alter table public.telemetry_quota_usage enable row level security;
alter table public.telemetry_retained_usage enable row level security;
revoke all on public.telemetry_quota_usage, public.telemetry_retained_usage
  from public, anon, authenticated;

create index diagnostic_events_user_created
  on public.diagnostic_events(user_id, created_at desc);
create index metric_payloads_user_created
  on public.metric_payloads(user_id, created_at desc);
create index performance_events_user_created
  on public.performance_events(user_id, created_at desc);

with telemetry as (
  select user_id, created_at, octet_length(payload::text)::bigint as payload_bytes
  from public.diagnostic_events
  union all
  select user_id, created_at, octet_length(payload::text)::bigint
  from public.metric_payloads
  union all
  select user_id, created_at, octet_length(payload::text)::bigint
  from public.performance_events
)
insert into public.telemetry_quota_usage (
  user_id, period, bucket_start, event_count, payload_bytes
)
select user_id, 'hour', date_trunc('hour', now()), count(*), sum(payload_bytes)
from telemetry
where created_at >= date_trunc('hour', now())
group by user_id;

with telemetry as (
  select user_id, created_at, octet_length(payload::text)::bigint as payload_bytes
  from public.diagnostic_events
  union all
  select user_id, created_at, octet_length(payload::text)::bigint
  from public.metric_payloads
  union all
  select user_id, created_at, octet_length(payload::text)::bigint
  from public.performance_events
)
insert into public.telemetry_quota_usage (
  user_id, period, bucket_start, event_count, payload_bytes
)
select user_id, 'day', date_trunc('day', now()), count(*), sum(payload_bytes)
from telemetry
where created_at >= date_trunc('day', now())
group by user_id;

with telemetry as (
  select user_id, octet_length(payload::text)::bigint as payload_bytes
  from public.diagnostic_events
  union all
  select user_id, octet_length(payload::text)::bigint
  from public.metric_payloads
  union all
  select user_id, octet_length(payload::text)::bigint
  from public.performance_events
)
insert into public.telemetry_retained_usage (
  user_id, event_count, payload_bytes
)
select user_id, count(*), sum(payload_bytes)
from telemetry
group by user_id;

create or replace function public.consume_telemetry_quota(
  p_user_id uuid,
  p_payload_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_allowed boolean;
begin
  if p_user_id is null or p_user_id is distinct from auth.uid() then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_payload_bytes is null or p_payload_bytes < 0 or p_payload_bytes > 1048576 then
    raise exception 'invalid_telemetry_size' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('telemetry:' || p_user_id::text, 0)
  );

  delete from public.telemetry_quota_usage
  where user_id = p_user_id
    and (
      period = 'hour' and bucket_start < date_trunc('hour', v_now)
      or period = 'day' and bucket_start < date_trunc('day', v_now)
    );

  insert into public.telemetry_quota_usage as usage (
    user_id, period, bucket_start, event_count, payload_bytes
  ) values (
    p_user_id, 'hour', date_trunc('hour', v_now), 1, p_payload_bytes
  )
  on conflict (user_id, period, bucket_start) do update
  set event_count = usage.event_count + excluded.event_count,
      payload_bytes = usage.payload_bytes + excluded.payload_bytes
  where usage.event_count + excluded.event_count <= 500
    and usage.payload_bytes + excluded.payload_bytes <= 5 * 1024 * 1024
  returning true into v_allowed;
  if v_allowed is distinct from true then
    raise exception 'telemetry_hourly_quota_exceeded' using errcode = 'P0001';
  end if;

  v_allowed := null;
  insert into public.telemetry_quota_usage as usage (
    user_id, period, bucket_start, event_count, payload_bytes
  ) values (
    p_user_id, 'day', date_trunc('day', v_now), 1, p_payload_bytes
  )
  on conflict (user_id, period, bucket_start) do update
  set event_count = usage.event_count + excluded.event_count,
      payload_bytes = usage.payload_bytes + excluded.payload_bytes
  where usage.event_count + excluded.event_count <= 2000
    and usage.payload_bytes + excluded.payload_bytes <= 20 * 1024 * 1024
  returning true into v_allowed;
  if v_allowed is distinct from true then
    raise exception 'telemetry_daily_quota_exceeded' using errcode = 'P0001';
  end if;

  v_allowed := null;
  insert into public.telemetry_retained_usage as usage (
    user_id, event_count, payload_bytes, updated_at
  ) values (
    p_user_id, 1, p_payload_bytes, v_now
  )
  on conflict (user_id) do update
  set event_count = usage.event_count + excluded.event_count,
      payload_bytes = usage.payload_bytes + excluded.payload_bytes,
      updated_at = excluded.updated_at
  where usage.event_count + excluded.event_count <= 10000
    and usage.payload_bytes + excluded.payload_bytes <= 50 * 1024 * 1024
  returning true into v_allowed;
  if v_allowed is distinct from true then
    raise exception 'telemetry_retained_quota_exceeded' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.consume_telemetry_quota(uuid, bigint)
  from public, anon, authenticated;

create or replace function public.ingest_diagnostic_batch(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event jsonb;
  v_id uuid;
  v_session_id uuid;
  v_occurred_at timestamptz;
  v_inserted bigint;
  v_owner uuid;
  v_payload jsonb;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'diagnostic batch must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 100
     or octet_length(p_events::text) > 524288 then
    raise exception 'diagnostic batch must contain at most 100 events'
      using errcode = '22023';
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    begin
      v_id := (v_event->>'id')::uuid;
      v_session_id := (v_event->>'sessionId')::uuid;
      v_occurred_at := to_timestamp(
        (v_event->>'timestamp')::double precision / 1000.0
      );
      v_payload := coalesce(v_event->'payload', '{}'::jsonb);
      if v_occurred_at is null or not isfinite(v_occurred_at)
         or v_occurred_at < statement_timestamp() - interval '30 days'
         or v_occurred_at > statement_timestamp() + interval '5 minutes' then
        raise exception 'stale_telemetry' using errcode = '22023';
      end if;
      if jsonb_typeof(v_payload) is distinct from 'object' then
        raise exception 'invalid_telemetry_payload' using errcode = '22023';
      end if;

      perform pg_advisory_xact_lock(
        hashtextextended('telemetry:' || v_uid::text, 0)
      );
      select user_id into v_owner
      from public.diagnostic_events
      where id = v_id;
      if found then
        if v_owner is distinct from v_uid then
          raise exception 'diagnostic_event_owner_mismatch' using errcode = '42501';
        end if;
        v_accepted := v_accepted || jsonb_build_array(v_id);
        continue;
      end if;

      perform public.consume_telemetry_quota(
        v_uid, octet_length(v_payload::text)
      );

      insert into public.diagnostic_sessions (
        id, user_id, device_id, build_number, app_version, started_at
      ) values (
        v_session_id, v_uid, v_event->>'deviceId',
        v_event->>'buildNumber', v_event->>'appVersion', v_occurred_at
      ) on conflict (id) do nothing;

      if not exists (
        select 1 from public.diagnostic_sessions
        where id = v_session_id and user_id = v_uid
      ) then
        raise exception 'diagnostic_session_owner_mismatch' using errcode = '42501';
      end if;

      insert into public.diagnostic_events (
        id, diagnostic_session_id, user_id, occurred_at, event,
        navigation_session_id, payload
      ) values (
        v_id, v_session_id, v_uid, v_occurred_at,
        v_event->>'event', nullif(v_event->>'navigationSessionId', '')::uuid,
        v_payload
      ) on conflict (id) do nothing;
      get diagnostics v_inserted = row_count;

      if v_inserted <> 1 and not exists (
        select 1 from public.diagnostic_events
        where id = v_id and user_id = v_uid
      ) then
        raise exception 'diagnostic_event_owner_mismatch' using errcode = '42501';
      end if;

      v_accepted := v_accepted || jsonb_build_array(v_id);
    exception
      when others then
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
          'id', coalesce(v_event->>'id', ''),
          'reason', case
            when sqlstate = 'P0001' then 'quota_exceeded'
            when sqlerrm = 'stale_telemetry' then 'stale_telemetry'
            else 'invalid_event'
          end
        ));
    end;
  end loop;
  return jsonb_build_object('acceptedIds', v_accepted, 'rejected', v_rejected);
end;
$$;

create or replace function public.ingest_metric_payload(
  p_id uuid,
  p_device_id text,
  p_kind text,
  p_payload jsonb,
  p_received_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inserted bigint;
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_received_at is null or not isfinite(p_received_at)
     or p_received_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'stale_telemetry' using errcode = '22023';
  end if;
  if p_received_at < statement_timestamp() - interval '30 days' then
    return false;
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid_telemetry_payload' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('telemetry:' || v_uid::text, 0)
  );
  select user_id into v_owner
  from public.metric_payloads
  where id = p_id;
  if found then
    if v_owner is distinct from v_uid then
      raise exception 'metric_payload_owner_mismatch' using errcode = '42501';
    end if;
    return true;
  end if;

  perform public.consume_telemetry_quota(
    v_uid, octet_length(p_payload::text)
  );

  insert into public.metric_payloads (
    id, user_id, device_id, kind, payload, received_at
  ) values (
    p_id, v_uid, p_device_id, p_kind, p_payload, p_received_at
  ) on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted <> 1 and not exists (
    select 1 from public.metric_payloads where id = p_id and user_id = v_uid
  ) then
    raise exception 'metric_payload_owner_mismatch' using errcode = '42501';
  end if;
  return true;
end;
$$;

create or replace function public.ingest_performance_batch(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event jsonb;
  v_id uuid;
  v_occurred_at timestamptz;
  v_payload jsonb;
  v_inserted bigint;
  v_owner uuid;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'performance batch must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 100
     or octet_length(p_events::text) > 4194304 then
    raise exception 'performance batch is too large' using errcode = '22023';
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    begin
      v_id := (v_event->>'id')::uuid;
      v_occurred_at := to_timestamp(
        (v_event->>'timestamp')::double precision / 1000.0
      );
      v_payload := coalesce(v_event->'payload', '{}'::jsonb);
      if v_occurred_at is null or not isfinite(v_occurred_at)
         or v_occurred_at < statement_timestamp() - interval '30 days'
         or v_occurred_at > statement_timestamp() + interval '5 minutes' then
        raise exception 'stale_telemetry' using errcode = '22023';
      end if;
      if jsonb_typeof(v_payload) is distinct from 'object' then
        raise exception 'invalid_telemetry_payload' using errcode = '22023';
      end if;

      perform pg_advisory_xact_lock(
        hashtextextended('telemetry:' || v_uid::text, 0)
      );
      select user_id into v_owner
      from public.performance_events
      where id = v_id;
      if found then
        if v_owner is distinct from v_uid then
          raise exception 'performance_event_owner_mismatch' using errcode = '42501';
        end if;
        v_accepted := v_accepted || jsonb_build_array(v_id);
        continue;
      end if;

      perform public.consume_telemetry_quota(
        v_uid, octet_length(v_payload::text)
      );

      insert into public.performance_events (
        id, user_id, session_id, occurred_at, event_type, operation, payload
      ) values (
        v_id, v_uid, (v_event->>'sessionId')::uuid, v_occurred_at,
        v_event->>'eventType', v_event->>'operation', v_payload
      ) on conflict (id) do nothing;
      get diagnostics v_inserted = row_count;

      if v_inserted <> 1 and not exists (
        select 1 from public.performance_events
        where id = v_id and user_id = v_uid
      ) then
        raise exception 'performance_event_owner_mismatch' using errcode = '42501';
      end if;

      v_accepted := v_accepted || jsonb_build_array(v_id);
    exception
      when others then
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
          'id', coalesce(v_event->>'id', ''),
          'reason', case
            when sqlstate = 'P0001' then 'quota_exceeded'
            when sqlerrm = 'stale_telemetry' then 'stale_telemetry'
            else 'invalid_event'
          end
        ));
    end;
  end loop;
  return jsonb_build_object('acceptedIds', v_accepted, 'rejected', v_rejected);
end;
$$;

revoke all on function public.ingest_diagnostic_batch(jsonb)
  from public, anon, authenticated;
revoke all on function public.ingest_metric_payload(uuid, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.ingest_performance_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_diagnostic_batch(jsonb) to authenticated;
grant execute on function public.ingest_metric_payload(uuid, text, text, jsonb, timestamptz)
  to authenticated;
grant execute on function public.ingest_performance_batch(jsonb) to authenticated;

create or replace function public.purge_expired_telemetry()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_cutoff timestamptz := statement_timestamp() - interval '30 days';
  v_rows bigint;
  v_deleted bigint := 0;
  v_event_count bigint;
  v_payload_bytes bigint;
begin
  for v_uid in
    select user_id from public.diagnostic_events
    union
    select user_id from public.metric_payloads
    union
    select user_id from public.performance_events
    union
    select user_id from public.diagnostic_sessions
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('telemetry:' || v_uid::text, 0)
    );

    delete from public.diagnostic_events
    where user_id = v_uid and created_at < v_cutoff;
    get diagnostics v_rows = row_count;
    v_deleted := v_deleted + v_rows;

    with ranked as (
      select id,
        row_number() over (order by created_at desc, id) as retained_row,
        sum(octet_length(payload::text)) over (
          order by created_at desc, id rows unbounded preceding
        ) as retained_bytes
      from public.diagnostic_events
      where user_id = v_uid
    )
    delete from public.diagnostic_events as events
    using ranked
    where events.id = ranked.id
      and (ranked.retained_row > 5000 or ranked.retained_bytes > 10 * 1024 * 1024);
    get diagnostics v_rows = row_count;
    v_deleted := v_deleted + v_rows;

    delete from public.diagnostic_sessions as sessions
    where sessions.user_id = v_uid
      and not exists (
        select 1 from public.diagnostic_events as events
        where events.diagnostic_session_id = sessions.id
      );
    get diagnostics v_rows = row_count;
    v_deleted := v_deleted + v_rows;

    delete from public.metric_payloads
    where user_id = v_uid and created_at < v_cutoff;
    get diagnostics v_rows = row_count;
    v_deleted := v_deleted + v_rows;

    with ranked as (
      select id,
        row_number() over (order by created_at desc, id) as retained_row,
        sum(octet_length(payload::text)) over (
          order by created_at desc, id rows unbounded preceding
        ) as retained_bytes
      from public.metric_payloads
      where user_id = v_uid
    )
    delete from public.metric_payloads as payloads
    using ranked
    where payloads.id = ranked.id
      and (ranked.retained_row > 1000 or ranked.retained_bytes > 30 * 1024 * 1024);
    get diagnostics v_rows = row_count;
    v_deleted := v_deleted + v_rows;

    delete from public.performance_events
    where user_id = v_uid and created_at < v_cutoff;
    get diagnostics v_rows = row_count;
    v_deleted := v_deleted + v_rows;

    with ranked as (
      select id,
        row_number() over (order by created_at desc, id) as retained_row,
        sum(octet_length(payload::text)) over (
          order by created_at desc, id rows unbounded preceding
        ) as retained_bytes
      from public.performance_events
      where user_id = v_uid
    )
    delete from public.performance_events as events
    using ranked
    where events.id = ranked.id
      and (ranked.retained_row > 4000 or ranked.retained_bytes > 10 * 1024 * 1024);
    get diagnostics v_rows = row_count;
    v_deleted := v_deleted + v_rows;

    select count(*), coalesce(sum(payload_bytes), 0)
    into v_event_count, v_payload_bytes
    from (
      select octet_length(payload::text)::bigint as payload_bytes
      from public.diagnostic_events where user_id = v_uid
      union all
      select octet_length(payload::text)::bigint
      from public.metric_payloads where user_id = v_uid
      union all
      select octet_length(payload::text)::bigint
      from public.performance_events where user_id = v_uid
    ) as retained;

    if v_event_count = 0 then
      delete from public.telemetry_retained_usage where user_id = v_uid;
    else
      insert into public.telemetry_retained_usage (
        user_id, event_count, payload_bytes, updated_at
      ) values (
        v_uid, v_event_count, v_payload_bytes, statement_timestamp()
      )
      on conflict (user_id) do update
      set event_count = excluded.event_count,
          payload_bytes = excluded.payload_bytes,
          updated_at = excluded.updated_at;
    end if;
  end loop;

  delete from public.telemetry_quota_usage
  where period = 'hour' and bucket_start < date_trunc('hour', statement_timestamp())
     or period = 'day' and bucket_start < date_trunc('day', statement_timestamp());

  delete from public.performance_daily_rollups
  where bucket_date < current_date - 90;
  get diagnostics v_rows = row_count;
  v_deleted := v_deleted + v_rows;

  return v_deleted::integer;
end;
$$;

revoke all on function public.purge_expired_telemetry()
  from public, anon, authenticated;
grant execute on function public.purge_expired_telemetry() to service_role;

do $$
begin
  perform public.purge_expired_telemetry();
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'hither-telemetry-retention';
  perform cron.schedule(
    'hither-telemetry-retention',
    '35 4 * * *',
    'select public.purge_expired_telemetry()'
  );
end;
$$;
