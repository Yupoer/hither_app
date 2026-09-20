-- Capture time belongs to the device; upload time always belongs to the server.
-- Existing rows retain their known values rather than fabricated history.
create or replace function public.stamp_member_location_received_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.stamp_member_location_received_at() from public, anon, authenticated;
drop trigger if exists stamp_member_location_received_at on public.member_locations;
create trigger stamp_member_location_received_at
before insert or update on public.member_locations
for each row execute function public.stamp_member_location_received_at();
