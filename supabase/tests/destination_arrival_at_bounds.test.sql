-- pgTAP: set_destination_arrival_at bounds the client-supplied arrival time.
-- The bound check runs before any destination lookup, so an unknown
-- destination id shows which gate a call reached: 22023 is the time bound,
-- P0002 ("destination not found") means the time passed the bound.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(6);

insert into auth.users (id, email) values
  ('f1111111-1111-4111-8111-111111111111', 'arrival-bounds@example.test');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f1111111-1111-4111-8111-111111111111', true);

select throws_ok(
  $$select public.set_destination_arrival_at(
    'f0000000-0000-4000-8000-000000000001', auth.uid(), true, now() + interval '1 hour')$$,
  '22023',
  'arrived_at is in the future',
  'an arrival far in the future is rejected'
);
select throws_ok(
  $$select public.set_destination_arrival_at(
    'f0000000-0000-4000-8000-000000000001', auth.uid(), true, now() - interval '31 days')$$,
  '22023',
  'arrived_at is too old',
  'an arrival older than 30 days is rejected'
);
select throws_ok(
  $$select public.set_destination_arrival_at(
    'f0000000-0000-4000-8000-000000000001', auth.uid(), true, now() + interval '2 minutes')$$,
  'P0002',
  null,
  'small device clock skew passes the bound'
);
select throws_ok(
  $$select public.set_destination_arrival_at(
    'f0000000-0000-4000-8000-000000000001', auth.uid(), true, now() - interval '3 days')$$,
  'P0002',
  null,
  'a delayed offline arrival passes the bound'
);
select throws_ok(
  $$select public.set_destination_arrival_at(
    'f0000000-0000-4000-8000-000000000001', auth.uid(), true, null)$$,
  'P0002',
  null,
  'null still means server-side now()'
);
select throws_ok(
  $$select public.set_destination_arrival_at(
    'f0000000-0000-4000-8000-000000000001', auth.uid(), false, now() + interval '1 year')$$,
  'P0002',
  null,
  'undo ignores the timestamp'
);

select * from finish();
rollback;
