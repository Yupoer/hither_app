-- App Store REFUND / REVOKE for the consumable Small Trip Pass.
-- apple-server-notifications verifies Apple's JWS, records the notification
-- with record_storekit_notification, then calls this service_role-only RPC.
-- The trip pass never writes premium_store_transactions, so the subscription
-- accept_storekit_notification cannot accept these; this RPC applies the
-- entitlement change and the acceptance mark in one transaction instead.

create or replace function public.apply_trip_storekit_notification(
  p_notification_id text,
  p_user_id uuid,
  p_transaction_id text,
  p_original_transaction_id text,
  p_product_id text,
  p_app_account_token uuid,
  p_status text,
  p_signed_at timestamptz
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_notification public.premium_store_notifications%rowtype;
  v_entitlement public.trip_entitlements%rowtype;
  v_token uuid;
  v_revoked boolean := false;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user not in ('service_role', 'postgres') then
    raise exception 'storekit_notification_forbidden' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_notification_id, '')), '') is null
     or p_user_id is null
     or nullif(trim(coalesce(p_transaction_id, '')), '') is null
     or nullif(trim(coalesce(p_original_transaction_id, '')), '') is null
     or p_product_id is distinct from 'hither.small_trip_pass'
     or p_app_account_token is null
     or (p_status is not null and p_status not in ('refunded', 'revoked'))
     or p_signed_at is null then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  select * into v_notification
    from public.premium_store_notifications n
   where n.notification_id = trim(p_notification_id)
   for update;
  if v_notification.id is null then
    return json_build_object('ok', false, 'error', 'notification_missing');
  end if;
  if v_notification.transaction_id is distinct from trim(p_transaction_id)
     or v_notification.original_transaction_id is distinct from trim(p_original_transaction_id)
     or v_notification.product_id is distinct from p_product_id
     or v_notification.signed_at is distinct from p_signed_at then
    return json_build_object('ok', false, 'error', 'notification_payload_mismatch');
  end if;
  if v_notification.accepted then
    return json_build_object('ok', true, 'durable', true, 'accepted', true, 'duplicate', true, 'revoked', false);
  end if;

  select t.app_account_token into v_token
    from public.premium_app_account_tokens t
   where t.user_id = p_user_id;
  if v_token is null or v_token <> p_app_account_token then
    return json_build_object('ok', false, 'error', 'account_token_mismatch');
  end if;

  select * into v_entitlement
    from public.trip_entitlements e
   where e.transaction_id = trim(p_transaction_id)
   for update;
  if v_entitlement.id is not null and v_entitlement.owner_user_id <> p_user_id then
    return json_build_object('ok', false, 'error', 'transaction_binding_mismatch');
  end if;

  -- A refund after a revoke (or vice versa) keeps the first terminal status.
  if p_status is not null
     and v_entitlement.id is not null
     and v_entitlement.status not in ('refunded', 'revoked') then
    update public.trip_entitlements
       set status = p_status, updated_at = now()
     where id = v_entitlement.id
    returning * into v_entitlement;
    v_revoked := true;
  end if;

  -- The accepted REFUND/REVOKE row also blocks a later grant of the same
  -- transaction in apply_verified_trip_storekit_purchase, which covers a
  -- refund that arrives before the purchase was ever applied.
  update public.premium_store_notifications
     set accepted = true
   where id = v_notification.id;

  return json_build_object(
    'ok', true,
    'durable', true,
    'accepted', true,
    'duplicate', false,
    'revoked', v_revoked,
    'status', v_entitlement.status,
    'entitlement_id', v_entitlement.id
  );
end;
$$;

revoke all on function public.apply_trip_storekit_notification(
  text, uuid, text, text, text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_trip_storekit_notification(
  text, uuid, text, text, text, uuid, text, timestamptz
) to service_role;

comment on function public.apply_trip_storekit_notification(
  text, uuid, text, text, text, uuid, text, timestamptz
) is 'Service-role-only, idempotent App Store REFUND/REVOKE apply and acceptance for the Small Trip Pass.';

-- Same grant boundary as 20260825000000, plus: a transaction Apple already
-- refunded or revoked can never be granted.
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

  select t.app_account_token into v_token
  from public.premium_app_account_tokens t
  where t.user_id = p_user_id;
  if v_token is null or v_token <> p_app_account_token then
    return json_build_object('ok', false, 'error', 'account_token_mismatch');
  end if;

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

  if exists (
    select 1
      from public.premium_store_notifications n
     where n.transaction_id = trim(p_transaction_id)
       and n.notification_type in ('REFUND', 'REVOKE')
       and n.accepted
  ) then
    return json_build_object('ok', false, 'error', 'transaction_revoked');
  end if;

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
