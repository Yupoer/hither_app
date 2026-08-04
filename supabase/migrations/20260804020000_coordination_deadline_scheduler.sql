-- Ticket 3: deadline closure is server-owned and bounded.

create table if not exists public.coordination_scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  claimed_count integer not null default 0,
  resolved_count integer not null default 0,
  error_count integer not null default 0,
  last_error text
);

create index if not exists coordination_scheduler_runs_started_idx
  on public.coordination_scheduler_runs(started_at desc);

alter table public.coordination_scheduler_runs enable row level security;
-- No client policy: scheduler observability is server-owned.

create or replace function public.process_due_coordination_requests()
returns jsonb
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_run public.coordination_scheduler_runs%rowtype;
  v_request public.coordination_requests%rowtype;
  v_claimed integer := 0;
  v_resolved integer := 0;
  v_errors integer := 0;
  v_last_error text;
begin
  -- Supabase pg_cron runs as postgres; Edge/server workers use service_role.
  -- No authenticated or anon caller may turn this into a write endpoint.
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user not in ('service_role', 'postgres') then
    raise exception 'coordination_scheduler_forbidden' using errcode = '42501';
  end if;

  insert into public.coordination_scheduler_runs default values returning * into v_run;

  for v_request in
    select r.*
      from public.coordination_requests r
     where r.status = 'open'
       and r.deadline <= now()
     order by r.deadline asc
     for update skip locked
     limit 100
  loop
    v_claimed := v_claimed + 1;
    begin
      perform public.resolve_coordination_request_deadline(v_request.id);
      v_resolved := v_resolved + 1;
    exception when others then
      v_errors := v_errors + 1;
      v_last_error := left(sqlerrm, 500);
    end;
  end loop;

  update public.coordination_scheduler_runs
     set finished_at = now(),
         claimed_count = v_claimed,
         resolved_count = v_resolved,
         error_count = v_errors,
         last_error = v_last_error
   where id = v_run.id;

  return jsonb_build_object(
    'ok', true,
    'run_id', v_run.id,
    'claimed_count', v_claimed,
    'resolved_count', v_resolved,
    'error_count', v_errors
  );
end;
$$;

revoke all on function public.process_due_coordination_requests() from public, anon, authenticated;
grant execute on function public.process_due_coordination_requests() to service_role;

-- Client reads no longer execute a due resolver. Keep the single-row and old
-- group helper available only to the scheduler/definer paths.
revoke all on function public.resolve_due_coordination_requests(uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_coordination_request_deadline(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_coordination_request_deadline(uuid) to service_role;

-- pg_cron is optional in local/preview databases. When available, install one
-- bounded every-minute job; when unavailable, leave a notice and keep the
-- migration applicable so deployment can configure an external scheduler.
do $do$
begin
  begin
    create extension if not exists pg_cron;
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''hither-coordination-deadlines''';
    execute format(
      'select cron.schedule(%L, %L, %L)',
      'hither-coordination-deadlines',
      '* * * * *',
      'select public.process_due_coordination_requests()'
    );
  exception when others then
    raise notice 'pg_cron unavailable; process_due_coordination_requests requires an external scheduler: %', sqlerrm;
  end;
end;
$do$;
