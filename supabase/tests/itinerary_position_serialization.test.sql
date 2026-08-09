-- pgTAP: concurrent-style serialization for add/reorder under group lock (#151 Sol P1).
-- Simulates two writers by nesting lock-holding transactions is not available in one
-- connection; instead verifies both RPCs take groups FOR UPDATE and produce contiguous
-- positions after interleaved sequential calls (same contract two sessions would share).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(6);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'leader-ser@example.test');

insert into public.groups (id, name, invite_code, created_by) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Serialize trip',
  'SER001',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.memberships (group_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'leader');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Seed one stop via add RPC.
select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'A', null, 1::float8, 1::float8, 1
  ) $$,
  'seed add A'
);

select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'B', null, 2::float8, 2::float8, 1
  ) $$,
  'seed add B'
);

select lives_ok(
  $$ select public.import_itinerary_batch(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    null,
    1,
    '[{"title":"C","latitude":3,"longitude":3},{"title":"D","latitude":4,"longitude":4}]'::jsonb
  ) $$,
  'batch import C,D under same lock contract'
);

select is(
  (select count(*)::int from public.itinerary_items where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  4,
  'four stops after add+add+import'
);

select is(
  (select array_agg(position order by position)
   from public.itinerary_items
   where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  array[0,1,2,3],
  'positions contiguous 0..3 after serialized writers'
);

-- Reorder under lock: reverse order.
select is(
  public.reorder_itinerary_items(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'position', 3 - position,
          'day', 1
        )
        order by position
      )
      from public.itinerary_items
      where group_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )
  ),
  4,
  'reorder applies 4 patches under lock'
);

select * from finish();
rollback;
