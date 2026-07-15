-- Group-wide location refresh requests with a database-enforced cooldown.

create table if not exists public.location_refresh_requests (
  group_id uuid primary key references public.groups(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null
);

alter table public.location_refresh_requests enable row level security;
revoke all on public.location_refresh_requests from public, anon, authenticated;

create or replace function public.request_group_location_refresh(
  p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_requested_at timestamptz;
  v_retry integer;
begin
  if v_uid is null or not exists (
    select 1
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = v_uid
  ) then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  insert into public.location_refresh_requests(group_id, requested_by, requested_at)
  values (p_group_id, v_uid, v_now)
  on conflict (group_id) do nothing;

  if not found then
    select r.requested_at
    into v_requested_at
    from public.location_refresh_requests r
    where r.group_id = p_group_id
    for update;

    if v_requested_at > v_now - interval '60 seconds' then
      v_retry := greatest(
        0,
        ceil(extract(epoch from (v_requested_at + interval '60 seconds' - v_now)))
      )::integer;
      return jsonb_build_object(
        'accepted', false,
        'retry_after_seconds', v_retry
      );
    end if;

    update public.location_refresh_requests
    set requested_by = v_uid,
        requested_at = v_now
    where group_id = p_group_id;
  end if;

  perform extensions.notify_push(jsonb_build_object(
    'category', 'location_refresh',
    'group_id', p_group_id,
    'sender_id', v_uid
  ));

  return jsonb_build_object(
    'accepted', true,
    'retry_after_seconds', 60
  );
end;
$$;

revoke all on function public.request_group_location_refresh(uuid)
  from public, anon;
grant execute on function public.request_group_location_refresh(uuid)
  to authenticated;

