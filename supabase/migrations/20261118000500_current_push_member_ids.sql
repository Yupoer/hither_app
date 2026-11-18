create function public.current_push_member_ids(p_group_id uuid, p_user_ids uuid[])
returns table (user_id uuid)
language sql
stable
set search_path = ''
as $$
  select m.user_id
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = any(p_user_ids)
    and public.anonymous_access_is_active(m.user_id);
$$;

revoke all on function public.current_push_member_ids(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.current_push_member_ids(uuid, uuid[]) to service_role;
