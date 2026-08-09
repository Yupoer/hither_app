-- REVIEW_FIX #158 r4: executable daily-accommodation security + concurrency tests.
-- Trigger DDL runs as test-admin (reset role); authenticated only for JWT RPC calls.
-- pgTAP-oriented. Requires full schema (is_member, memberships, groups, etc.).
-- Single-session tests run inside a transaction (set local role/jwt).
-- Concurrent dblink race runs after COMMIT so peer sessions see fixtures.

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink;

set search_path = extensions, public, auth;
select plan(28);

-- ============================================================
-- Single-session block (transactional auth + fixtures)
-- ============================================================
begin;

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
  'extensions',
  'set_accommodation_auto_add',
  array['uuid','boolean']
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
select has_function(
  'public',
  'set_accommodation_auto_add',
  array['uuid','boolean']
);

-- Fixtures: profiles.nickname (schema requires nickname, not display_name).
insert into auth.users (id, email, is_anonymous) values
  ('d1111111-1111-4111-8111-111111111111', 'daily-leader@example.test', false),
  ('d2222222-2222-4222-8222-222222222222', 'daily-anon-leader@example.test', true),
  ('d3333333-3333-4333-8333-333333333333', 'daily-leader-b@example.test', false);

insert into public.profiles (id, nickname, anonymous_expires_at) values
  ('d1111111-1111-4111-8111-111111111111', 'DailyLeader', null),
  (
    'd2222222-2222-4222-8222-222222222222',
    'DailyAnonLeader',
    now() - interval '1 hour'
  ),
  ('d3333333-3333-4333-8333-333333333333', 'DailyLeaderB', null);

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
),
(
  'dgcccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Concurrent race trip',
  'DAY003',
  'd1111111-1111-4111-8111-111111111111',
  true
),
(
  'dgdddddd-dddd-4ddd-8ddd-dddddddddddd',
  'Rollback trip',
  'DAY004',
  'd1111111-1111-4111-8111-111111111111',
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
  ),
  (
    'dgcccccc-cccc-4ccc-8ccc-cccccccccccc',
    'd1111111-1111-4111-8111-111111111111',
    'leader',
    now() - interval '2 days'
  ),
  (
    'dgcccccc-cccc-4ccc-8ccc-cccccccccccc',
    'd3333333-3333-4333-8333-333333333333',
    'leader',
    now() - interval '2 days'
  ),
  (
    'dgdddddd-dddd-4ddd-8ddd-dddddddddddd',
    'd1111111-1111-4111-8111-111111111111',
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

select throws_ok(
  $$select public.set_accommodation_auto_add(
    'dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
    false
  )$$,
  null,
  null,
  'expired anonymous leader cannot set_accommodation_auto_add'
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
  $$select public.set_accommodation_auto_add(
    'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    true
  )$$,
  'active leader can set_accommodation_auto_add'
);

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
  'serial some→some converges to one daily row'
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

-- ============================================================
-- Deterministic second-insert failure → full transaction rollback.
-- Trigger fails only the 2nd stay_anchor accommodation insert so the
-- daily upsert + first card cannot stick after the RPC aborts.
--
-- CRITICAL: authenticated has DML only (no TRIGGER / ownership on
-- itinerary_items). Install and remove the helper under test-admin
-- (reset role), then switch to authenticated only for the RPC call.
-- ============================================================
reset role;

create or replace function public._test_fail_second_stay_anchor()
returns trigger
language plpgsql
as $$
declare
  n int;
begin
  if TG_OP = 'INSERT'
     and NEW.kind = 'accommodation'
     and NEW.stay_anchor = true
     and NEW.group_id = 'dgdddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
  then
    select count(*)::int into n
    from public.itinerary_items i
    where i.group_id = NEW.group_id
      and i.kind = 'accommodation'
      and i.stay_anchor = true
      and coalesce(i.day, 1) = coalesce(NEW.day, 1);
    if n >= 1 then
      raise exception 'test_second_card_fail'
        using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_test_fail_second_stay_anchor on public.itinerary_items;
create trigger trg_test_fail_second_stay_anchor
  before insert on public.itinerary_items
  for each row execute function public._test_fail_second_stay_anchor();

-- RPC under authenticated JWT (active leader); trigger runs in same txn.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$select public.set_daily_accommodation_with_auto_add(
    'dgdddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
    '2026-08-12'::date,
    'RollbackStay',
    null,
    25.3,
    121.3,
    null,
    1
  )$$,
  'P0001',
  'test_second_card_fail',
  'second stay_anchor card failure aborts set RPC'
);

-- Counts as admin so RLS cannot mask residual rows if any.
reset role;

select is(
  (select count(*)::int from public.daily_accommodations
    where group_id = 'dgdddddd-dddd-4ddd-8ddd-dddddddddddd'
      and stay_date = '2026-08-12'),
  0,
  'failed second card rolls back daily upsert (no partial daily row)'
);

select is(
  (select count(*)::int from public.itinerary_items
    where group_id = 'dgdddddd-dddd-4ddd-8ddd-dddddddddddd'
      and kind = 'accommodation'),
  0,
  'failed second card rolls back first card insert (no partial cards)'
);

drop trigger if exists trg_test_fail_second_stay_anchor on public.itinerary_items;
drop function if exists public._test_fail_second_stay_anchor();

-- Commit fixtures + single-session results so dblink peers can see them.
-- (Race group dgcccccc has no daily row yet; leaders remain.)
-- Role is already test-admin after reset above; commit ends local role state.
commit;

-- ============================================================
-- Real concurrent none→some race via two dblink sessions.
-- Both leaders race the same group/date; FOR UPDATE + upsert
-- must converge to one daily row and exactly two auto-add cards.
-- ============================================================
select lives_ok(
  $$
  do $race$
  declare
    v_conninfo text;
    v_r1 text;
    v_r2 text;
  begin
    v_conninfo := format(
      'dbname=%s user=%s',
      current_database(),
      current_user
    );

    perform dblink_connect('daily_race_a', v_conninfo);
    perform dblink_connect('daily_race_b', v_conninfo);

    perform dblink_exec('daily_race_a', $s$
      select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role authenticated;
    $s$);
    perform dblink_exec('daily_race_b', $s$
      select set_config('request.jwt.claim.sub', 'd3333333-3333-4333-8333-333333333333', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
      set role authenticated;
    $s$);

    -- Fire both none→some calls without waiting (true concurrent backends).
    perform dblink_send_query('daily_race_a', $q$
      select public.set_daily_accommodation_with_auto_add(
        'dgcccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
        '2026-08-13'::date,
        'RaceStayA',
        'AddrA',
        25.4,
        121.4,
        null,
        1
      )::text;
    $q$);
    perform dblink_send_query('daily_race_b', $q$
      select public.set_daily_accommodation_with_auto_add(
        'dgcccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
        '2026-08-13'::date,
        'RaceStayB',
        'AddrB',
        25.5,
        121.5,
        null,
        1
      )::text;
    $q$);

    select res into v_r1 from dblink_get_result('daily_race_a') as t(res text);
    select res into v_r2 from dblink_get_result('daily_race_b') as t(res text);

    -- Drain remaining result sets (dblink requires full drain).
    perform * from dblink_get_result('daily_race_a') as t(res text);
    perform * from dblink_get_result('daily_race_b') as t(res text);

    begin
      perform dblink_disconnect('daily_race_a');
    exception when others then null;
    end;
    begin
      perform dblink_disconnect('daily_race_b');
    exception when others then null;
    end;

    if (v_r1 is null or v_r1 = '') and (v_r2 is null or v_r2 = '') then
      raise exception 'both concurrent set_daily calls failed: a=% b=%', v_r1, v_r2;
    end if;
  end
  $race$;
  $$,
  'two concurrent sessions race none→some without fatal error'
);

select is(
  (select count(*)::int from public.daily_accommodations
    where group_id = 'dgcccccc-cccc-4ccc-8ccc-cccccccccccc'
      and stay_date = '2026-08-13'),
  1,
  'concurrent none→some converges to exactly one daily row'
);

select is(
  (select count(*)::int from public.itinerary_items
    where group_id = 'dgcccccc-cccc-4ccc-8ccc-cccccccccccc'
      and kind = 'accommodation'
      and stay_anchor = true
      and coalesce(day, 1) = 1),
  2,
  'concurrent none→some auto-adds exactly two stay_anchor cards (no double)'
);

-- Cleanup committed fixtures (no outer rollback after concurrent section).
delete from public.itinerary_items
where group_id in (
  'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'dgcccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dgdddddd-dddd-4ddd-8ddd-dddddddddddd'
);
delete from public.daily_accommodations
where group_id in (
  'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'dgcccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dgdddddd-dddd-4ddd-8ddd-dddddddddddd'
);
delete from public.memberships
where group_id in (
  'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'dgcccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dgdddddd-dddd-4ddd-8ddd-dddddddddddd'
);
delete from public.groups
where id in (
  'dgaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'dgbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'dgcccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dgdddddd-dddd-4ddd-8ddd-dddddddddddd'
);
delete from public.profiles
where id in (
  'd1111111-1111-4111-8111-111111111111',
  'd2222222-2222-4222-8222-222222222222',
  'd3333333-3333-4333-8333-333333333333'
);
delete from auth.users
where id in (
  'd1111111-1111-4111-8111-111111111111',
  'd2222222-2222-4222-8222-222222222222',
  'd3333333-3333-4333-8333-333333333333'
);

select * from finish();
