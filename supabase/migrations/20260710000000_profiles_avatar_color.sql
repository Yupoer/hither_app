-- Per-user avatar background colour.
--
-- Holds a hex string (e.g. '#4A90D9') the member picks in their profile. The
-- app treats it as optional and falls back to the derived memberColor / theme
-- accent when null, so this migration is safe to apply before or after the
-- client ships (matches the profiles_avatar / meet_time pattern).
alter table public.profiles add column if not exists avatar_color text;
