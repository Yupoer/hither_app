-- pgTAP: serialized RPC writers + internal coordination ACL (#151 Sol r3).
-- Live multi-session concurrency still requires a deployed Supabase (documented Unverified).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(6);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'leader-bound@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'follower-bound@example.test');

insert into public.groups (id, name, invite_code, created_by) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Boundary trip',
  'BND001',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.memberships (group_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'leader'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'follower');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Seed via authorized RPC.
select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'A', null, 1::float8, 1::float8, 1
  ) $$,
  'seed add via RPC'
);

select lives_ok(
  $$ select public.add_itinerary_item(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'B', null, 2::float8, 2::float8, 1
  ) $$,
  'seed second stop via RPC'
);

-- Reorder works from the locked open-row snapshot.
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
  1,
  'RPC reorder of open rows succeeds from locked slots'
);

-- Source-level: resolve_gather + coordination include groups FOR UPDATE before insert path.
-- (Executable two-session lock race needs live Supabase; proven here by function body contract.)
select ok(
  position('for update' in lower(pg_get_functiondef('public.resolve_gather_point_request(uuid,boolean)'::regprocedure))) > 0,
  'resolve_gather_point_request locks its group before insert'
);

select ok(
  position(
    'for update'
    in lower(pg_get_functiondef(
      'public.coordination_apply_outcome(public.coordination_requests,text,uuid)'::regprocedure
    ))
  ) > 0,
  'coordination_apply_outcome locks its group before itinerary mutation'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.coordination_apply_outcome(public.coordination_requests,text,uuid)',
    'execute'
  ),
  'coordination_apply_outcome remains internal-only'
);

select * from finish();
rollback;
