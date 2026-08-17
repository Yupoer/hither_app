-- Any authenticated caller may permanently delete their own account (Apple 5.1.1(v)).
-- Historical name delete_anonymous_account is kept so existing anonymous logout
-- and the client RPC contract stay on one function. Do not add a second RPC.

create or replace function public.delete_anonymous_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Clear non-cascading foreign keys before removing auth.users.
  delete from public.subgroup_invites where inviter_id = v_uid or invitee_id = v_uid;
  delete from public.commands where sender_id = v_uid;
  delete from public.member_locations where user_id = v_uid;
  delete from public.memberships where user_id = v_uid;
  delete from public.activity_logs where user_id = v_uid;
  delete from public.feedback_reports where user_id = v_uid;
  delete from public.visited_waypoints where user_id = v_uid;
  delete from public.push_tokens where user_id = v_uid;
  delete from public.notification_preferences where user_id = v_uid;
  -- started_by is ON DELETE RESTRICT; member states cascade from the session row.
  delete from public.navigation_sessions where started_by = v_uid;

  update public.groups set created_by = null where created_by = v_uid;
  update public.subgroups set leader_id = null where leader_id = v_uid;
  update public.itinerary_items set created_by = null where created_by = v_uid;
  update public.daily_accommodations set created_by = null where created_by = v_uid;

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_anonymous_account() from public;
grant execute on function public.delete_anonymous_account() to authenticated;

-- Keep scheduled anon expiry cleanup aligned so the same extra FKs cannot block it.
-- This function stays anonymous-only.
create or replace function public.cleanup_expired_anonymous_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
  v_still_anonymous boolean;
begin
  for r in
    select distinct u.id as uid
    from auth.users u
    join public.profiles p on p.id = u.id
    left join lateral (
      select min(m.created_at) as first_joined
      from public.memberships m
      where m.user_id = u.id
    ) mj on true
    where coalesce(u.is_anonymous, false) = true
      and (
        (p.anonymous_expires_at is not null and p.anonymous_expires_at <= now())
        or (
          p.anonymous_expires_at is null
          and mj.first_joined is not null
          and mj.first_joined + interval '14 days' <= now()
        )
      )
  loop
    begin
      select coalesce(u.is_anonymous, false) into v_still_anonymous
      from auth.users u
      where u.id = r.uid;

      if not coalesce(v_still_anonymous, false) then
        perform public.allow_anonymous_expiry_write();
        update public.profiles
        set anonymous_expires_at = null
        where id = r.uid;
        continue;
      end if;

      delete from public.subgroup_invites where inviter_id = r.uid or invitee_id = r.uid;
      delete from public.commands where sender_id = r.uid;
      delete from public.member_locations where user_id = r.uid;
      delete from public.memberships where user_id = r.uid;
      delete from public.activity_logs where user_id = r.uid;
      delete from public.feedback_reports where user_id = r.uid;
      delete from public.visited_waypoints where user_id = r.uid;
      delete from public.push_tokens where user_id = r.uid;
      delete from public.notification_preferences where user_id = r.uid;
      delete from public.navigation_sessions where started_by = r.uid;

      update public.groups set created_by = null where created_by = r.uid;
      update public.subgroups set leader_id = null where leader_id = r.uid;
      update public.itinerary_items set created_by = null where created_by = r.uid;
      update public.daily_accommodations set created_by = null where created_by = r.uid;

      delete from auth.users
      where id = r.uid
        and coalesce(is_anonymous, false) = true;

      if found then
        n := n + 1;
      end if;
    exception
      when others then
        raise notice 'cleanup_expired_anonymous_accounts skipped %: %', r.uid, sqlerrm;
    end;
  end loop;

  return n;
end;
$$;

revoke all on function public.cleanup_expired_anonymous_accounts() from public, anon, authenticated;
grant execute on function public.cleanup_expired_anonymous_accounts() to service_role;
