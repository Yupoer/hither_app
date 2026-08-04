-- Ticket 5/6 compatibility boundary.
-- Historical trip_entitlements remain readable by the legacy entitlement and
-- restore RPCs, but the old seven-day purchase RPC must not create new rows.
-- New Premium purchases use the StoreKit ledger migration instead.

create or replace function public.apply_verified_purchase(
  p_group_id uuid,
  p_transaction_id text,
  p_product_id text default 'small_trip_pass'
)
returns json
language sql
security definer
volatile
set search_path = ''
as $$
  select json_build_object(
    'ok', false,
    'error', 'legacy_trip_pass_disabled',
    'status', 'none',
    'message', 'Historical Small Trip Pass purchases are read-compatible only'
  );
$$;

revoke all on function public.apply_verified_purchase(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_verified_purchase(uuid, text, text)
  to service_role;

comment on function public.apply_verified_purchase(uuid, text, text) is
  'Deprecated seven-day trip pass purchase seam; returns disabled and never writes new rows.';
