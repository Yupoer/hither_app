-- Device-owned ETA and progress remain unchanged; permit cycling session payloads.
alter table public.live_activity_sessions
  drop constraint live_activity_sessions_travel_mode_check;
alter table public.live_activity_sessions
  add constraint live_activity_sessions_travel_mode_check
  check (travel_mode in ('walk', 'transit', 'drive', 'bicycle'));
