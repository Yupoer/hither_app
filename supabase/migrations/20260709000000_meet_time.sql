-- Gathering-point meet time: leader sets an optional target time per stop.
alter table public.itinerary_items add column meet_at timestamptz;
