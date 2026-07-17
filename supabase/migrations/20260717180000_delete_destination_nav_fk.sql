-- Allow leaders to delete itinerary stops that still have navigation_sessions
-- rows. Sessions denormalize destination_name/lat/lng, so the live FK can
-- become nullable and SET NULL on delete. Active sessions are cancelled first
-- so groups.journey_* does not keep a ghost destination.

alter table public.navigation_sessions
  alter column destination_id drop not null;

alter table public.navigation_sessions
  drop constraint navigation_sessions_destination_id_fkey;

alter table public.navigation_sessions
  add constraint navigation_sessions_destination_id_fkey
  foreign key (destination_id)
  references public.itinerary_items(id)
  on delete set null;

create or replace function public.delete_destination(
  p_group_id uuid,
  p_destination_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.itinerary_items;
  v_cancelled integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
      and m.role = 'leader'
  ) then
    raise exception 'leader membership required' using errcode = '42501';
  end if;

  select * into v_item
  from public.itinerary_items i
  where i.id = p_destination_id
    and i.group_id = p_group_id
  for update;
  if not found then
    raise exception 'destination not found' using errcode = 'P0002';
  end if;

  -- Cancel any active navigation session for this stop (mirror cancel_navigation_session).
  update public.navigation_sessions s
  set status = 'cancelled',
      ended_at = now(),
      version = s.version + 1,
      updated_at = now()
  where s.group_id = p_group_id
    and s.destination_id = p_destination_id
    and s.status = 'active';
  get diagnostics v_cancelled = row_count;

  if v_cancelled > 0 or exists (
    select 1 from public.groups g
    where g.id = p_group_id
      and g.active_destination_id = p_destination_id
  ) then
    update public.groups g
    set journey_status = 'paused',
        active_destination_id = null,
        journey_started_at = null
    where g.id = p_group_id;
  end if;

  delete from public.itinerary_items i
  where i.id = p_destination_id
    and i.group_id = p_group_id;
end;
$$;

revoke all on function public.delete_destination(uuid, uuid) from public, anon;
grant execute on function public.delete_destination(uuid, uuid) to authenticated;
