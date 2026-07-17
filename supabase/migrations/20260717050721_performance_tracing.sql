-- Production performance tracing: raw events plus daily rollups.
-- Retention/deletion is intentionally a separate, approval-gated operation.

create table public.performance_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  occurred_at timestamptz not null,
  event_type text not null check (event_type in ('sample', 'trace', 'error')),
  operation text not null check (length(operation) between 1 and 120),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768),
  created_at timestamptz not null default now()
);

create index performance_events_occurred
  on public.performance_events(occurred_at desc);
create index performance_events_user_occurred
  on public.performance_events(user_id, occurred_at desc);
create index performance_events_rollup
  on public.performance_events(event_type, operation, occurred_at);

alter table public.performance_events enable row level security;
create policy "performance_events: own read"
  on public.performance_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy "performance_events: own insert"
  on public.performance_events for insert to authenticated
  with check (user_id = (select auth.uid()));
revoke all on public.performance_events from anon, authenticated;
grant select, insert on public.performance_events to authenticated;

create table public.performance_daily_rollups (
  bucket_date date not null,
  event_type text not null,
  operation text not null,
  build_number text not null,
  app_version text not null,
  device_model text not null,
  event_count bigint not null,
  duration_p50_ms double precision,
  duration_p95_ms double precision,
  cpu_time_total_ms double precision,
  cpu_percent_avg double precision,
  memory_avg_mb double precision,
  ui_fps_avg double precision,
  js_fps_avg double precision,
  frame_time_p95_ms double precision,
  missed_frame_ratio_avg double precision,
  thermal_escalation_count bigint not null default 0,
  error_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket_date, event_type, operation, build_number, app_version, device_model)
);

alter table public.performance_daily_rollups enable row level security;
revoke all on public.performance_daily_rollups from anon, authenticated;

create or replace function public.performance_number(p_payload jsonb, p_key text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_payload ->> p_key) ~ '^-?[0-9]+([.][0-9]+)?$'
      then (p_payload ->> p_key)::double precision
    else null
  end
$$;

create or replace function public.rollup_performance_day(p_day date)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.performance_daily_rollups (
    bucket_date, event_type, operation, build_number, app_version, device_model,
    event_count, duration_p50_ms, duration_p95_ms, cpu_time_total_ms,
    cpu_percent_avg, memory_avg_mb, ui_fps_avg, js_fps_avg,
    frame_time_p95_ms, missed_frame_ratio_avg, thermal_escalation_count,
    error_count, updated_at
  )
  select
    p_day,
    e.event_type,
    e.operation,
    coalesce(nullif(left(e.payload ->> 'buildNumber', 50), ''), 'unknown'),
    coalesce(nullif(left(e.payload ->> 'appVersion', 50), ''), 'unknown'),
    coalesce(nullif(left(e.payload ->> 'deviceModel', 120), ''), 'unknown'),
    count(*),
    percentile_cont(0.50) within group (order by public.performance_number(e.payload, 'durationMs')),
    percentile_cont(0.95) within group (order by public.performance_number(e.payload, 'durationMs')),
    sum(coalesce(public.performance_number(e.payload, 'cpuTimeMs'), 0)),
    avg(public.performance_number(e.payload, 'cpuPercent')),
    avg(public.performance_number(e.payload, 'memoryMb')),
    avg(public.performance_number(e.payload, 'uiFps')),
    avg(public.performance_number(e.payload, 'jsFps')),
    percentile_cont(0.95) within group (order by public.performance_number(e.payload, 'frameTimeP95Ms')),
    avg(public.performance_number(e.payload, 'missedFrameRatio')),
    count(*) filter (where e.payload ->> 'thermalState' in ('serious', 'critical')),
    count(*) filter (where e.event_type = 'error' or e.payload ->> 'outcome' = 'failed'),
    now()
  from public.performance_events e
  where e.occurred_at >= p_day::timestamptz
    and e.occurred_at < (p_day + 1)::timestamptz
  group by
    e.event_type,
    e.operation,
    coalesce(nullif(left(e.payload ->> 'buildNumber', 50), ''), 'unknown'),
    coalesce(nullif(left(e.payload ->> 'appVersion', 50), ''), 'unknown'),
    coalesce(nullif(left(e.payload ->> 'deviceModel', 120), ''), 'unknown')
  on conflict (bucket_date, event_type, operation, build_number, app_version, device_model)
  do update set
    event_count = excluded.event_count,
    duration_p50_ms = excluded.duration_p50_ms,
    duration_p95_ms = excluded.duration_p95_ms,
    cpu_time_total_ms = excluded.cpu_time_total_ms,
    cpu_percent_avg = excluded.cpu_percent_avg,
    memory_avg_mb = excluded.memory_avg_mb,
    ui_fps_avg = excluded.ui_fps_avg,
    js_fps_avg = excluded.js_fps_avg,
    frame_time_p95_ms = excluded.frame_time_p95_ms,
    missed_frame_ratio_avg = excluded.missed_frame_ratio_avg,
    thermal_escalation_count = excluded.thermal_escalation_count,
    error_count = excluded.error_count,
    updated_at = now();
end;
$$;

revoke all on function public.performance_number(jsonb, text) from public, anon, authenticated;
revoke all on function public.rollup_performance_day(date) from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'hither_performance_rollup';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'hither_performance_rollup',
    '15 3 * * *',
    'select public.rollup_performance_day(current_date - 1)'
  );
end;
$$;
