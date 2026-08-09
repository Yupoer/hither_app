-- REVIEW_FIX #158 r2: executable daily-accommodation security + concurrency tests.
-- pgTAP-oriented. Requires full schema (is_member, memberships, groups, etc.).

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(19);

select has_function(
  'extensions',
  'set_daily_accommodation_with_auto_add',
  array['uuid','date','text','text','double precision','double precision','uuid','int']
);
select has_function(
  'extensions',
  'clear_daily_accommodation_with_downgrade',
  array['uuid','date','int']
);
select has_function(
  'public',
  'set_daily_accommodation_with_auto_add',
  array['uuid','date','text','text','double precision','double precision','uuid','int']
);
select has_function(
  'public',
  'clear_daily_accommodation_with_downgrade',
  array['uuid','date','int']
);

-- Fixtures: registered leader + expired anonymous leader (role=leader row retained).
insert into auth.users (id, email, is_anonymous) values
  ('d1111111-1111-4111-8111-111111111111', 'daily-leader@example.test', false),
  ('d2222222-2222-4222-8222-222222222222', 'daily-anon-leader@example.test', true);

insert into public.profiles (id, display_name, anonymous_expires_at) values
  ('d1111111-1111-4111-8111-111111111111', 'DailyLeader', null),
  (
    'd2222222-2222-4222-8222-222222222222',
    'DailyAnonLeader',
    now() - interval '1 hour'
  );

insert into public.groups (id, name, invite_code, created_by, accommodation_auto_add) values
(
  'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Daily stay trip',
  'DAY001',
  'd1111111-1111-4111-8111-111111111111',
  true
),
(
  'dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Anon leader daily trip',
  'DAY002',
  'd2222222-2222-4222-8222-222222222222',
  true
);

insert into public.memberships (group_id, user_id, role, created_at) values
  (
    'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'd1111111-1111-4111-8111-111111111111',
    'leader',
    now() - interval '2 days'
  ),
  (
    'dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'd2222222-2222-4222-8222-222222222222',
    'leader',
    now() - interval '2 days'
  );

-- Expired anonymous leader: memberships.role=leader but is_member false → denied.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd2222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  not extensions.is_member('dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'expired anonymous leader is_member false despite role=leader'
);

select throws_ok(
  $$select public.set_daily_accommodation_with_auto_add(
    'dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
    '2026-08-10'::date,
    'Hotel',
    null,
    25.0,
    121.0,
    null,
    1
  )$$,
  null,
  null,
  'expired anonymous leader cannot set_daily_accommodation_with_auto_add'
);

select throws_ok(
  $$select public.clear_daily_accommodation_with_downgrade(
    'dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
    '2026-08-10'::date,
    1
  )$$,
  null,
  null,
  'expired anonymous leader cannot clear_daily_accommodation_with_downgrade'
);

-- Direct table write also denied by expiry-aware RLS.
select throws_ok(
  $$insert into public.daily_accommodations (
    group_id, stay_date, title, latitude, longitude
  ) values (
    'dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '2026-08-10',
    'Hotel RLS',
    25.0,
    121.0
  )$$,
  null,
  null,
  'expired anonymous leader denied daily_accommodations insert via RLS'
);

-- Active registered leader: none→some auto-add under serialization.
select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);

select lives_ok(
  $$select public.set_daily_accommodation_with_auto_add(
    'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    '2026-08-11'::date,
    'Stay A',
    'Addr',
    25.1,
    121.1,
    null,
    1
  )$$,
  'active leader none→some succeeds'
);

select is(
  (select count(*)::int from public.daily_accommodations
    where group_id = 'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and stay_date = '2026-08-11'),
  1,
  'none→some yields exactly one daily row'
);

select is(
  (select count(*)::int from public.itinerary_items
    where group_id = 'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and kind = 'accommodation'
      and stay_anchor = true
      and coalesce(day, 1) = 1),
  2,
  'none→some auto-add inserts exactly two stay_anchor cards'
);

-- Second call serializes as some→some: still one daily; no extra auto-add cards.
select lives_ok(
  $$select public.set_daily_accommodation_with_auto_add(
    'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    '2026-08-11'::date,
    'Stay B',
    'Addr2',
    25.2,
    121.2,
    null,
    1
  )$$,
  'active leader some→some succeeds under same lock path'
);

select is(
  (select count(*)::int from public.daily_accommodations
    where group_id = 'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and stay_date = '2026-08-11'),
  1,
  'concurrent/serial none→some converges to one daily row'
);

select is(
  (select count(*)::int from public.itinerary_items
    where group_id = 'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and kind = 'accommodation'
      and coalesce(day, 1) = 1),
  2,
  'second set does not double auto-add (still two accommodation cards)'
);

-- Atomic clear + anchor downgrade.
select lives_ok(
  $$select public.clear_daily_accommodation_with_downgrade(
    'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    '2026-08-11'::date,
    1
  )$$,
  'active leader clear+downgrade succeeds in one RPC'
);

select is(
  (select count(*)::int from public.daily_accommodations
    where group_id = 'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and stay_date = '2026-08-11'),
  0,
  'clear removes daily row'
);

select is(
  (select count(*)::int from public.itinerary_items
    where group_id = 'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and kind = 'accommodation'
      and stay_anchor = true
      and coalesce(day, 1) = 1),
  0,
  'clear downgrades stay_anchor (cards may remain, locks released)'
);

-- Rollback: failed set (missing group) leaves no partial daily for that id.
select throws_ok(
  $$select public.set_daily_accommodation_with_auto_add(
    'dfffffff-ffff-4fff-8fff-ffffffffffff'::uuid,
    '2026-08-12'::date,
    'Ghost',
    null,
    1.0,
    2.0,
    null,
    1
  )$$,
  null,
  null,
  'set against missing group fails without partial row'
);

select is(
  (select count(*)::int from public.daily_accommodations
    where stay_date = '2026-08-12'
      and title = 'Ghost'),
  0,
  'failed set leaves no daily row (transaction rollback)'
);

select * from finish();
rollback;
