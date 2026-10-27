-- The Data API no longer grants new public tables to service_role by default.
-- Keep only the table operations used by send-push and
-- apple-server-notifications available when migrations are replayed.
-- Existing client grants and RLS policies are unchanged.

grant select, delete on table public.push_tokens to service_role;
grant select on table public.groups to service_role;
grant select on table public.itinerary_items to service_role;
grant select on table public.profiles to service_role;
grant select on table public.memberships to service_role;
grant select on table public.notification_preferences to service_role;
grant select on table public.navigation_sessions to service_role;
grant select, update on table public.device_live_activity_tokens to service_role;
grant select, update, delete on table public.live_activity_sessions to service_role;
grant select on table public.destination_arrivals to service_role;
grant select on table public.premium_app_account_tokens to service_role;
