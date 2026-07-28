-- TEMPORARY QA override: Free Plan gathering points are unlimited.
-- Revert this function to the paid-entitlement limit before launch.

create or replace function public.enforce_itinerary_point_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return new;
end;
$$;
