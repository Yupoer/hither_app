begin;

create or replace function public.generate_group_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_entropy bytea := extensions.gen_random_bytes(6);
  v_code text := '';
begin
  for i in 0..5 loop
    v_code := v_code || substr(
      v_alphabet,
      1 + (get_byte(v_entropy, i) % length(v_alphabet)),
      1
    );
  end loop;
  return v_code;
end;
$$;

revoke all on function public.generate_group_invite_code() from public, anon, authenticated;

do $$
declare
  v_group_id uuid;
  v_attempt integer;
  v_rotated boolean;
begin
  for v_group_id in
    select id from public.groups order by id for update
  loop
    v_rotated := false;
    for v_attempt in 1..8 loop
      begin
        update public.groups
        set invite_code = public.generate_group_invite_code()
        where id = v_group_id;
        v_rotated := true;
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
    if not v_rotated then
      raise exception 'invite code rotation collision' using errcode = '23505';
    end if;
  end loop;
end;
$$;

create or replace function public.join_group(p_code text)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups;
  v_uid uuid := (select auth.uid());
  v_code text := upper(trim(p_code));
  v_count integer;
  v_leader_id uuid;
  v_expires_at timestamptz;
  v_first_joined timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if public.is_auth_user_anonymous(v_uid) then
    select p.anonymous_expires_at into v_expires_at
    from public.profiles p
    where p.id = v_uid;

    if v_expires_at is null then
      select min(m.created_at) into v_first_joined
      from public.memberships m
      where m.user_id = v_uid;
      if v_first_joined is not null then
        v_expires_at := v_first_joined + interval '14 days';
      end if;
    end if;

    if v_expires_at is not null and v_expires_at <= now() then
      raise exception 'anonymous access expired'
        using errcode = 'P0401';
    end if;
  end if;

  if v_code is null
     or v_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$' then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;

  select * into g
  from public.groups
  where invite_code = v_code
  limit 1
  for update;
  if not found then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.memberships
    where group_id = g.id and user_id = v_uid
  ) then
    return g;
  end if;

  select count(*)::integer into v_count
  from public.memberships
  where group_id = g.id;

  if v_count >= 5 then
    select m.user_id into v_leader_id
    from public.memberships m
    where m.group_id = g.id and m.role = 'leader'
    limit 1;

    if v_leader_id is null then
      v_leader_id := g.created_by;
    end if;

    if public.is_auth_user_anonymous(v_leader_id) then
      raise exception 'leader registration required before adding member 6'
        using errcode = 'P0406';
    end if;

    raise exception 'member_limit'
      using errcode = 'P0003',
            detail = 'Free plan allows at most 5 members including the leader';
  end if;

  insert into public.memberships (group_id, user_id, role, status)
  values (g.id, v_uid, 'follower', 'active')
  on conflict (group_id, user_id) do nothing;

  perform public.ensure_anonymous_expiry(v_uid);
  return g;
end;
$$;

revoke all on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;

commit;
