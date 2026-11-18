begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(32);

insert into auth.users (id, email) values
  ('c1111111-1111-4111-8111-111111111111', 'telemetry@example.test');

select ok(
  not has_table_privilege('authenticated', 'public.diagnostic_sessions', 'INSERT'),
  'authenticated cannot insert diagnostic sessions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.diagnostic_sessions', 'UPDATE'),
  'authenticated cannot update diagnostic sessions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.diagnostic_events', 'INSERT'),
  'authenticated cannot insert diagnostic events directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.metric_payloads', 'INSERT'),
  'authenticated cannot insert metric payloads directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.performance_events', 'INSERT'),
  'authenticated cannot insert performance events directly'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.ingest_metric_payload(uuid,text,text,jsonb,timestamptz)',
    'EXECUTE'
  ),
  'anonymous callers cannot ingest metric payloads'
);
select ok(
  not has_function_privilege('anon', 'public.ingest_diagnostic_batch(jsonb)', 'EXECUTE'),
  'anonymous callers cannot ingest diagnostic batches'
);
select ok(
  not has_function_privilege('anon', 'public.ingest_performance_batch(jsonb)', 'EXECUTE'),
  'anonymous callers cannot ingest performance batches'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.ingest_metric_payload(uuid,text,text,jsonb,timestamptz)',
    'EXECUTE'
  ),
  'authenticated callers retain metric ingestion'
);
select ok(
  has_function_privilege('authenticated', 'public.ingest_diagnostic_batch(jsonb)', 'EXECUTE'),
  'authenticated callers retain diagnostic ingestion'
);
select ok(
  has_function_privilege('authenticated', 'public.ingest_performance_batch(jsonb)', 'EXECUTE'),
  'authenticated callers retain performance ingestion'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1111111-1111-4111-8111-111111111111', true);

select is(
  public.ingest_metric_payload(
    'c2000000-0000-4000-8000-000000000001',
    'device-0001',
    'metric',
    '{}'::jsonb,
    statement_timestamp()
  ),
  true,
  'current metric payload is accepted'
);
select is(
  (
    select user_id
    from public.metric_payloads
    where id = 'c2000000-0000-4000-8000-000000000001'
  ),
  'c1111111-1111-4111-8111-111111111111'::uuid,
  'metric RPC attributes the authenticated owner'
);
select is(
  public.ingest_metric_payload(
    'c2000000-0000-4000-8000-000000000001',
    'device-0001',
    'metric',
    '{}'::jsonb,
    statement_timestamp()
  ),
  true,
  'duplicate metric payload remains idempotent'
);

reset role;
select is(
  (select event_count from public.telemetry_retained_usage
    where user_id = 'c1111111-1111-4111-8111-111111111111'),
  1::bigint,
  'duplicate metric payload does not consume quota twice'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1111111-1111-4111-8111-111111111111', true);
select is(
  public.ingest_diagnostic_batch(jsonb_build_array(jsonb_build_object(
    'id', 'c3000000-0000-4000-8000-000000000001',
    'sessionId', 'c4000000-0000-4000-8000-000000000001',
    'timestamp', floor(extract(epoch from statement_timestamp()) * 1000)::bigint,
    'deviceId', 'device-0001',
    'buildNumber', '100',
    'appVersion', '1.0.0',
    'event', 'app_foreground',
    'navigationSessionId', null,
    'payload', '{}'::jsonb
  )))->'acceptedIds'->>0,
  'c3000000-0000-4000-8000-000000000001',
  'current diagnostic event is accepted'
);
select is(
  public.ingest_performance_batch(jsonb_build_array(jsonb_build_object(
    'id', 'c5000000-0000-4000-8000-000000000001',
    'sessionId', 'c6000000-0000-4000-8000-000000000001',
    'timestamp', floor(extract(epoch from statement_timestamp()) * 1000)::bigint,
    'eventType', 'sample',
    'operation', 'telemetry.test',
    'payload', '{}'::jsonb
  )))->'acceptedIds'->>0,
  'c5000000-0000-4000-8000-000000000001',
  'current performance event is accepted'
);
select is(
  public.ingest_diagnostic_batch(jsonb_build_array(jsonb_build_object(
    'id', 'c3000000-0000-4000-8000-000000000002',
    'sessionId', 'c4000000-0000-4000-8000-000000000002',
    'timestamp', floor(extract(epoch from statement_timestamp() - interval '31 days') * 1000)::bigint,
    'deviceId', 'device-0001',
    'buildNumber', '100',
    'appVersion', '1.0.0',
    'event', 'app_foreground',
    'navigationSessionId', null,
    'payload', '{}'::jsonb
  )))->'rejected'->0->>'reason',
  'stale_telemetry',
  'stale diagnostic timestamps are rejected'
);
select is(
  public.ingest_performance_batch(jsonb_build_array(jsonb_build_object(
    'id', 'c5000000-0000-4000-8000-000000000002',
    'sessionId', 'c6000000-0000-4000-8000-000000000002',
    'timestamp', floor(extract(epoch from statement_timestamp() + interval '6 minutes') * 1000)::bigint,
    'eventType', 'sample',
    'operation', 'telemetry.test',
    'payload', '{}'::jsonb
  )))->'rejected'->0->>'reason',
  'stale_telemetry',
  'future performance timestamps are rejected'
);

reset role;
select is(
  (select event_count from public.telemetry_retained_usage
    where user_id = 'c1111111-1111-4111-8111-111111111111'),
  3::bigint,
  'all accepted telemetry types share one retained quota'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1111111-1111-4111-8111-111111111111', true);
select is(
  public.ingest_metric_payload(
    'c2000000-0000-4000-8000-000000000002', 'device-0001', 'metric', '{}',
    statement_timestamp() - interval '31 days'
  ),
  false,
  'expired metric payload returns a terminal result for the spool'
);

reset role;
select is(
  (select count(*) from public.metric_payloads
    where id = 'c2000000-0000-4000-8000-000000000002'),
  0::bigint,
  'expired metric payload is never stored'
);
select is(
  (select event_count from public.telemetry_retained_usage
    where user_id = 'c1111111-1111-4111-8111-111111111111'),
  3::bigint,
  'expired metric payload consumes no retained quota'
);
set local role authenticated;
select throws_ok(
  $$select public.ingest_metric_payload(
    'c2000000-0000-4000-8000-000000000003', 'device-0001', 'metric', '{}',
    statement_timestamp() + interval '6 minutes'
  )$$,
  '22023',
  'stale_telemetry',
  'future metric timestamps are rejected'
);

reset role;
update public.telemetry_quota_usage
set event_count = 500
where user_id = 'c1111111-1111-4111-8111-111111111111' and period = 'hour';
set local role authenticated;
select throws_ok(
  $$select public.ingest_metric_payload(
    'c2000000-0000-4000-8000-000000000004', 'device-0001', 'metric', '{}',
    statement_timestamp()
  )$$,
  'P0001',
  'telemetry_hourly_quota_exceeded',
  'hourly event quota rejects excess before commit'
);

reset role;
update public.telemetry_quota_usage
set event_count = 3,
    payload_bytes = case when period = 'day' then 20 * 1024 * 1024 else 6 end
where user_id = 'c1111111-1111-4111-8111-111111111111';
set local role authenticated;
select throws_ok(
  $$select public.ingest_metric_payload(
    'c2000000-0000-4000-8000-000000000005', 'device-0001', 'metric', '{}',
    statement_timestamp()
  )$$,
  'P0001',
  'telemetry_daily_quota_exceeded',
  'daily byte quota rejects excess before commit'
);

reset role;
update public.telemetry_quota_usage
set event_count = 3, payload_bytes = 6
where user_id = 'c1111111-1111-4111-8111-111111111111';
update public.telemetry_retained_usage
set event_count = 10000
where user_id = 'c1111111-1111-4111-8111-111111111111';
set local role authenticated;
select throws_ok(
  $$select public.ingest_metric_payload(
    'c2000000-0000-4000-8000-000000000006', 'device-0001', 'metric', '{}',
    statement_timestamp()
  )$$,
  'P0001',
  'telemetry_retained_quota_exceeded',
  'retained event quota rejects excess before commit'
);

reset role;
select is(
  (select count(*) from public.metric_payloads
    where id in (
      'c2000000-0000-4000-8000-000000000004',
      'c2000000-0000-4000-8000-000000000005',
      'c2000000-0000-4000-8000-000000000006'
    )),
  0::bigint,
  'quota failures create no metric rows'
);

update public.telemetry_retained_usage
set event_count = 3, payload_bytes = 6
where user_id = 'c1111111-1111-4111-8111-111111111111';
update public.diagnostic_events set created_at = now() - interval '31 days'
where user_id = 'c1111111-1111-4111-8111-111111111111';
update public.diagnostic_sessions set created_at = now() - interval '31 days'
where user_id = 'c1111111-1111-4111-8111-111111111111';
update public.metric_payloads set created_at = now() - interval '31 days'
where user_id = 'c1111111-1111-4111-8111-111111111111';
update public.performance_events set created_at = now() - interval '31 days'
where user_id = 'c1111111-1111-4111-8111-111111111111';

select cmp_ok(
  public.purge_expired_telemetry(),
  '>=',
  4,
  'retention removes expired telemetry and orphan sessions'
);
select is(
  (
    select count(*) from (
      select id from public.diagnostic_events
      union all select id from public.metric_payloads
      union all select id from public.performance_events
    ) as telemetry
  ),
  0::bigint,
  'retention removes expired raw telemetry rows'
);
select is(
  (select count(*) from public.diagnostic_sessions
    where user_id = 'c1111111-1111-4111-8111-111111111111'),
  0::bigint,
  'retention removes orphan diagnostic sessions'
);
select is(
  (select count(*) from public.telemetry_retained_usage
    where user_id = 'c1111111-1111-4111-8111-111111111111'),
  0::bigint,
  'retention clears the retained usage record'
);

select * from finish();
rollback;
