-- Remove an anonymous account and its user-owned data at explicit logout.
-- This is intentionally a server-side operation because the client cannot
-- delete rows from auth.users.
create or replace function public.delete_anonymous_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_is_anonymous := coalesce(
    (current_setting('request.jwt.claims', true)::json ->> 'is_anonymous')::boolean,
    false
  );
  if not v_is_anonymous then
    raise exception 'Only anonymous accounts can be deleted by logout';
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

  update public.groups set created_by = null where created_by = v_uid;
  update public.subgroups set leader_id = null where leader_id = v_uid;
  update public.itinerary_items set created_by = null where created_by = v_uid;

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_anonymous_account() from public;
grant execute on function public.delete_anonymous_account() to authenticated;
