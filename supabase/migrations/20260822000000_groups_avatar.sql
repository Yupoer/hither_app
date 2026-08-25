-- Group emoji avatar (LINE-style). Independent of member profiles.
alter table public.groups
  add column if not exists avatar text,
  add column if not exists avatar_color text;
