begin;

create table public.public_profiles (
  id uuid primary key references public.profiles(id) on update cascade on delete cascade,
  nickname text not null,
  avatar text,
  avatar_color text
);

alter table public.public_profiles enable row level security;
revoke all on table public.public_profiles from public, anon, authenticated, service_role;
grant select on table public.public_profiles to authenticated, service_role;

create policy "public_profiles: select own or co-member"
  on public.public_profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships m1
      join public.memberships m2 on m1.group_id = m2.group_id
      where m1.user_id = (select auth.uid())
        and m2.user_id = public_profiles.id
    )
  );

create function extensions.sync_public_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.public_profiles(id, nickname, avatar, avatar_color)
  values (new.id, new.nickname, new.avatar, new.avatar_color)
  on conflict (id) do update
    set nickname = excluded.nickname,
        avatar = excluded.avatar,
        avatar_color = excluded.avatar_color
    where (public_profiles.nickname, public_profiles.avatar, public_profiles.avatar_color)
      is distinct from (excluded.nickname, excluded.avatar, excluded.avatar_color);
  return new;
end;
$$;

revoke all on function extensions.sync_public_profile() from public, anon, authenticated, service_role;

create trigger sync_public_profile
  after insert or update of id, nickname, avatar, avatar_color on public.profiles
  for each row execute function extensions.sync_public_profile();

insert into public.public_profiles(id, nickname, avatar, avatar_color)
select id, nickname, avatar, avatar_color from public.profiles;

alter publication supabase_realtime add table public.public_profiles;

create function public.get_group_public_recovery_snapshot(p_group_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_revision text := to_char(
    now() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- SECURITY DEFINER bypasses table RLS; use the expiry-aware membership
  -- predicate so expired anonymous accounts cannot read full group state.
  if not extensions.is_member(p_group_id) then
    raise exception 'not_member' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'schema_version', 'group-recovery-v1',
    'generated_at', now(),
    'realtime_revision', v_revision,
    'group', (
      select to_jsonb(g)
        from public.groups g
       where g.id = p_group_id
    ),
    'memberships', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.user_id)
        from public.memberships m
       where m.group_id = p_group_id
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'nickname', p.nickname,
        'avatar', p.avatar,
        'avatar_color', p.avatar_color
      ) order by p.id)
        from public.profiles p
       where p.id in (
         select m.user_id from public.memberships m where m.group_id = p_group_id
       )
    ), '[]'::jsonb),
    'subgroups', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.id)
        from public.subgroups s
       where s.group_id = p_group_id
    ), '[]'::jsonb),
    'itinerary', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.position, i.id)
        from public.itinerary_items i
       where i.group_id = p_group_id
    ), '[]'::jsonb),
    'location_sharing', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'sharing_enabled', coalesce(p.sharing_enabled, true)))
        from public.memberships m left join public.member_privacy_settings p on p.user_id = m.user_id
       where m.group_id = p_group_id
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.user_id)
        from public.member_locations l
       where l.group_id = p_group_id
         and coalesce((select p.sharing_enabled from public.member_privacy_settings p where p.user_id = l.user_id), true)
    ), '[]'::jsonb),
    'entity_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entity_type', v.entity_type,
        'entity_id', v.entity_id,
        'entity_version', v.entity_version,
        'updated_at', v.updated_at,
        'state', v.state
      ) order by v.entity_type, v.entity_id)
        from public.core_entity_versions v
       where v.group_id = p_group_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_group_public_recovery_snapshot(uuid) from public, anon;
grant execute on function public.get_group_public_recovery_snapshot(uuid) to authenticated;

comment on function public.get_group_public_recovery_snapshot(uuid) is
  'Recovery snapshot with four-field public profiles; callers must merge by realtime_revision/entity_version.';

commit;
