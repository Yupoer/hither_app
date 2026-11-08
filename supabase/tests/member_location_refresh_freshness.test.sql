begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, auth;
select plan(1);

create temporary table member_refresh_pushes(payload jsonb);
create or replace function extensions.notify_push(payload jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into pg_temp.member_refresh_pushes values (payload);
$$;

do $$
declare
  g uuid := 'faaa1000-0000-4000-8000-000000000001';
  requester uuid := 'faaa1000-0000-4000-8000-000000000002';
  recent_peer uuid := 'faaa1000-0000-4000-8000-000000000003';
  stale_peer uuid := 'faaa1000-0000-4000-8000-000000000004';
  missing_peer uuid := 'faaa1000-0000-4000-8000-000000000005';
  private_peer uuid := 'faaa1000-0000-4000-8000-000000000006';
  request jsonb;
  expected uuid[] := array[stale_peer, missing_peer];
begin
  insert into auth.users(id, email, is_anonymous)
    select id, id::text || '@example.test', false
    from unnest(array[requester, recent_peer, stale_peer, missing_peer, private_peer]) as users(id);
  insert into public.groups(id, name, invite_code, created_by)
    values (g, 'Refresh sample ages', 'AGE180', requester);
  insert into public.memberships(group_id, user_id, role, status)
    values (g, requester, 'leader', 'active'), (g, recent_peer, 'follower', 'active'),
      (g, stale_peer, 'follower', 'active'), (g, missing_peer, 'follower', 'active'),
      (g, private_peer, 'follower', 'active');
  insert into public.member_privacy_settings(user_id, sharing_enabled) values (private_peer, false);
  insert into public.member_locations(group_id, user_id, latitude, longitude, captured_at, updated_at) values
    (g, recent_peer, 25, 121, now() - interval '179 seconds', now()),
    (g, stale_peer, 25, 121, now() - interval '180 seconds', now());

  perform set_config('request.jwt.claim.sub', requester::text, true);
  set local role authenticated;
  request := public.request_group_location_refresh(g);
  reset role;

  assert request->>'accepted' = 'true' and request->'recipient_ids' = to_jsonb(expected),
    'eligible stale and missing peers alone are requested, based on capture time';
  assert (select array_agg(user_id order by user_id) from public.location_refresh_pending where group_id = g) = expected,
    'durable pending rows match the returned recipient set';
  assert (select payload->'recipient_ids' from pg_temp.member_refresh_pushes where payload->>'category' = 'location_refresh') = to_jsonb(expected),
    'the push payload contains the same stale and missing peers';

  update public.location_refresh_requests set requested_at = now() - interval '61 seconds' where group_id = g;
  update public.location_refresh_pending set requested_at = now() - interval '61 seconds' where group_id = g;
  update public.member_locations set captured_at = now() where group_id = g and user_id = stale_peer;
  insert into public.member_locations(group_id, user_id, latitude, longitude, captured_at)
    values (g, missing_peer, 25, 121, now());
  truncate pg_temp.member_refresh_pushes;

  set local role authenticated;
  request := public.request_group_location_refresh(g);
  reset role;

  assert request->>'accepted' = 'true' and request->'recipient_ids' = '[]'::jsonb,
    'when all available peers are fresh there are no new recipients';
  assert not exists(select 1 from pg_temp.member_refresh_pushes where payload->>'category' = 'location_refresh'),
    'when all available peers are fresh there is no push';
  assert not exists(select 1 from public.location_refresh_pending where group_id = g
    and requested_at = (request->>'requested_at')::timestamptz),
    'fresh peers do not receive ledger work';
end;
$$;
select pass('manual refresh only wakes eligible peers without a fresh fix');
select * from finish();
rollback;
