-- Run on a local/isolated database; all fixtures roll back.
begin;
do $$
declare
  leader uuid := gen_random_uuid();
  follower uuid := gen_random_uuid();
  occupied_group uuid;
  empty_group uuid;
begin
  insert into auth.users(id, email, is_anonymous) values
    (leader, leader::text || '@team-cleanup.example.test', false),
    (follower, follower::text || '@team-cleanup.example.test', false);
  insert into public.profiles(id, nickname) values (leader, 'Cleanup leader'), (follower, 'Cleanup follower')
    on conflict (id) do nothing;
  perform set_config('request.jwt.claim.sub', leader::text, true);
  insert into public.groups(name, invite_code, created_by)
    values ('cleanup occupied fixture', substr(gen_random_uuid()::text, 1, 6), leader) returning id into occupied_group;
  insert into public.groups(name, invite_code, created_by)
    values ('cleanup empty fixture', substr(gen_random_uuid()::text, 1, 6), leader) returning id into empty_group;
  insert into public.memberships(group_id, user_id, role) values
    (occupied_group, leader, 'leader'), (occupied_group, follower, 'follower'), (empty_group, leader, 'leader');
  insert into public.member_locations(group_id, user_id, latitude, longitude) values
    (occupied_group, leader, 25, 121), (occupied_group, follower, 26, 122), (empty_group, leader, 25, 121);
  insert into public.itinerary_items(group_id, title, position, day) values
    (occupied_group, 'Keep this stop', 0, 1), (empty_group, 'Delete this stop', 0, 1);

  -- Exercise the authenticated client's bulk clear-all, including RLS.
  execute 'set local role authenticated';
  delete from public.memberships where user_id = leader and group_id in (occupied_group, empty_group);
  -- A caller cannot clear another user's membership.
  delete from public.memberships where user_id = follower and group_id = occupied_group;
  execute 'reset role';

  if exists (select 1 from public.memberships where user_id = leader and group_id in (occupied_group, empty_group)) then
    raise exception 'clear-all retained memberships';
  end if;
  if exists (select 1 from public.member_locations where user_id = leader and group_id in (occupied_group, empty_group)) then
    raise exception 'departed member location survived';
  end if;
  if exists (select 1 from public.groups where id = empty_group)
    or exists (select 1 from public.itinerary_items where group_id = empty_group) then
    raise exception 'last-member group or itinerary survived';
  end if;
  if not exists (select 1 from public.groups where id = occupied_group)
    or not exists (select 1 from public.memberships where group_id = occupied_group and user_id = follower)
    or not exists (select 1 from public.member_locations where group_id = occupied_group and user_id = follower)
    or not exists (select 1 from public.itinerary_items where group_id = occupied_group) then
    raise exception 'cleanup damaged another member or occupied group';
  end if;
end;
$$;
select 'PASS: authenticated clear-all, last-member cascade, departed location and other-user isolation' as result;
rollback;
