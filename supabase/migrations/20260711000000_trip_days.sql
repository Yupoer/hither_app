-- Add trip_days and departure_date to public.groups
alter table public.groups
  add column trip_days integer,
  add column departure_date date;

-- Add day to public.itinerary_items to group destinations by day
alter table public.itinerary_items
  add column day integer not null default 1;
