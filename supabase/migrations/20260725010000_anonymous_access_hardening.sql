-- OTA-05 hardening (runs AFTER same-day paid_entitlement / anonymous_access migrations).
--
-- 1. Final join_group: P0401 expiry → P0406 anonymous Leader gate → Free Plan P0003 → insert + stamp.
-- 2. Lock profiles.anonymous_expires_at against direct client INSERT/UPDATE (SECURITY DEFINER helpers only).
-- 3. Cleanup selects expired anonymous users even when the profile column was null (membership fallback).
-- 4. Atomic create_group + delete_orphan_group (no leader-less orphans under RLS).

-- ============================================================
-- Protect anonymous_expires_at (authoritative; not client-writable)
-- ============================================================

create or replace function public.allow_anonymous_expiry_write()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.anonymous_expiry_write', 'allowed', true);
end;
$$;

revoke all on function public.allow_anonymous_expiry_write() from public, anon, authenticated;
grant execute on function public.allow_anonymous_expiry_write() to service_role;

create or replace function public.prevent_client_anonymous_expires_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INSERT: strip any client-supplied expiry unless a DEFINER helper set the GUC.
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.anonymous_expiry_write', true), '') <> 'allowed' then
      new.anonymous_expires_at := null;
    end if;
    return new;
  end if;

  -- UPDATE: silent revert of client mutations.
  if tg_op = 'UPDATE'
     and new.anonymous_expires_at is distinct from old.anonymous_expires_at
     and coalesce(current_setting('app.anonymous_expiry_write', true), '') <> 'allowed'
  then
    new.anonymous_expires_at := old.anonymous_expires_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_client_anonymous_expires on public.profiles;
create trigger trg_prevent_client_anonymous_expires
  before insert or update on public.profiles
  for each row
  execute function public.prevent_client_anonymous_expires_mutation();

-- Re-define stamp / clear helpers so they set the GUC before writing.
create or replace function public.ensure_anonymous_expiry(p_uid uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_uid is null then
    return null;
  end if;
  if not public.is_auth_user_anonymous(p_uid) then
    return null;
  end if;

  perform public.allow_anonymous_expiry_write();

  update public.profiles
  set anonymous_expires_at = coalesce(anonymous_expires_at, now() + interval '14 days')
  where id = p_uid
  returning anonymous_expires_at into v_expires;

  return v_expires;
end;
$$;

revoke all on function public.ensure_anonymous_expiry(uuid) from public, anon;
grant execute on function public.ensure_anonymous_expiry(uuid) to authenticated, service_role;

create or replace function public.clear_anonymous_expiry_if_registered(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_uid is null then
    return;
  end if;
  -- Only clear when the identity is no longer anonymous.
  if public.is_auth_user_anonymous(p_uid) then
    return;
  end if;

  perform public.allow_anonymous_expiry_write();

  update public.profiles
  set anonymous_expires_at = null
  where id = p_uid
    and anonymous_expires_at is not null;
end;
$$;

revoke all on function public.clear_anonymous_expiry_if_registered(uuid) from public, anon;
grant execute on function public.clear_anonymous_expiry_if_registered(uuid) to authenticated, service_role;

-- ============================================================
-- Final join_group (authoritative after OTA-05 + OTA-08)
-- Order: expired anon → anonymous Leader 6th → Free Plan 6th → insert + stamp
-- ============================================================

create or replace function public.join_group(p_code text)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups;
  v_uid uuid := (select auth.uid());
  v_count integer;
  v_leader_id uuid;
  v_expires_at timestamptz;
  v_first_joined timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- (1) Anonymous expiry (profile column, with membership.created_at fallback).
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

  select * into g from public.groups where invite_code = upper(p_code) limit 1;
  if not found then
    raise exception 'group not found for code %', p_code using errcode = 'P0002';
  end if;

  if exists(
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

    -- (2) OTA-05: anonymous Leader must register before the 6th member.
    if public.is_auth_user_anonymous(v_leader_id) then
      raise exception 'leader registration required before adding member 6'
        using errcode = 'P0406';
    end if;

    -- (3) OTA-08 Free Plan hard cap for registered Leaders.
    raise exception 'member_limit'
      using errcode = 'P0003',
            detail = 'Free plan allows at most 5 members including the leader';
  end if;

  insert into public.memberships (group_id, user_id, role, status)
  values (g.id, v_uid, 'follower', 'active')
  on conflict (group_id, user_id) do nothing;

  -- (4) Stamp first-join anonymous expiry.
  perform public.ensure_anonymous_expiry(v_uid);

  return g;
end;
$$;

revoke all on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;

-- Align BEFORE INSERT expiry check with membership fallback (null profile column).
create or replace function public.trg_memberships_enforce_anonymous_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_leader_id uuid;
  v_expires_at timestamptz;
  v_first_joined timestamptz;
begin
  if public.is_auth_user_anonymous(NEW.user_id) then
    select p.anonymous_expires_at into v_expires_at
    from public.profiles p
    where p.id = NEW.user_id;

    if v_expires_at is null then
      select min(m.created_at) into v_first_joined
      from public.memberships m
      where m.user_id = NEW.user_id;
      if v_first_joined is not null then
        v_expires_at := v_first_joined + interval '14 days';
      end if;
    end if;

    if v_expires_at is not null and v_expires_at <= now() then
      raise exception 'anonymous access expired'
        using errcode = 'P0401';
    end if;
  end if;

  if exists (
    select 1
    from public.memberships m
    where m.group_id = NEW.group_id
      and m.user_id = NEW.user_id
  ) then
    return NEW;
  end if;

  select count(*)::int into v_count
  from public.memberships m
  where m.group_id = NEW.group_id;

  if v_count >= 5 then
    select m.user_id into v_leader_id
    from public.memberships m
    where m.group_id = NEW.group_id
      and m.role = 'leader'
    limit 1;

    if v_leader_id is null then
      select g.created_by into v_leader_id
      from public.groups g
      where g.id = NEW.group_id;
    end if;

    if public.is_auth_user_anonymous(v_leader_id) then
      raise exception 'leader registration required before adding member 6'
        using errcode = 'P0406';
    end if;
  end if;

  return NEW;
end;
$$;

-- ============================================================
-- Cleanup: include null-column anonymous users via membership age
-- ============================================================

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

      update public.groups set created_by = null where created_by = r.uid;
      update public.subgroups set leader_id = null where leader_id = r.uid;
      update public.itinerary_items set created_by = null where created_by = r.uid;

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

-- ============================================================
-- Atomic create_group (no orphan groups under RLS)
-- ============================================================
-- Client two-step insert (groups then memberships) can leave a group with
-- no leader membership if the membership insert fails (e.g. P0401). RLS
-- "groups: delete if leader" then cannot delete the orphan. Create atomically
-- in one SECURITY DEFINER transaction instead.

create or replace function public.create_group(p_name text)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := nullif(trim(p_name), '');
  v_expires_at timestamptz;
  v_first_joined timestamptz;
  v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_attempt int;
  g public.groups;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if v_name is null then
    raise exception 'group name required' using errcode = '22023';
  end if;

  -- Same anonymous expiry gate as join_group (profile + membership fallback).
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
      insert into public.groups (name, invite_code, created_by)
      values (v_name, v_code, v_uid)
      returning * into g;

      insert into public.memberships (group_id, user_id, role, status)
      values (g.id, v_uid, 'leader', 'active');

      perform public.ensure_anonymous_expiry(v_uid);
      return g;
    exception
      when unique_violation then
        -- Invite code collision — retry with a new code.
        null;
    end;
  end loop;

  raise exception 'create group failed: invite code collision'
    using errcode = '23505';
end;
$$;

revoke all on function public.create_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;

-- Fallback cleanup for any pre-RPC two-step create leftovers.
create or replace function public.delete_orphan_group(p_group_id uuid)
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
  if p_group_id is null then
    return;
  end if;

  -- Only the creator may delete, and only when the group has no memberships
  -- (true orphan after a failed leader membership insert).
  delete from public.groups g
  where g.id = p_group_id
    and g.created_by = v_uid
    and not exists (
      select 1 from public.memberships m where m.group_id = g.id
    );
end;
$$;

revoke all on function public.delete_orphan_group(uuid) from public, anon;
grant execute on function public.delete_orphan_group(uuid) to authenticated;
