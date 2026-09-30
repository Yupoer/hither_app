-- Membership deletion is the shared boundary for leave, clear-all and kicks.
-- Remove the departed user's current location even when other members remain.
create or replace function public.cleanup_departed_member_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships m
    where m.group_id = old.group_id and m.user_id = old.user_id
  ) then
    delete from public.member_locations
    where group_id = old.group_id and user_id = old.user_id;
  end if;
  return null;
end;
$$;
revoke all on function public.cleanup_departed_member_location() from public, anon, authenticated;

drop trigger if exists trigger_cleanup_departed_member_location on public.memberships;
create trigger trigger_cleanup_departed_member_location
after delete or update of group_id, user_id on public.memberships
for each row execute function public.cleanup_departed_member_location();

-- Group cleanup and group-scoped reads must not scan unrelated rows.
create index if not exists core_notification_outbox_group_id_idx
  on public.core_notification_outbox(group_id);
create index if not exists navigation_arrival_events_group_id_idx
  on public.navigation_arrival_events(group_id);
create index if not exists subgroup_invites_group_id_idx
  on public.subgroup_invites(group_id);
create index if not exists token_ledger_group_id_idx
  on public.token_ledger(group_id);
create index if not exists visited_waypoints_destination_id_idx
  on public.visited_waypoints(destination_id);
