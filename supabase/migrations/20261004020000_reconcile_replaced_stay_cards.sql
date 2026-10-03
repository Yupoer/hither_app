-- #287: a replacement daily stay must not leave its open copied itinerary
-- cards pointing at the previous hotel. Preserve independent stays/history.
-- A transaction-scoped capability is written only by the trusted daily-stay
-- trigger. Clients cannot create one or use a spoofable GUC to move a point.
create table public.daily_stay_coordinate_replacement_context (
  transaction_id bigint not null,
  backend_pid integer not null,
  destination_id uuid not null,
  group_id uuid not null,
  old_latitude double precision,
  old_longitude double precision,
  new_latitude double precision,
  new_longitude double precision,
  primary key (transaction_id, backend_pid, destination_id)
);
alter table public.daily_stay_coordinate_replacement_context enable row level security;
revoke all on table public.daily_stay_coordinate_replacement_context from public, anon, authenticated, service_role;

create or replace function public.guard_itinerary_coordinates_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude then
    if pg_trigger_depth() > 1
       and new.id = old.id and new.group_id = old.group_id
       and old.kind = 'accommodation' and new.kind = 'accommodation'
       and old.subgroup_id is null and new.subgroup_id is null
       and old.closed_at is null and new.closed_at is null
       and not exists (select 1 from public.groups g where g.id = old.group_id and g.active_destination_id = old.id)
       and not exists (select 1 from public.navigation_sessions n where n.group_id = old.group_id and n.destination_id = old.id and n.status = 'active')
       and exists (
         select 1 from public.daily_stay_coordinate_replacement_context c
         where c.transaction_id = txid_current() and c.backend_pid = pg_backend_pid()
           and c.destination_id = old.id and c.group_id = old.group_id
           and c.old_latitude is not distinct from old.latitude
           and c.old_longitude is not distinct from old.longitude
           and c.new_latitude is not distinct from new.latitude
           and c.new_longitude is not distinct from new.longitude
       ) then
      return new;
    end if;
    raise exception 'destination coordinates are immutable; delete and recreate the destination'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_itinerary_coordinates_immutable() from public, anon, authenticated, service_role;

create or replace function public.reconcile_replaced_daily_stay_cards()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip_departure date;
  stay_day integer;
begin
  if new.group_id is distinct from old.group_id or new.stay_date is distinct from old.stay_date then
    return new;
  end if;
  if (new.title, new.address, new.latitude, new.longitude)
     is not distinct from (old.title, old.address, old.latitude, old.longitude) then
    return new;
  end if;
  select departure_date into trip_departure from public.groups where id = new.group_id;
  stay_day := coalesce(new.stay_date - trip_departure + 1, 1);
  insert into public.daily_stay_coordinate_replacement_context(
    transaction_id, backend_pid, destination_id, group_id,
    old_latitude, old_longitude, new_latitude, new_longitude
  )
  select txid_current(), pg_backend_pid(), i.id, i.group_id,
    i.latitude, i.longitude, new.latitude, new.longitude
  from public.itinerary_items i
  where i.group_id = new.group_id and i.subgroup_id is null
    and i.day = stay_day and i.kind = 'accommodation' and i.closed_at is null
    and not exists (select 1 from public.groups g where g.id = i.group_id and g.active_destination_id = i.id)
    and not exists (select 1 from public.navigation_sessions n where n.group_id = i.group_id and n.destination_id = i.id and n.status = 'active')
    and i.title = old.title
    and abs(i.latitude - old.latitude) < 0.000001
    and abs(i.longitude - old.longitude) < 0.000001
  for update of i;
  update public.itinerary_items i
  set title = new.title, address = new.address,
      latitude = new.latitude, longitude = new.longitude,
      provider_place_id = null, stay_anchor = false
  where i.group_id = new.group_id and i.subgroup_id is null
    and i.day = stay_day and i.kind = 'accommodation' and i.closed_at is null
    and not exists (select 1 from public.groups g where g.id = i.group_id and g.active_destination_id = i.id)
    and not exists (select 1 from public.navigation_sessions n where n.group_id = i.group_id and n.destination_id = i.id and n.status = 'active')
    and i.title = old.title
    and abs(i.latitude - old.latitude) < 0.000001
    and abs(i.longitude - old.longitude) < 0.000001;
  delete from public.daily_stay_coordinate_replacement_context c
  where c.transaction_id = txid_current() and c.backend_pid = pg_backend_pid()
    and c.group_id = new.group_id;
  return new;
end;
$$;
revoke all on function public.reconcile_replaced_daily_stay_cards() from public, anon, authenticated, service_role;
drop trigger if exists reconcile_replaced_daily_stay_cards on public.daily_accommodations;
create trigger reconcile_replaced_daily_stay_cards
after update of title, address, latitude, longitude on public.daily_accommodations
for each row execute function public.reconcile_replaced_daily_stay_cards();
