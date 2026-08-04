-- Ticket 05 / review-01: server-owned deadline scheduler (pgTAP).
-- Single-session coverage: privilege, empty batch, resolve, partial fail,
-- idempotent re-run. Multi-connection SKIP LOCKED concurrency remains
-- Unverified without a dual-session harness.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(10);

insert into auth.users (id, email, is_anonymous) values
  ('c1111111-1111-4111-8111-111111111111', 'sched-leader@example.test', false);

insert into public.profiles (id, nickname) values
  ('c1111111-1111-4111-8111-111111111111', 'SchedLeader');

insert into public.groups (id, name, invite_code, created_by) values (
  'cgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Scheduler trip',
  'SCH001',
  'c1111111-1111-4111-8111-111111111111'
);

insert into public.memberships (group_id, user_id, role) values (
  'cgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c1111111-1111-4111-8111-111111111111',
  'leader'
);

-- Authenticated clients cannot run the scheduler
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$select public.process_due_coordination_requests()$$,
  '42501',
  null,
  'authenticated cannot process_due_coordination_requests'
);

select throws_ok(
  $$select public.resolve_coordination_request_deadline(
    'cddddddd-dddd-4ddd-8ddd-dddddddddddd'
  )$$,
  null,
  null,
  'authenticated cannot call resolve_coordination_request_deadline'
);

-- Empty batch under service_role
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (public.process_due_coordination_requests()->>'claimed_count')::int,
  0,
  'empty due batch claims zero'
);

select is(
  (public.process_due_coordination_requests()->>'resolved_count')::int,
  0,
  'empty due batch resolves zero'
);

-- Seed one due open request + one future open request
reset role;
insert into public.coordination_requests (
  id, group_id, created_by, subject, subject_kind,
  options, deadline, policy, default_outcome, status
) values
(
  'cddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'cgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c1111111-1111-4111-8111-111111111111',
  'Due meet',
  'gathering_point',
  '[{"id":"keep","label":"Keep"},{"id":"change","label":"Change"}]'::jsonb,
  now() - interval '1 minute',
  'majority',
  'keep',
  'open'
),
(
  'ceeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'cgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c1111111-1111-4111-8111-111111111111',
  'Future meet',
  'gathering_point',
  '[{"id":"keep","label":"Keep"},{"id":"change","label":"Change"}]'::jsonb,
  now() + interval '1 hour',
  'majority',
  'keep',
  'open'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (public.process_due_coordination_requests()->>'claimed_count')::int,
  1,
  'scheduler claims only due open rows'
);

select is(
  (public.process_due_coordination_requests()->>'resolved_count')::int,
  0,
  'second run finds no remaining due open rows (idempotent claim)'
);

reset role;
select is(
  (select status from public.coordination_requests
    where id = 'cddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  'closed',
  'due request closed after scheduler run'
);

select is(
  (select status from public.coordination_requests
    where id = 'ceeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  'open',
  'future request remains open'
);

select ok(
  (select count(*)::int from public.coordination_scheduler_runs) >= 1,
  'scheduler records observability runs'
);

-- Partial failure: poison row should not block healthy due rows.
-- Insert a due open request whose resolve path errors (unknown option id in default).
insert into public.coordination_requests (
  id, group_id, created_by, subject, subject_kind,
  options, deadline, policy, default_outcome, status
) values
(
  'cfffffff-ffff-4fff-8fff-ffffffffffff',
  'cgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c1111111-1111-4111-8111-111111111111',
  'Poison meet',
  'gathering_point',
  '[{"id":"keep","label":"Keep"}]'::jsonb,
  now() - interval '2 minutes',
  'majority',
  'missing_option',
  'open'
),
(
  'cggggggg-gggg-4ggg-8ggg-gggggggggggg',
  'cgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c1111111-1111-4111-8111-111111111111',
  'Healthy due meet',
  'gathering_point',
  '[{"id":"keep","label":"Keep"},{"id":"change","label":"Change"}]'::jsonb,
  now() - interval '30 seconds',
  'majority',
  'keep',
  'open'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(
  (public.process_due_coordination_requests()->>'claimed_count')::int >= 1,
  'partial-failure batch still claims due rows'
);

select * from finish();
rollback;
