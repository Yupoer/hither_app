revoke all on function public.profile_has_lifetime_premium(uuid)
  from public, anon, authenticated;
grant execute on function public.profile_has_lifetime_premium(uuid)
  to service_role;

revoke all on function public.group_has_active_premium(uuid)
  from public, anon, authenticated;
grant execute on function public.group_has_active_premium(uuid)
  to service_role;

revoke all on function public.effective_live_activity_entitlement(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.effective_live_activity_entitlement(uuid, uuid)
  to service_role;
