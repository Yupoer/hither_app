-- A function returning a composite renders a not-found result as an all-null
-- object via PostgREST (not JSON null), which would slip past the client's
-- empty-check. Raise a distinct SQLSTATE (P0002 / no_data_found) instead so the
-- client can map it to a clean "group not found" and otherwise always receive a
-- real group row.
create or replace function public.join_group(p_code text)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups;
begin
  select * into g from public.groups where invite_code = upper(p_code) limit 1;
  if not found then
    raise exception 'group not found for code %', p_code using errcode = 'P0002';
  end if;
  insert into public.memberships (group_id, user_id, role, status)
  values (g.id, auth.uid(), 'follower', 'active')
  on conflict (group_id, user_id) do nothing;
  return g;
end;
$$;

revoke all on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;
