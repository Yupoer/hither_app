begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(29);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'leader@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'follower@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'follower2@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'outsider_member@example.test');

insert into public.groups (id, name, invite_code, created_by) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Coord trip',
  'CORD09',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.memberships (group_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'leader'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'follower'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'follower'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'follower');

insert into public.subgroups (id, group_id, name, mode) values (
  'ssssssss-ssss-4sss-8sss-ssssssssssss',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Alpha squad',
  'collab'
);

-- Put follower + follower2 in the subgroup; outsider_member stays main-group only.
update public.memberships
set subgroup_id = 'ssssssss-ssss-4sss-8sss-ssssssssssss'
where user_id in (
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
);

insert into public.itinerary_items (
  id, group_id, title, latitude, longitude, position, closed_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Closed history stop',
  25.0,
  121.0,
  0,
  now() - interval '1 day'
), (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Open stop',
  25.1,
  121.1,
  1,
  null
);

select has_table('public', 'coordination_requests', 'coordination_requests exists');
select has_table('public', 'coordination_responses', 'coordination_responses exists');
select has_table('public', 'itinerary_operations', 'itinerary_operations exists');

-- Pure policy: zero responses → default
select is(
  public.coordination_compute_outcome(
    'majority',
    'keep',
    array[
      '11111111-1111-4111-8111-111111111111'::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid
    ],
    array[]::uuid[],
    array[]::text[]
  )->>'option_id',
  'keep',
  'majority with zero responses uses default'
);

-- Unanswered is not consent under unanimity
select is(
  public.coordination_compute_outcome(
    'unanimity',
    'keep',
    array[
      '11111111-1111-4111-8111-111111111111'::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid
    ],
    array['11111111-1111-4111-8111-111111111111'::uuid],
    array['change']
  )->>'option_id',
  'keep',
  'partial unanimity is not consent'
);

select is(
  public.coordination_compute_outcome(
    'majority',
    'keep',
    array[
      '11111111-1111-4111-8111-111111111111'::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid,
      '33333333-3333-4333-8333-333333333333'::uuid
    ],
    array[
      '11111111-1111-4111-8111-111111111111'::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid
    ],
    array['change', 'change']
  )->>'option_id',
  'change',
  'majority among responders only'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Non-leader cannot create
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$ select public.create_coordination_request(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    null,
    'Nope',
    'gathering_point',
    jsonb_build_array(
      jsonb_build_object('id', 'keep', 'label', 'Keep', 'kind', 'keep_current'),
      jsonb_build_object('id', 'change', 'label', 'Change', 'kind', 'keep_current')
    ),
    now() + interval '1 hour',
    'majority',
    'keep'
  ) $$,
  '42501',
  'leader membership required',
  'non-leader create denied'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

create temporary table test_req as
select * from public.create_coordination_request(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  null,
  'Move open stop',
  'gathering_point',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'keep',
      'label', 'Keep current',
      'kind', 'keep_current'
    ),
    jsonb_build_object(
      'id', 'change',
      'label', 'Move north',
      'kind', 'gathering_point',
      'payload', jsonb_build_object(
        'destinationId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        'title', 'Open stop north',
        'latitude', 25.2,
        'longitude', 121.2
      )
    )
  ),
  now() + interval '1 hour',
  'majority',
  'keep'
);

select is(
  (select status from test_req),
  'open',
  'leader creates open request'
);

-- Follower responds
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select lives_ok(
  format(
    'select public.respond_to_coordination_request(%L, %L)',
    (select id from test_req),
    'change'
  ),
  'member can respond while open'
);

-- Change response before close
select lives_ok(
  format(
    'select public.respond_to_coordination_request(%L, %L)',
    (select id from test_req),
    'keep'
  ),
  'member can change response before closure'
);

select is(
  (select option_id from public.coordination_responses
    where request_id = (select id from test_req)
      and user_id = '22222222-2222-4222-8222-222222222222'),
  'keep',
  'upsert keeps latest option only'
);

-- Follower cannot override
select throws_ok(
  format(
    'select public.override_coordination_request(%L, %L)',
    (select id from test_req),
    'change'
  ),
  '42501',
  'leader membership required',
  'non-leader override denied'
);

-- Organizer override closes atomically
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (public.override_coordination_request((select id from test_req), 'change')).status,
  'resolved',
  'organizer override resolves request'
);

select is(
  (public.override_coordination_request((select id from test_req), 'keep')).resolved_outcome,
  'change',
  'repeated override returns first authoritative outcome'
);

select is(
  (select count(*) from public.itinerary_operations
    where source_request_id = (select id from test_req)),
  1::bigint,
  'one versioned itinerary operation per resolve'
);

select is(
  (select title from public.itinerary_items
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  'Open stop north',
  'accepted outcome updates open itinerary stop'
);

select is(
  (select title from public.itinerary_items
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'Closed history stop',
  'closed history stop is not rewritten'
);

-- Response after closure rejected
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select throws_ok(
  format(
    'select public.respond_to_coordination_request(%L, %L)',
    (select id from test_req),
    'change'
  ),
  '23514',
  'request already closed',
  'rejects responses after closure'
);

-- Navigation start remains available with an open request elsewhere
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

create temporary table test_open as
select * from public.create_coordination_request(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  null,
  'Another open vote',
  'meet_time',
  jsonb_build_array(
    jsonb_build_object('id', 'keep', 'label', 'Keep', 'kind', 'keep_current'),
    jsonb_build_object(
      'id', 'later',
      'label', 'Later',
      'kind', 'meet_time',
      'payload', jsonb_build_object(
        'destinationId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        'meetAt', (now() + interval '2 hours')::text
      )
    )
  ),
  now() + interval '2 hours',
  'timeout_default',
  'keep'
);

select lives_ok(
  format(
    'select public.start_navigation_session(%L, %L, %L)',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  'navigation starts while a coordination request is open'
);

-- Cancel: no decided option, no apply
create temporary table test_cancel as
select * from public.create_coordination_request(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  null,
  'Will cancel',
  'itinerary',
  jsonb_build_array(
    jsonb_build_object('id', 'keep', 'label', 'Keep', 'kind', 'keep_current'),
    jsonb_build_object('id', 'go', 'label', 'Go', 'kind', 'keep_current')
  ),
  now() + interval '1 hour',
  'majority',
  'keep'
);

select is(
  (public.cancel_coordination_request((select id from test_cancel))).status,
  'cancelled',
  'cancel sets status cancelled'
);

select is(
  (select resolved_outcome from public.coordination_requests
    where id = (select id from test_cancel)),
  null,
  'cancel does not invent a resolved option'
);

select is(
  (select count(*) from public.itinerary_operations
    where source_request_id = (select id from test_cancel)),
  0::bigint,
  'cancel does not apply itinerary'
);

-- Deadline resolve → expired + timeout_default; second call idempotent
create temporary table test_deadline as
select * from public.create_coordination_request(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  null,
  'Past deadline',
  'gathering_point',
  jsonb_build_array(
    jsonb_build_object('id', 'keep', 'label', 'Keep', 'kind', 'keep_current'),
    jsonb_build_object('id', 'change', 'label', 'Change', 'kind', 'keep_current')
  ),
  now() + interval '1 hour',
  'timeout_default',
  'keep'
);

-- Force deadline into the past (create rejects past deadlines).
update public.coordination_requests
set deadline = now() - interval '5 seconds',
    created_at = now() - interval '1 hour'
where id = (select id from test_deadline);

select is(
  (public.resolve_coordination_request_deadline((select id from test_deadline))).status,
  'expired',
  'deadline resolve expires with timeout default'
);

select is(
  (select resolution_source from public.coordination_requests
    where id = (select id from test_deadline)),
  'timeout_default',
  'deadline resolution source is timeout_default'
);

select is(
  (public.resolve_coordination_request_deadline((select id from test_deadline))).resolved_outcome,
  'keep',
  'repeated deadline resolve returns same outcome'
);

select is(
  (select count(*) from public.itinerary_operations
    where source_request_id = (select id from test_deadline)),
  1::bigint,
  'deadline resolve creates one operation only'
);

-- Subgroup eligibility: outsider main-group member cannot respond
create temporary table test_sub as
select * from public.create_coordination_request(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ssssssss-ssss-4sss-8sss-ssssssssssss',
  'Squad only',
  'itinerary',
  jsonb_build_array(
    jsonb_build_object('id', 'keep', 'label', 'Keep', 'kind', 'keep_current'),
    jsonb_build_object('id', 'change', 'label', 'Change', 'kind', 'keep_current')
  ),
  now() + interval '1 hour',
  'majority',
  'keep'
);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select throws_ok(
  format(
    'select public.respond_to_coordination_request(%L, %L)',
    (select id from test_sub),
    'change'
  ),
  '42501',
  'not eligible for this request',
  'subgroup outsider cannot respond'
);

-- Eligible subgroup member can respond
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select lives_ok(
  format(
    'select public.respond_to_coordination_request(%L, %L)',
    (select id from test_sub),
    'change'
  ),
  'subgroup member can respond'
);

-- Leader (eligible) can respond to subgroup request
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  format(
    'select public.respond_to_coordination_request(%L, %L)',
    (select id from test_sub),
    'change'
  ),
  'leader eligible for subgroup request'
);

select * from finish();
rollback;
