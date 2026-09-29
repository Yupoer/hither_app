-- pgTAP regression coverage for the durable actor-bound operation ledger.
-- Run with: supabase test db --local supabase/tests/core_operation_outbox_durable.test.sql
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(40);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'durable-leader@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'durable-follower@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'durable-subgroup-follower@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'durable-subgroup-leader@example.test');

insert into public.groups (id, name, invite_code, created_by) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'Durable outbox trip',
  'DUR001',
  '11111111-1111-4111-8111-111111111111'
);

-- The regression creates more than the free five open points; grant the
-- fixture an explicit trip entitlement instead of disabling the real limit.
insert into public.trip_entitlements(
  group_id, owner_user_id, plan_code, status, source
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '11111111-1111-4111-8111-111111111111',
  'lifetime_premium', 'active', 'grant'
);

insert into public.memberships (group_id, user_id, role) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 'leader'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '22222222-2222-4222-8222-222222222222', 'follower');

insert into public.subgroups (id, group_id, name, mode, leader_id) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'Durable subgroup', 'led',
  '44444444-4444-4444-8444-444444444444'
);
insert into public.memberships (group_id, user_id, role, subgroup_id) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '33333333-3333-4333-8333-333333333333', 'follower',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '44444444-4444-4444-8444-444444444444', 'leader',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01');

insert into public.itinerary_items (
  id, group_id, title, latitude, longitude, position, day, provider_place_id
) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'Provider place', 25.0478, 121.517, 0, 1, 'provider-open'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0002', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'Completed provider place', 25.0488, 121.518, 1, 1, 'provider-completed'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'New trip target', 25.0498, 121.519, 2, 1, 'provider-new');

update public.itinerary_items
set closed_at = now()
where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002';

insert into public.itinerary_items (
  id, group_id, subgroup_id, title, latitude, longitude, position, day, provider_place_id
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c02',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c01',
  'Subgroup reorder target', 25.0508, 121.520, 3, 1, 'provider-subgroup'
);

reset role;
select set_config('hither.durable_retry_inject', 'off', true);
create or replace function pg_temp.raise_durable_serialization()
returns trigger
language plpgsql
as $$
begin
  if current_setting('hither.durable_retry_inject', true) = 'on'
     and new.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003'::uuid then
    raise exception 'synthetic serialization failure' using errcode = '40001';
  end if;
  return new;
end;
$$;
create trigger durable_test_raise_serialization
  before update on public.itinerary_items
  for each row execute function pg_temp.raise_durable_serialization();

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select ok(
  to_regprocedure('public.apply_core_operation_v2(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamp with time zone)') is not null,
  'v2 RPC has the additive actor/sequence/dependency signature'
);
select ok(
  exists (
    select 1 from pg_attribute
    where attrelid = 'public.core_operations'::regclass
      and attname = 'client_sequence' and not attisdropped
  ),
  'server ledger stores client sequence'
);
select ok(
  exists (
    select 1 from pg_attribute
    where attrelid = 'public.itinerary_items'::regclass
      and attname = 'provider_place_id' and not attisdropped
  ),
  'itinerary stores stable provider identity'
);
select ok(
  not exists (select 1 from pg_indexes where indexname = 'core_operations_actor_sequence_unique')
    and exists (select 1 from pg_indexes where indexname = 'core_operations_actor_sequence_audit'),
  'client sequence is audit-only and does not identify a mutation'
);

create temporary table durable_test_versions(
  label text primary key,
  version integer not null
);
insert into durable_test_versions(label, version)
select 'before_merge', coalesce((
  select entity_version from public.core_entity_versions
  where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    and entity_type = 'itinerary'
    and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
), 0);

-- Start and end are one durable operation boundary: the ledger transition and
-- navigation session are both committed, and end does not close the stop.
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0101',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'start_gathering',
    jsonb_build_object(
      'activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001',
      'navigationRequestId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0201'
    ),
    1, '{}'::uuid[]
  )->>'status',
  'accepted', 'durable start is accepted'
);
select is(
  (select count(*)::integer from public.navigation_sessions
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and status = 'active'),
  1, 'durable start creates exactly one active navigation session'
);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0102',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'active_gathering', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1,
    'end_gathering',
    jsonb_build_object('activeDestinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'),
    2, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0101'::uuid]
  )->>'status',
  'accepted', 'durable end is accepted'
);
select is(
  (select count(*)::integer from public.navigation_sessions
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and status = 'active'),
  0, 'durable end cancels the original navigation session atomically'
);
select ok(
  (select closed_at is null from public.itinerary_items
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'),
  'durable end does not complete the destination'
);

-- Same provider identity merges only in the same open scope, even when the
-- client base version is stale. The local UUID is retained as an alias, the
-- remote row is not overwritten, and the authoritative version is returned.
with result as materialized (
  select public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0103',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'add_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0301',
      'title', 'Offline duplicate', 'latitude', 0, 'longitude', 0,
      'day', 1, 'kind', 'stop', 'providerPlaceId', 'provider-open'
    ),
    3, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0102'::uuid]
  ) as body
)
select ok(
  (select body->'effects'->'destinationIdAliases'->>'eeeeeeee-eeee-4eee-8eee-eeeeeeee0301' from result)
    = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'
    and (select (body->>'entity_version')::integer from result)
      = (select version from durable_test_versions where label = 'before_merge')
    and (select entity_version from public.core_entity_versions
         where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
           and entity_type = 'itinerary'
           and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
      = (select version from durable_test_versions where label = 'before_merge'),
  'stale same-provider merge accepts with the authoritative itinerary version'
);
select is(
  (select count(*)::integer from public.itinerary_items
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0301'),
  0, 'merged local destination is not inserted as a second server row'
);
select is(
  (select title from public.itinerary_items
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'),
  'Provider place', 'same-provider merge preserves the remote canonical row'
);
select is(
  (select (state->'destinations'->0->'coordinates'->>'latitude')::double precision
   from public.core_entity_versions
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and entity_type = 'itinerary'
     and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  25.0478::double precision, 'itinerary state keeps the nested coordinate shape'
);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0104',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select version from durable_test_versions where label = 'before_merge'),
    'add_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0401',
      'title', 'Revisit completed', 'latitude', 25, 'longitude', 121,
      'day', 1, 'kind', 'stop', 'providerPlaceId', 'provider-completed'
    ),
    4, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0103'::uuid]
  )->>'status',
  'accepted', 'completed provider place can be revisited'
);
select is(
  (select count(*)::integer from public.itinerary_items
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0401'),
  1, 'completed place is never an automatic merge candidate'
);

insert into durable_test_versions(label, version)
select 'before_duplicate', coalesce((
  select entity_version from public.core_entity_versions
  where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    and entity_type = 'itinerary'
    and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
), 0)
on conflict (label) do update set version = excluded.version;

-- Repeating the same operation ID is a ledger duplicate, not a second insert.
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0105',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select version from durable_test_versions where label = 'before_duplicate'),
    'add_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0501',
      'title', 'Idempotent place', 'latitude', 25, 'longitude', 121,
      'day', 1, 'kind', 'stop'
    ),
    5, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0104'::uuid]
  )->>'status',
  'accepted', 'first duplicate-test submission is accepted'
);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0105',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select version from durable_test_versions where label = 'before_duplicate'),
    'add_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0501',
      'title', 'Idempotent place', 'latitude', 25, 'longitude', 121,
      'day', 1, 'kind', 'stop'
    ),
    5, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0104'::uuid]
  )->>'status',
  'duplicate', 'replayed operation ID is duplicate'
);

select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0105',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select version from durable_test_versions where label = 'before_duplicate'),
    'add_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0501',
      'title', 'Different payload', 'latitude', 25, 'longitude', 121,
      'day', 1, 'kind', 'stop'
    ),
    5, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0104'::uuid]
  )->'conflict'->>'code',
  'operation_identity_mismatch', 'same UUID with a different payload is rejected'
);

-- Two devices can reuse a client sequence; UUID identity keeps both writes.
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0701',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select entity_version from public.core_entity_versions
     where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
       and entity_type = 'itinerary'
       and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
    'add_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0701',
      'title', 'Device one', 'latitude', 25, 'longitude', 121,
      'day', 1, 'kind', 'stop', 'providerPlaceId', 'provider-device-one'
    ),
    77, '{}'::uuid[]
  )->>'status',
  'accepted', 'first device operation with a reused sequence is accepted'
);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0702',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select entity_version from public.core_entity_versions
     where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
       and entity_type = 'itinerary'
       and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
    'add_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0702',
      'title', 'Device two', 'latitude', 26, 'longitude', 122,
      'day', 1, 'kind', 'stop', 'providerPlaceId', 'provider-device-two'
    ),
    77, '{}'::uuid[]
  )->>'status',
  'accepted', 'second device operation with the same sequence is accepted'
);
select is(
  (select count(*)::integer from public.core_operations
   where operation_id in (
     'eeeeeeee-eeee-4eee-8eee-eeeeeeee0701'::uuid,
     'eeeeeeee-eeee-4eee-8eee-eeeeeeee0702'::uuid
   ) and status = 'accepted'),
  2, 'same sequence values do not collapse distinct operation UUIDs'
);

-- Actor isolation and stale expected-version are terminal conflicts.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0601',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 3,
    'delete_destination',
    jsonb_build_object('destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'),
    1, '{}'::uuid[]
  )->'conflict'->>'code',
  'unauthorized', 'follower cannot mutate leader-owned main itinerary'
);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0602',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'delete_destination',
    jsonb_build_object('destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'),
    6, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0105'::uuid]
  )->'conflict'->>'code',
  'stale_version', 'stale expected version blocks later mutation'
);

-- Reorder authorization must use the authoritative scope leader helper for
-- every destination. Subgroup membership alone cannot bypass the legacy RPC's
-- RLS boundary, while the actual subgroup leader remains allowed.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c11',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '33333333-3333-4333-8333-333333333333',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select entity_version from public.core_entity_versions
     where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
       and entity_type = 'itinerary'
       and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
    'reorder_destinations',
    jsonb_build_object('updates', jsonb_build_array(jsonb_build_object(
      'id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c02', 'position', 4, 'day', 1
    ))),
    90, '{}'::uuid[]
  )->'conflict'->>'code',
  'unauthorized', 'subgroup follower cannot reorder its subgroup destination'
);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c12',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '44444444-4444-4444-8444-444444444444',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select entity_version from public.core_entity_versions
     where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
       and entity_type = 'itinerary'
       and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
    'reorder_destinations',
    jsonb_build_object('updates', jsonb_build_array(jsonb_build_object(
      'id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0c02', 'position', 4, 'day', 1
    ))),
    91, '{}'::uuid[]
  )->>'status',
  'accepted', 'subgroup leader can reorder its subgroup destination'
);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- A v2 exception must restore the transaction-local trigger marker so a
-- following legacy/direct write still advances the authoritative itinerary.
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0802',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select entity_version from public.core_entity_versions
     where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
       and entity_type = 'itinerary'
       and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
    'add_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0802',
      'title', 'Invalid kind', 'latitude', 25, 'longitude', 121,
      'day', 1, 'kind', 'not-a-kind'
    ),
    80, '{}'::uuid[]
  )->'conflict'->>'code',
  'validation', 'invalid v2 itinerary mutation is terminal validation'
);
insert into durable_test_versions(label, version)
select 'before_legacy_restore', entity_version
from public.core_entity_versions
where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  and entity_type = 'itinerary'
  and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
on conflict (label) do update set version = excluded.version;
update public.itinerary_items
set title = 'Legacy direct write after v2 exception'
where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003';
select ok(
  (select entity_version from public.core_entity_versions
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and entity_type = 'itinerary'
     and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    > (select version from durable_test_versions where label = 'before_legacy_restore')
    and nullif(current_setting('hither.core_operation_v2', true), '') is null,
  'legacy itinerary write bumps version after v2 exception restores bypass'
);

-- Retryable database failures must escape the durable conflict ledger. The
-- same operation UUID is retried after the injected serialization failure is
-- removed, with no version/GUC residue from the failed attempt.
insert into durable_test_versions(label, version)
select 'before_retry', entity_version
from public.core_entity_versions
where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  and entity_type = 'itinerary'
  and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
on conflict (label) do update set version = excluded.version;
select set_config('hither.durable_retry_inject', 'on', true);
select throws_ok(
  $$ select public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0b01',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select version from durable_test_versions where label = 'before_retry'),
    'edit_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003',
      'patch', jsonb_build_object('title', 'Retryable edit')
    ),
    92, '{}'::uuid[]
  ) $$,
  '40001',
  'synthetic serialization failure',
  'serialization failures escape as retryable errors'
);
select ok(
  (select entity_version from public.core_entity_versions
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and entity_type = 'itinerary'
     and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
      = (select version from durable_test_versions where label = 'before_retry')
    and nullif(current_setting('hither.core_operation_v2', true), '') is null
    and not exists (
      select 1 from public.core_operations
      where operation_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0b01'
    ),
  'retryable failure leaves no partial version, GUC marker, or terminal receipt'
);
select set_config('hither.durable_retry_inject', 'off', true);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0b01',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    (select version from durable_test_versions where label = 'before_retry'),
    'edit_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003',
      'patch', jsonb_build_object('title', 'Retryable edit')
    ),
    92, '{}'::uuid[]
  )->>'status',
  'accepted', 'the same operation UUID succeeds after the transient failure clears'
);

-- Request approval inserts itinerary rows through a legacy helper. It must
-- still bump the group itinerary version because the request is not the
-- outer itinerary mutation that owns the v2 trigger bypass.
insert into durable_test_versions(label, version)
select 'before_request_resolve', entity_version
from public.core_entity_versions
where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  and entity_type = 'itinerary'
  and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
on conflict (label) do update set version = excluded.version;
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0902',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0901', 0,
    'submit_gather_point_request',
    jsonb_build_object(
      'requestId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0901',
      'subgroupId', null,
      'items', jsonb_build_array(jsonb_build_object(
        'title', 'Requested unscheduled stop',
        'latitude', 24.9, 'longitude', 121.3, 'day', null
      ))
    ),
    81, '{}'::uuid[]
  )->>'status',
  'accepted', 'durable request submit is accepted by the real membership ACL'
);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0903',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0901', 0,
    'resolve_gather_point_request',
    jsonb_build_object(
      'requestId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0901',
      'approve', true
    ),
    82, array['eeeeeeee-eeee-4eee-8eee-eeeeeeee0902'::uuid]
  )->>'status',
  'accepted', 'durable request resolve is accepted by the real leader ACL'
);
select is(
  (select status from public.gather_point_requests
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0901'),
  'approved', 'request status is resolved atomically'
);
select ok(
  (select count(*)::integer from public.itinerary_items
   where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and title = 'Requested unscheduled stop') = 1
    and (select entity_version from public.core_entity_versions
         where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
           and entity_type = 'itinerary'
           and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
      = (select version + 1 from durable_test_versions where label = 'before_request_resolve'),
  'approved request side effect bumps the authoritative itinerary version'
);

-- An active session is bound to its original destination. Reusing that UUID
-- for another open destination must not record an arrival on the new target.
create temporary table durable_arrival_session(id uuid);
insert into durable_arrival_session(id)
select (public.start_navigation_session(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'::uuid,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0202'::uuid
)).id;
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0a01',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0003', 0,
    'record_arrival',
    jsonb_build_object(
      'userId', '11111111-1111-4111-8111-111111111111',
      'navigationSessionId', (select id::text from durable_arrival_session),
      'arrived', true
    ),
    83, '{}'::uuid[]
  )->'conflict'->>'code',
  'validation', 'old navigation session cannot arrive a different destination'
);
insert into durable_test_versions(label, version)
select 'before_arrival_completion', entity_version
from public.core_entity_versions
where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  and entity_type = 'itinerary'
  and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
on conflict (label) do update set version = excluded.version;
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0a02',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 0,
    'record_arrival',
    jsonb_build_object(
      'userId', '11111111-1111-4111-8111-111111111111',
      'navigationSessionId', (select id::text from durable_arrival_session),
      'arrived', true
    ),
    84, '{}'::uuid[]
  )->>'status',
  'accepted', 'leader arrival is accepted for the bound destination'
);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0a03',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 0,
    'record_arrival',
    jsonb_build_object(
      'userId', '22222222-2222-4222-8222-222222222222',
      'navigationSessionId', (select id::text from durable_arrival_session),
      'arrived', true
    ),
    84, '{}'::uuid[]
  )->>'status',
  'accepted', 'follower arrival is accepted without an actor identity mismatch'
);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select ok(
  (select closed_at is not null from public.itinerary_items
   where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001')
    and (select entity_version from public.core_entity_versions
         where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
           and entity_type = 'itinerary'
           and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
      = (select version + 1 from durable_test_versions where label = 'before_arrival_completion')
    and (select status from public.navigation_sessions
         where id = (select id from durable_arrival_session)) = 'completed'
    and (select result_state->>'completeSolo' from public.core_operations
         where operation_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0a02') = 'false'
    and (select result_state->>'completeSolo' from public.core_operations
         where operation_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0a03') = 'true',
  'arrival completion closes the actual destination and bumps itinerary version'
);

-- A group whose itinerary existed before this migration may have no version
-- row at all. The first v2 merge must lazily seed a complete canonical state,
-- and a following stale response must not expose an empty server snapshot.
reset role;
delete from public.core_entity_versions
where group_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  and entity_type = 'itinerary'
  and entity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
with result as materialized (
  select public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0d02',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0,
    'add_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0d01',
      'title', 'Pre-migration duplicate', 'latitude', 25, 'longitude', 121,
      'day', 1, 'kind', 'stop', 'providerPlaceId', 'provider-device-one'
    ),
    99, '{}'::uuid[]
  ) as body
)
select ok(
  (select body->>'status' from result) = 'accepted'
    and (select (body->>'entity_version')::integer from result) = 0
    and (select jsonb_array_length(body->'entity'->'destinations') from result) > 0,
  'first v2 write on a pre-migration group returns a complete canonical state'
);
with result as materialized (
  select public.apply_core_operation_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeee0d03',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '11111111-1111-4111-8111-111111111111',
    'itinerary', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1,
    'edit_destination',
    jsonb_build_object(
      'destinationId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0701',
      'patch', jsonb_build_object('title', 'Should not apply')
    ),
    100, '{}'::uuid[]
  ) as body
)
select ok(
  (select body->'conflict'->>'code' from result) = 'stale_version'
    and (select (body->'conflict'->>'server_entity_version')::integer from result) = 0
    and (select jsonb_array_length(body->'conflict'->'server_state'->'destinations') from result) > 0,
  'stale conflict on a pre-migration group returns the full canonical server state'
);

select * from finish();
rollback;
