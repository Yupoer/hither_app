-- Keep daily-accommodation RPC grants minimal after Supabase public-schema
-- default privileges grant EXECUTE to API roles.

revoke all on function extensions.set_daily_accommodation_with_auto_add(
  uuid, date, text, text, double precision, double precision, uuid, int
) from public, anon, service_role;
revoke all on function extensions.clear_daily_accommodation_with_downgrade(
  uuid, date, int
) from public, anon, service_role;
revoke all on function extensions.set_accommodation_auto_add(
  uuid, boolean
) from public, anon, service_role;

revoke all on function public.set_daily_accommodation_with_auto_add(
  uuid, date, text, text, double precision, double precision, uuid, int
) from public, anon, service_role;
revoke all on function public.clear_daily_accommodation_with_downgrade(
  uuid, date, int
) from public, anon, service_role;
revoke all on function public.set_accommodation_auto_add(
  uuid, boolean
) from public, anon, service_role;

grant execute on function extensions.set_daily_accommodation_with_auto_add(
  uuid, date, text, text, double precision, double precision, uuid, int
) to authenticated;
grant execute on function extensions.clear_daily_accommodation_with_downgrade(
  uuid, date, int
) to authenticated;
grant execute on function extensions.set_accommodation_auto_add(
  uuid, boolean
) to authenticated;
grant execute on function public.set_daily_accommodation_with_auto_add(
  uuid, date, text, text, double precision, double precision, uuid, int
) to authenticated;
grant execute on function public.clear_daily_accommodation_with_downgrade(
  uuid, date, int
) to authenticated;
grant execute on function public.set_accommodation_auto_add(
  uuid, boolean
) to authenticated;
