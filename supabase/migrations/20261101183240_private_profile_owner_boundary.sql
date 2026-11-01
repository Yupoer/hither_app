begin;

drop policy "profiles: select own or co-member" on public.profiles;
create policy "profiles: select own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create or replace function public.get_group_recovery_snapshot(p_group_id uuid)
returns jsonb
language sql
security invoker
stable
set search_path = ''
as $$
  select public.get_group_public_recovery_snapshot(p_group_id);
$$;

revoke all on function public.get_group_recovery_snapshot(uuid) from public, anon, service_role;
grant execute on function public.get_group_recovery_snapshot(uuid) to authenticated;

comment on function public.get_group_recovery_snapshot(uuid) is
  'Recovery snapshot with four-field public profiles; callers must merge by realtime_revision/entity_version.';

commit;
