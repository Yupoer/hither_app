-- group_member_count was granted to authenticated and returned the count for
-- any group id. Require the caller to be a member. Every internal caller
-- (get_trip_entitlement, redeem_promo_code, rewarded-ad grants) checks
-- membership or leadership first, and service_role / maintenance calls carry
-- no auth.uid(), so they keep working.

create or replace function public.group_member_count(p_group_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is not null and not exists (
    select 1 from public.memberships m
     where m.group_id = p_group_id and m.user_id = v_uid
  ) then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  return (
    select count(*)::integer
      from public.memberships m
     where m.group_id = p_group_id
  );
end;
$$;

revoke all on function public.group_member_count(uuid) from public, anon;
grant execute on function public.group_member_count(uuid) to authenticated, service_role;
