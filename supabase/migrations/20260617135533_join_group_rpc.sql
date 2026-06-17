-- Joining by invite code can't be a plain client SELECT: groups are hidden from
-- non-members by RLS, and broadening that SELECT would leak the whole group list
-- (names + codes) to any authenticated user. Instead resolve the code and create
-- the follower membership atomically in a SECURITY DEFINER function that bypasses
-- RLS only for this controlled operation. Idempotent on (group_id, user_id).
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
    return null;
  end if;
  insert into public.memberships (group_id, user_id, role, status)
  values (g.id, auth.uid(), 'follower', 'active')
  on conflict (group_id, user_id) do nothing;
  return g;
end;
$$;

revoke all on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;
