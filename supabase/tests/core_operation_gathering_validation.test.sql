-- pgTAP: apply_core_operation gathering point validation (OTA-01 / OTA-04 P1).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(12);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'leader@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'follower@example.test');

insert into public.groups (id, name, invite_code, created_by) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Core op trip',
  'CORE01',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.memberships (group_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'leader'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'follower');

insert into public.itinerary_items (
  id, group_id, title, latitude, longitude, position, day
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'First',
  25.0478,
  121.517,
  0,
  1
), (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Second',
  25.0488,
  121.518,
  1,
  1
), (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Third',
  25.0498,
  121.519,
  2,
  1
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- 1) Unknown destination id is rejected.
select is(
  public.apply_core_operation(
    'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'active_gathering',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    0,
    'start_gathering',
    jsonb_build_object(
      'activeDestinationId', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    )
  )->>'status',
  'conflict',
  'start rejects unknown itinerary id'
);

select is(
  public.apply_core_operation(
    'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'active_gathering',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    0,
    'start_gathering',
    jsonb_build_object(
      'activeDestinationId', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    )
  )->'conflict'->>'code',
  'invalid_transition',
  'unknown id conflict is invalid_transition (idempotent replay)'
);

-- 2) Skipping the first open point is rejected.
select is(
  public.apply_core_operation(
    'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'active_gathering',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    0,
    'start_gathering',
    jsonb_build_object(
      'activeDestinationId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
    )
  )->'conflict'->>'message',
  'start only allowed on next pending gathering point',
  'start rejects non-next open gathering point'
);

-- 3) Valid next open point starts.
select is(
  public.apply_core_operation(
    'cccccccc-cccc-4ccc-8ccc-cccccccccc03',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'active_gathering',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    0,
    'start_gathering',
    jsonb_build_object(
      'activeDestinationId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
    )
  )->>'status',
  'accepted',
  'start accepts next open gathering point'
);

select is(
  (
    select state->>'journeyPhase'
    from public.core_entity_versions
    where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and entity_type = 'active_gathering'
      and entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  'en_route',
  'accepted start stores en_route phase'
);

select is(
  (
    select journey_status from public.groups
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  'going',
  'accepted start bridges legacy groups.journey_status'
);

-- 4) Stale concurrent start conflicts.
select is(
  public.apply_core_operation(
    'cccccccc-cccc-4ccc-8ccc-cccccccccc04',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'active_gathering',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    0,
    'start_gathering',
    jsonb_build_object(
      'activeDestinationId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
    )
  )->'conflict'->>'code',
  'stale_version',
  'stale start after accepted start returns stale_version'
);

-- 5) End with invented nextDestinationId is rejected.
select is(
  public.apply_core_operation(
    'cccccccc-cccc-4ccc-8ccc-cccccccccc05',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'active_gathering',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    1,
    'end_gathering',
    jsonb_build_object(
      'nextDestinationId', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    )
  )->'conflict'->>'message',
  'nextDestinationId is not a legal next gathering point',
  'end rejects unknown nextDestinationId'
);

-- 6) End pauses travel: soft cursor stays on paused point; itinerary stays open.
select is(
  public.apply_core_operation(
    'cccccccc-cccc-4ccc-8ccc-cccccccccc06',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'active_gathering',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    1,
    'end_gathering',
    '{}'::jsonb
  )->>'status',
  'accepted',
  'end accepts pause without nextDestinationId'
);

select is(
  (
    select state->>'activeDestinationId'
    from public.core_entity_versions
    where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and entity_type = 'active_gathering'
      and entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'end keeps soft cursor on the paused point'
);

select is(
  (
    select closed_at is null from public.itinerary_items
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ),
  true,
  'end does not close itinerary (complete_gathering_stop does)'
);

select is(
  (
    select state->'pointStatuses'->>'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
    from public.core_entity_versions
    where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and entity_type = 'active_gathering'
      and entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  'pending',
  'end reverts active point to pending'
);

-- 7) After pause, the same open point can be started again.
select is(
  public.apply_core_operation(
    'cccccccc-cccc-4ccc-8ccc-cccccccccc07',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'active_gathering',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    2,
    'start_gathering',
    jsonb_build_object(
      'activeDestinationId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
    )
  )->>'status',
  'accepted',
  'start accepts paused open gathering point again'
);

select * from finish();
rollback;
