-- Trigger functions execute from their owning table triggers. They are not
-- client RPCs, so API roles must not be able to invoke them directly.
revoke execute on function public.on_member_location_arrival() from public, anon, authenticated;
revoke execute on function public.on_live_activity_progress() from public, anon, authenticated;
revoke execute on function public.on_membership_presence_change() from public, anon, authenticated;
