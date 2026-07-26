-- Expand diagnostic_events.event allow-list for performance/stability telemetry.
-- Mobile clients already emit these; the original CHECK rejected remote uploads
-- with invalid_event (ingest_diagnostic_batch swallows constraint violations).

alter table public.diagnostic_events
  drop constraint if exists diagnostic_events_event_check;

alter table public.diagnostic_events
  add constraint diagnostic_events_event_check
  check (event in (
    'location_task_registered','location_task_unregistered','location_callback',
    'location_valid','location_rejected_accuracy','location_rejected_distance',
    'location_rejected_time','location_rejected_sharing_disabled',
    'location_outbox_enqueued','location_upload_started','location_upload_succeeded',
    'location_upload_failed','location_upload_discarded',
    'tracking_mode_changed','app_foreground','app_background',
    'app_inactive','team_navigation_received','team_navigation_acknowledged',
    'live_activity_start_requested','live_activity_started','live_activity_updated',
    'live_activity_ended','live_activity_token_register',
    'arrival_candidate','arrival_confirmed',
    'high_accuracy_started','high_accuracy_stopped','refresh_request_received',
    'refresh_request_completed','refresh_request_timeout','permission_changed',
    'metric_payload_received','metric_payload_classified',
    'background_op_timeline','background_op_near_watchdog',
    'previous_launch_incomplete','navigation_terminal_conflict',
    'diagnostic_error'
  ));

comment on constraint diagnostic_events_event_check on public.diagnostic_events is
  'Allow-listed diagnostic event names. Expand via migration when clients emit new events.';
