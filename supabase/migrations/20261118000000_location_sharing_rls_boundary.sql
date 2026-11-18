begin;

create function extensions.location_sharing_enabled(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select settings.sharing_enabled
    from public.member_privacy_settings settings
    where settings.user_id = target_user_id
  ), true);
$$;

revoke all on function extensions.location_sharing_enabled(uuid) from public, anon, authenticated;
grant execute on function extensions.location_sharing_enabled(uuid) to authenticated;

create function extensions.lock_location_sharing_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is not null and new.user_id is distinct from actor_id then
    raise exception 'location sharing preference owner mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('location-sharing/' || new.user_id::text, 0));
  return new;
end;
$$;

revoke all on function extensions.lock_location_sharing_preference() from public, anon, authenticated;

create trigger lock_location_sharing_preference
before insert or update of sharing_enabled on public.member_privacy_settings
for each row execute function extensions.lock_location_sharing_preference();

create function extensions.purge_disabled_member_locations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.sharing_enabled then
    delete from public.member_locations where user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function extensions.purge_disabled_member_locations() from public, anon, authenticated;

create trigger purge_disabled_member_locations
after insert or update of sharing_enabled on public.member_privacy_settings
for each row execute function extensions.purge_disabled_member_locations();

delete from public.member_locations locations
using public.member_privacy_settings settings
where settings.user_id = locations.user_id
  and not settings.sharing_enabled;

create function extensions.enforce_member_location_sharing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    return new;
  end if;
  if new.user_id is distinct from actor_id then
    raise exception 'member location owner mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('location-sharing/' || new.user_id::text, 0));
  if not coalesce((
    select settings.sharing_enabled
    from public.member_privacy_settings settings
    where settings.user_id = new.user_id
  ), true) then
    raise exception 'location sharing disabled' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function extensions.enforce_member_location_sharing() from public, anon, authenticated;

create trigger enforce_member_location_sharing
before insert or update on public.member_locations
for each row execute function extensions.enforce_member_location_sharing();

drop policy if exists "member_locations: select if member" on public.member_locations;
create policy "member_locations: select if member"
  on public.member_locations for select to authenticated
  using (
    extensions.is_member(group_id)
    and extensions.location_sharing_enabled(user_id)
  );

drop policy if exists "member_locations: insert own" on public.member_locations;
create policy "member_locations: insert own"
  on public.member_locations for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and extensions.is_member(group_id)
    and extensions.location_sharing_enabled(user_id)
  );

drop policy if exists "member_locations: update own" on public.member_locations;
create policy "member_locations: update own"
  on public.member_locations for update to authenticated
  using (
    user_id = (select auth.uid())
    and extensions.is_member(group_id)
    and extensions.location_sharing_enabled(user_id)
  )
  with check (
    user_id = (select auth.uid())
    and extensions.is_member(group_id)
    and extensions.location_sharing_enabled(user_id)
  );

commit;
