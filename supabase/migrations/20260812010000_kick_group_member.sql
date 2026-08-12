-- Leader-only atomic kick: delete follower membership + rotate invite code.
-- Returns the new 6-char invite code so the leader UI can refresh without a second fetch race.
create or replace function public.kick_group_member(p_group_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_target_role text;
  v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_attempt int;
  i int;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_group_id is null or p_user_id is null then
    raise exception 'group and user required' using errcode = '22023';
  end if;
  if p_user_id = v_caller then
    raise exception 'cannot kick self' using errcode = '22023';
  end if;

  -- Expiry-aware membership first (anonymous 14-day gate via is_member).
  if not extensions.is_member(p_group_id) then
    raise exception 'not a group member' using errcode = '42501';
  end if;

  -- Caller must be active leader of this group.
  if not exists (
    select 1
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_caller
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  select m.role into v_target_role
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = p_user_id
  for update;

  if not found then
    raise exception 'target membership not found' using errcode = 'P0002';
  end if;
  if v_target_role = 'leader' then
    raise exception 'cannot kick leader' using errcode = '22023';
  end if;

  delete from public.memberships
  where group_id = p_group_id
    and user_id = p_user_id;

  for v_attempt in 1..8 loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(
        v_chars,
        1 + floor(random() * length(v_chars))::int,
        1
      );
    end loop;

    begin
      update public.groups
      set invite_code = v_code
      where id = p_group_id;
      return v_code;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  raise exception 'kick failed: invite code collision' using errcode = '23505';
end;
$$;

revoke all on function public.kick_group_member(uuid, uuid) from public, anon;
grant execute on function public.kick_group_member(uuid, uuid) to authenticated;
