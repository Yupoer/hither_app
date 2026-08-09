-- pgTAP: reorder locked-snapshot + auth batch rules (#151 Sol r2).
-- Proves stale client absolute positions are ignored after a concurrent-style
-- Day-1 shift (same outcome two sessions share under groups FOR UPDATE).
-- Also: non-leader, mixed-scope, closed, duplicate rejection.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(13);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'leader-ser@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'follower-ser@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'submem-ser@example.test');

insert into public.groups (id, name, invite_code, created_by) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Serialize trip',
  'SER001',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.subgroups (id, group_id, name, mode) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Alpha',
  'led'
);

insert into public.memberships (group_id, user_id, role, subgroup_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'leader', null),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'follower', null),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'follower', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Seed Day-1 A@0 and Day-2 B@1, C@2 via add RPC (same lock contract).
select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'A', null, 1::float8, 1::float8, 1
  ) $$,
  'seed add A day1'
);

select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'B', null, 2::float8, 2::float8, 2
  ) $$,
  'seed add B day2'
);

select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'C', null, 3::float8, 3::float8, 2
  ) $$,
  'seed add C day2'
);

-- Capture Day-2 ids and their pre-shift positions (stale client plan).
-- Concurrent Day-1 insert: shift positions >=1, insert D@1 (simulates add under lock).
do $$
declare
  v_b uuid;
  v_c uuid;
begin
  select id into v_b from public.itinerary_items
  where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'B';
  select id into v_c from public.itinerary_items
  where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'C';

  -- Stash stale plan in a temp table for the next assertion.
  create temporary table stale_plan (
    id uuid primary key,
    stale_position integer not null,
    day integer not null
  ) on commit drop;

  insert into stale_plan (id, stale_position, day)
  select id, position, day from public.itinerary_items
  where id in (v_b, v_c);

  -- Concurrent Day-1 writer (after client snapshot, before reorder lock release):
  update public.itinerary_items
  set position = position + 1
  where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and position >= 1;

  insert into public.itinerary_items (
    id, group_id, title, day, latitude, longitude, position
  ) values (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'D',
    1,
    4, 4,
    1
  );
end $$;

-- After concurrent shift: A@0 D@1 B@2 C@3. Stale plan still has B@1 C@2.
-- Reorder reverse Day-2 with STALE absolute positions in payload.
select is(
  public.reorder_itinerary_items(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', sp.id,
          -- Deliberately wrong/stale absolute positions from pre-shift snapshot.
          'position', sp.stale_position,
          'day', sp.day
        )
        order by sp.stale_position desc  -- reverse: C then B in payload order
      )
      from stale_plan sp
    )
  ),
  2,
  'reorder under lock accepts ordered IDs even with stale client positions'
);

-- Locked-snapshot slots for {B,C} were [2,3]; payload order C,B → C@2 B@3.
-- D@1 must remain; no collision at stale position 1.
select is(
  (select array_agg(title order by position)
   from public.itinerary_items
   where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  array['A', 'D', 'C', 'B'],
  'stale client positions ignored; slots from locked snapshot; no Day-1 collision'
);

select is(
  (select array_agg(position order by position)
   from public.itinerary_items
   where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  array[0,1,2,3],
  'positions remain contiguous after stale-plan reorder'
);

-- Non-leader (group follower, not subgroup) cannot reorder group itinerary.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$ select public.reorder_itinerary_items(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (
      select jsonb_build_array(
        jsonb_build_object('id', id, 'position', 0, 'day', 1)
      )
      from public.itinerary_items
      where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'A'
    )
  ) $$,
  '42501',
  'permission denied',
  'non-leader rejected for group-level rows'
);

-- Mixed-scope: subgroup member cannot include group-level id in batch.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);

-- Seed one subgroup stop as leader first.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'SubS',
    null, 5::float8, 5::float8, 1
  ) $$,
  'seed subgroup stop'
);

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select throws_ok(
  $$ select public.reorder_itinerary_items(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (
      select jsonb_agg(
        jsonb_build_object('id', id, 'position', 0, 'day', 1)
        order by title
      )
      from public.itinerary_items
      where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        and title in ('A', 'SubS')
    )
  ) $$,
  '42501',
  'permission denied',
  'mixed-scope batch rejected for non-leader'
);

-- Duplicate IDs rejected.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$ select public.reorder_itinerary_items(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (
      select jsonb_build_array(
        jsonb_build_object('id', id, 'position', 0, 'day', 1),
        jsonb_build_object('id', id, 'position', 1, 'day', 1)
      )
      from public.itinerary_items
      where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'A'
    )
  ) $$,
  '22023',
  'duplicate reorder id',
  'duplicate ids rejected'
);

-- Closed rows rejected.
update public.itinerary_items
set closed_at = now()
where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'A';

select throws_ok(
  $$ select public.reorder_itinerary_items(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (
      select jsonb_build_array(
        jsonb_build_object('id', id, 'position', 0, 'day', 1)
      )
      from public.itinerary_items
      where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and title = 'A'
    )
  ) $$,
  '22023',
  'cannot reorder closed itinerary items',
  'closed item rejected'
);

-- Missing / out-of-scope id rejected.
select throws_ok(
  $$ select public.reorder_itinerary_items(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '[{"id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","position":0,"day":1}]'::jsonb
  ) $$,
  '22023',
  'reorder ids missing or out of scope',
  'unknown id rejected'
);

-- Leader full reverse of open non-closed rows still works.
select is(
  public.reorder_itinerary_items(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (
      select jsonb_agg(
        jsonb_build_object('id', id, 'position', 99, 'day', coalesce(day, 1))
        order by position desc
      )
      from public.itinerary_items
      where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        and closed_at is null
    )
  ),
  4,
  'leader reorder of all open rows returns full count'
);

select * from finish();
rollback;
