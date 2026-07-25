-- OTA-05: unified 14-day anonymous access + 6th-member Leader registration gate.
--
-- - profiles.anonymous_expires_at is the authoritative expiry (set on first membership).
-- - memberships.created_at records join time (previously referenced but missing).
-- - join_group + membership BEFORE INSERT enforce expiry and the anonymous Leader gate.
-- - cleanup_expired_anonymous_accounts is idempotent and skips upgraded (non-anonymous) users.

-- ============================================================
-- COLUMNS
-- ============================================================

alter table public.profiles
  add column if not exists anonymous_expires_at timestamptz;

comment on column public.profiles.anonymous_expires_at is
  'When anonymous access ends (UTC). Set on first group membership to now()+14 days. Null after registration upgrade or for non-anonymous accounts.';

alter table public.memberships
  add column if not exists created_at timestamptz not null default now();

comment on column public.memberships.created_at is
  'When this membership was created (join / create group). Used as the start of the anonymous 14-day window.';

create index if not exists idx_profiles_anonymous_expires_at
  on public.profiles (anonymous_expires_at)
  where anonymous_expires_at is not null;

-- ============================================================
-- HELPERS
-- ============================================================

create or replace function public.is_auth_user_anonymous(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.is_anonymous from auth.users u where u.id = p_uid),
    false
  );
$$;

revoke all on function public.is_auth_user_anonymous(uuid) from public, anon;
grant execute on function public.is_auth_user_anonymous(uuid) to authenticated, service_role;

-- Stamp first-join expiry for an anonymous identity (idempotent).
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

  update public.profiles
  set anonymous_expires_at = coalesce(anonymous_expires_at, now() + interval '14 days')
  where id = p_uid
  returning anonymous_expires_at into v_expires;

  return v_expires;
end;
$$;

revoke all on function public.ensure_anonymous_expiry(uuid) from public, anon;
grant execute on function public.ensure_anonymous_expiry(uuid) to authenticated, service_role;

-- Clear expiry when the identity is no longer anonymous (upgrade preservation path).
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
  if public.is_auth_user_anonymous(p_uid) then
    return;
  end if;
  update public.profiles
  set anonymous_expires_at = null
  where id = p_uid
    and anonymous_expires_at is not null;
end;
$$;

revoke all on function public.clear_anonymous_expiry_if_registered(uuid) from public, anon;
grant execute on function public.clear_anonymous_expiry_if_registered(uuid) to authenticated, service_role;

-- ============================================================
-- MEMBERSHIP ENFORCEMENT (create path + join path)
-- ============================================================

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
begin
  -- Expired anonymous identities cannot create or join groups.
  if public.is_auth_user_anonymous(NEW.user_id) then
    select p.anonymous_expires_at into v_expires_at
    from public.profiles p
    where p.id = NEW.user_id;

    if v_expires_at is not null and v_expires_at <= now() then
      raise exception 'anonymous access expired'
        using errcode = 'P0401';
    end if;
  end if;

  -- Already a member (re-insert / conflict path): allow through.
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

  -- 6th total member requires a registered Leader (anonymous Leader gate).
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

drop trigger if exists memberships_enforce_anonymous_rules on public.memberships;
create trigger memberships_enforce_anonymous_rules
  before insert on public.memberships
  for each row
  execute function public.trg_memberships_enforce_anonymous_rules();

create or replace function public.trg_memberships_set_anonymous_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_anonymous_expiry(NEW.user_id);
  return NEW;
end;
$$;

drop trigger if exists memberships_set_anonymous_expiry on public.memberships;
create trigger memberships_set_anonymous_expiry
  after insert on public.memberships
  for each row
  execute function public.trg_memberships_set_anonymous_expiry();

-- ============================================================
-- join_group: same rules + clear error codes for the client
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
  v_count int;
  v_leader_id uuid;
  v_expires_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if public.is_auth_user_anonymous(v_uid) then
    select p.anonymous_expires_at into v_expires_at
    from public.profiles p
    where p.id = v_uid;

    if v_expires_at is not null and v_expires_at <= now() then
      raise exception 'anonymous access expired'
        using errcode = 'P0401';
    end if;
  end if;

  select * into g from public.groups where invite_code = upper(p_code) limit 1;
  if not found then
    raise exception 'group not found for code %', p_code using errcode = 'P0002';
  end if;

  -- Idempotent: already a member → return group without re-checking the gate.
  if exists (
    select 1 from public.memberships m
    where m.group_id = g.id and m.user_id = v_uid
  ) then
    return g;
  end if;

  select count(*)::int into v_count
  from public.memberships m
  where m.group_id = g.id;

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
  end if;

  insert into public.memberships (group_id, user_id, role, status)
  values (g.id, v_uid, 'follower', 'active')
  on conflict (group_id, user_id) do nothing;

  -- AFTER INSERT trigger also stamps expiry; call explicitly for clarity.
  perform public.ensure_anonymous_expiry(v_uid);

  return g;
end;
$$;

revoke all on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;

-- ============================================================
-- CLEANUP (idempotent; never deletes upgraded identities)
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
    select u.id as uid
    from auth.users u
    join public.profiles p on p.id = u.id
    where coalesce(u.is_anonymous, false) = true
      and p.anonymous_expires_at is not null
      and p.anonymous_expires_at <= now()
  loop
    begin
      -- Re-check immediately before delete so an upgrade mid-batch is preserved.
      select coalesce(u.is_anonymous, false) into v_still_anonymous
      from auth.users u
      where u.id = r.uid;

      if not coalesce(v_still_anonymous, false) then
        -- Upgraded identity: clear stale expiry and skip.
        update public.profiles
        set anonymous_expires_at = null
        where id = r.uid;
        continue;
      end if;

      -- Same owned-data cleanup as delete_anonymous_account (manual logout).
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

      -- Final guard: only delete if still anonymous.
      delete from auth.users
      where id = r.uid
        and coalesce(is_anonymous, false) = true;

      if found then
        n := n + 1;
      end if;
    exception
      when others then
        -- Batch continues; retries are safe (already-deleted rows are no-ops).
        raise notice 'cleanup_expired_anonymous_accounts skipped %: %', r.uid, sqlerrm;
    end;
  end loop;

  return n;
end;
$$;

revoke all on function public.cleanup_expired_anonymous_accounts() from public, anon, authenticated;
grant execute on function public.cleanup_expired_anonymous_accounts() to service_role;

-- Optional daily schedule when pg_cron is available.
do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception
  when others then
    raise notice 'pg_cron unavailable; schedule public.cleanup_expired_anonymous_accounts() externally';
end;
$$;

do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into v_job_id
    from cron.job
    where jobname = 'hither-cleanup-expired-anonymous';

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'hither-cleanup-expired-anonymous',
      '20 4 * * *',
      $cron$ select public.cleanup_expired_anonymous_accounts(); $cron$
    );
  end if;
exception
  when others then
    raise notice 'Could not schedule anonymous cleanup cron: %', sqlerrm;
end;
$$;
