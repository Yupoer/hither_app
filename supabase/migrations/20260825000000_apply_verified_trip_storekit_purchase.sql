-- StoreKit consumable Small Trip Pass.
-- The Edge Function is the only caller: it verifies Apple's signed transaction
-- before invoking this service_role-only, idempotent durable grant boundary.

create or replace function public.apply_verified_trip_storekit_purchase(
  p_user_id uuid,
  p_group_id uuid,
  p_transaction_id text,
  p_original_transaction_id text,
  p_product_id text,
  p_environment text,
  p_ownership_type text,
  p_app_account_token uuid,
  p_purchase_date timestamptz,
  p_signed_at timestamptz,
  p_jws_sha256 text
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_existing public.trip_entitlements%rowtype;
  v_leader uuid;
  v_count integer;
  v_group_exists boolean;
  v_token uuid;
  v_row public.trip_entitlements%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    return json_build_object('ok', false, 'error', 'verification_service_required');
  end if;

  if p_user_id is null
    or p_group_id is null
    or nullif(trim(coalesce(p_transaction_id, '')), '') is null
    or nullif(trim(coalesce(p_original_transaction_id, '')), '') is null
    or p_product_id <> 'hither.small_trip_pass'
    or p_environment not in ('Production', 'Sandbox', 'Xcode')
    or p_ownership_type <> 'PURCHASED'
    or p_app_account_token is null
    or p_purchase_date is null
    or p_signed_at is null
    or nullif(trim(coalesce(p_jws_sha256, '')), '') is null
  then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  select exists(select 1 from public.groups where id = p_group_id)
    into v_group_exists;
  if not v_group_exists then
    return json_build_object('ok', false, 'error', 'not_applicable', 'message', 'group not found');
  end if;

  -- Bind the StoreKit account token to the authenticated Hither account again
  -- at the persistence boundary; the Edge verifier already checked the JWS.
  select t.app_account_token into v_token
  from public.premium_app_account_tokens t
  where t.user_id = p_user_id;
  if v_token is null or v_token <> p_app_account_token then
    return json_build_object('ok', false, 'error', 'account_token_mismatch');
  end if;

  -- Transaction replay is successful only for the same durable binding. This
  -- lets a retry finish the native transaction without creating a second row.
  select * into v_existing
  from public.trip_entitlements e
  where e.transaction_id = trim(p_transaction_id)
  limit 1;
  if found then
    if v_existing.group_id <> p_group_id or v_existing.owner_user_id <> p_user_id then
      return json_build_object('ok', false, 'error', 'transaction_binding_mismatch');
    end if;
    return json_build_object(
      'ok', true,
      'durable', true,
      'duplicate', true,
      'status', v_existing.status,
      'plan_code', v_existing.plan_code,
      'entitlement_id', v_existing.id,
      'started_at', v_existing.started_at,
      'expires_at', v_existing.expires_at,
      'is_premium', v_existing.status = 'active',
      'team_premium_active', v_existing.status = 'active'
    );
  end if;

  -- Serialize group eligibility, expiry, and the one-active-pass constraint.
  perform 1 from public.groups where id = p_group_id for update;
  perform public.expire_stale_entitlements(p_group_id);

  select m.user_id into v_leader
  from public.memberships m
  where m.group_id = p_group_id and m.role = 'leader'
  limit 1;
  if v_leader is null or v_leader <> p_user_id then
    return json_build_object('ok', false, 'error', 'leader_required');
  end if;

  v_count := public.group_member_count(p_group_id);
  if v_count < 2 or v_count > 5 then
    return json_build_object(
      'ok', false,
      'error', 'not_applicable',
      'member_count', v_count,
      'message', 'Small Trip Pass requires 2-5 members including the leader'
    );
  end if;

  if public.group_has_active_premium(p_group_id) then
    return json_build_object('ok', false, 'error', 'already_used', 'message', 'group already has an active pass');
  end if;

  insert into public.trip_entitlements (
    group_id,
    owner_user_id,
    plan_code,
    status,
    source,
    started_at,
    expires_at,
    transaction_id
  ) values (
    p_group_id,
    p_user_id,
    'small_trip_pass',
    'active',
    'purchase',
    p_purchase_date,
    p_purchase_date + interval '10 days',
    trim(p_transaction_id)
  )
  returning * into v_row;

  -- Deliberately never writes profiles.pro: this entitlement belongs to the
  -- current group and is visible through trip_entitlements only.
  return json_build_object(
    'ok', true,
    'durable', true,
    'duplicate', false,
    'status', v_row.status,
    'plan_code', v_row.plan_code,
    'entitlement_id', v_row.id,
    'started_at', v_row.started_at,
    'expires_at', v_row.expires_at,
    'is_premium', true,
    'team_premium_active', true
  );
end;
$$;

revoke all on function public.apply_verified_trip_storekit_purchase(
  uuid, uuid, text, text, text, text, text, uuid, timestamptz, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.apply_verified_trip_storekit_purchase(
  uuid, uuid, text, text, text, text, text, uuid, timestamptz, timestamptz, text
) to service_role;

comment on function public.apply_verified_trip_storekit_purchase(
  uuid, uuid, text, text, text, text, text, uuid, timestamptz, timestamptz, text
) is 'Service-role-only, idempotent StoreKit consumable grant for a 10-day group pass.';
