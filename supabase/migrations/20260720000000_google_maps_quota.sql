-- Per-user daily hard quotas for Places / Routes proxy.
-- Limits are enforced server-side; clients cannot raise them.

create table if not exists public.google_maps_daily_usage (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('search', 'route')),
  count integer not null default 0 check (count >= 0),
  primary key (day, user_id, action)
);

create index if not exists idx_google_maps_daily_usage_user_day
  on public.google_maps_daily_usage (user_id, day);

alter table public.google_maps_daily_usage enable row level security;

-- No direct client access; only security-definer RPC mutates rows.
drop policy if exists "google_maps_daily_usage: deny all" on public.google_maps_daily_usage;
create policy "google_maps_daily_usage: deny all"
  on public.google_maps_daily_usage
  for all
  to authenticated, anon
  using (false)
  with check (false);

revoke all on public.google_maps_daily_usage from anon, authenticated;
grant all on public.google_maps_daily_usage to service_role;

/**
 * Atomically increment today's usage for (user, action).
 * Returns true when the call is within p_limit (count after increment ≤ limit).
 * Returns false when the hard quota would be exceeded (no Google call).
 *
 * p_user_id is required for service-role Edge Function callers (auth.uid() is null).
 * When called with a user JWT, p_user_id must match auth.uid().
 */
create or replace function public.consume_google_maps_quota(
  p_action text,
  p_limit int,
  p_user_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_day date := (timezone('utc', now()))::date;
  v_count int;
begin
  if p_action is null or p_action not in ('search', 'route') then
    return false;
  end if;
  if p_limit is null or p_limit < 1 then
    return false;
  end if;

  v_user := coalesce(auth.uid(), p_user_id);
  if v_user is null then
    return false;
  end if;
  -- User JWT may not impersonate another user.
  if auth.uid() is not null and p_user_id is not null and auth.uid() <> p_user_id then
    return false;
  end if;

  insert into public.google_maps_daily_usage as u (day, user_id, action, count)
  values (v_day, v_user, p_action, 1)
  on conflict (day, user_id, action)
  do update set count = u.count + 1
  where u.count < p_limit
  returning u.count into v_count;

  if v_count is null then
    -- Row already at limit: conflict update skipped by WHERE.
    return false;
  end if;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_google_maps_quota(text, int, uuid) from public, anon, authenticated;
grant execute on function public.consume_google_maps_quota(text, int, uuid) to service_role;
