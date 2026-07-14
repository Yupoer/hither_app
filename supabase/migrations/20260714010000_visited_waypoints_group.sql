-- BUG-17: hang visited waypoints on the team (group), not only the user.
-- Existing rows keep user_id; group_id is nullable for backfill, required on new inserts from the app.

alter table public.visited_waypoints
  add column if not exists group_id uuid references public.groups(id) on delete cascade;

create index if not exists idx_visited_waypoints_group_arrived
  on public.visited_waypoints(group_id, arrived_at desc)
  where group_id is not null;

-- Members of a group can read that group's history.
drop policy if exists "visited_waypoints: select own" on public.visited_waypoints;
create policy "visited_waypoints: select own or group member"
  on public.visited_waypoints for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      group_id is not null
      and extensions.is_member(group_id)
    )
  );

-- Insert still requires ownership; when group_id is set, caller must be a member.
drop policy if exists "visited_waypoints: insert own" on public.visited_waypoints;
create policy "visited_waypoints: insert own"
  on public.visited_waypoints for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      group_id is null
      or extensions.is_member(group_id)
    )
  );
