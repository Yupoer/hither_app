-- History of gathering points the user has actually reached (auto-recorded
-- on arrival, see MapScreen's arrival effect). Personal, not group-scoped —
-- shown in the app's "歷史行程" list grouped by day.

create table public.visited_waypoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  arrived_at timestamptz not null default now()
);
alter table public.visited_waypoints enable row level security;

create policy "visited_waypoints: select own" on public.visited_waypoints
  for select to authenticated using (user_id = (select auth.uid()));
create policy "visited_waypoints: insert own" on public.visited_waypoints
  for insert to authenticated with check (user_id = (select auth.uid()));

create index idx_visited_waypoints_user_arrived on public.visited_waypoints(user_id, arrived_at desc);
grant select, insert on public.visited_waypoints to authenticated;
