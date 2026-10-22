-- App Store REFUND / REVOKE / REFUND_REVERSED for the consumable Small Trip Pass.
-- apple-server-notifications verifies Apple's JWS, records the notification
-- with record_storekit_notification, then calls this service_role-only RPC.
-- The trip pass never writes premium_store_transactions, so the subscription
-- accept_storekit_notification cannot accept these; this RPC applies the
-- entitlement change and the acceptance mark in one transaction instead.
--
-- The accepted notification ledger is the source of truth for whether Apple
-- currently considers a transaction refunded or revoked. Both this RPC and
-- apply_verified_trip_storekit_purchase take the same per-transaction advisory
-- lock before reading it, so a grant and a refund for the same transaction
-- can never interleave, even before any entitlement row exists.

create index if not exists premium_store_notifications_transaction_idx
  on public.premium_store_notifications (transaction_id)
  where accepted;

-- Apple signs each notification with signedDate, so the order of delivery
-- does not matter: a REFUND stays in force only while no later-signed
-- REFUND_REVERSED exists. REVOKE (Family Sharing) has no reversal.
create or replace function public.trip_store_revocation_status(p_transaction_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1
        from public.premium_store_notifications n
       where n.transaction_id = p_transaction_id
         and n.accepted
         and n.notification_type = 'REVOKE'
    ) then 'revoked'
    when exists (
      select 1
        from public.premium_store_notifications refund
       where refund.transaction_id = p_transaction_id
         and refund.accepted
         and refund.notification_type = 'REFUND'
         and not exists (
           select 1
             from public.premium_store_notifications reversal
            where reversal.transaction_id = p_transaction_id
              and reversal.accepted
              and reversal.notification_type = 'REFUND_REVERSED'
              and reversal.signed_at > refund.signed_at
         )
    ) then 'refunded'
  end;
$$;

revoke all on function public.trip_store_revocation_status(text)
  from public, anon, authenticated, service_role;

create or replace function public.expire_stale_entitlements(p_group_id uuid default null)
returns void
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_candidate uuid;
begin
  -- Group before entitlement, including standalone expiry and read/restore.
  for v_group_id in
    select g.id from public.groups g
     where (p_group_id is null or g.id = p_group_id)
       and exists (select 1 from public.trip_entitlements e where e.group_id = g.id)
     order by g.id
     for update
  loop
    update public.trip_entitlements
       set status = 'expired', updated_at = now()
     where group_id = v_group_id and status = 'active'
       and expires_at is not null and expires_at <= now();

    -- Accepted reversals remain recoverable while another pass holds the slot.
    update public.trip_entitlements e
       set status = 'expired', updated_at = now()
     where e.group_id = v_group_id and e.status = 'refunded'
       and e.source = 'purchase' and e.plan_code = 'small_trip_pass'
       and e.expires_at <= now()
       and exists (
         select 1 from public.premium_store_notifications n
          where n.transaction_id = e.transaction_id and n.accepted
            and n.notification_type = 'REFUND'
       )
       and public.trip_store_revocation_status(e.transaction_id) is null;

    if not exists (
      select 1 from public.trip_entitlements e
       where e.group_id = v_group_id and e.plan_code = 'small_trip_pass'
         and e.status = 'active'
    ) then
      select e.id into v_candidate
        from public.trip_entitlements e
       where e.group_id = v_group_id and e.status = 'refunded'
         and e.source = 'purchase' and e.plan_code = 'small_trip_pass'
         and e.expires_at > now()
         and exists (
           select 1 from public.premium_store_notifications n
            where n.transaction_id = e.transaction_id and n.accepted
              and n.notification_type = 'REFUND'
         )
         and public.trip_store_revocation_status(e.transaction_id) is null
       order by e.expires_at desc, e.id
       limit 1;
      update public.trip_entitlements
         set status = 'active', updated_at = now()
       where id = v_candidate;
    end if;
  end loop;

  -- Clear denormalized lifetime rows that somehow gained an expiry and lapsed.
  -- Trip-scoped passes do not write profiles.pro (see apply/redeem).
  perform public.allow_entitlement_profile_write();
  update public.profiles
  set pro = false
  where pro = true
    and pro_expires_at is not null
    and pro_expires_at < now();
end;
$$;

create or replace function public.revoke_trip_entitlement(
  p_entitlement_id uuid,
  p_reason text default 'revoked'
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid;
  v_row public.trip_entitlements%rowtype;
  v_status text;
  v_role text;
begin
  v_uid := (select auth.uid());
  v_role := coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    ''
  );

  select * into v_row
  from public.trip_entitlements
  where id = p_entitlement_id;

  if not found then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  -- Owner or service_role (refund webhook).
  if v_role is distinct from 'service_role'
     and (v_uid is null or v_row.owner_user_id <> v_uid)
  then
    return json_build_object('ok', false, 'error', 'not_applicable');
  end if;

  perform 1 from public.groups where id = v_row.group_id for update;
  select * into v_row from public.trip_entitlements where id = p_entitlement_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  if v_row.status <> 'active' then
    return json_build_object('ok', false, 'error', v_row.status, 'status', v_row.status);
  end if;

  v_status := case
    when p_reason = 'refunded' then 'refunded'
    when p_reason = 'invalid' then 'invalid'
    else 'revoked'
  end;

  update public.trip_entitlements
  set status = v_status, updated_at = now()
  where id = p_entitlement_id;

  perform public.expire_stale_entitlements(v_row.group_id);

  return json_build_object('ok', true, 'status', v_status, 'entitlement_id', p_entitlement_id);
end;
$$;

create or replace function public.lock_trip_storekit_transaction(p_original_transaction_id text)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtext('trip_storekit_transaction'),
    hashtext(trim(p_original_transaction_id))
  );
$$;

revoke all on function public.lock_trip_storekit_transaction(text)
  from public, anon, authenticated, service_role;

create or replace function public.apply_trip_storekit_notification(
  p_notification_id text,
  p_user_id uuid,
  p_transaction_id text,
  p_original_transaction_id text,
  p_product_id text,
  p_app_account_token uuid,
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
  v_store_status text;
  v_was_refunded boolean;
  v_outcome text := 'acknowledged';
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
     or p_signed_at is null then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  perform public.lock_trip_storekit_transaction(p_original_transaction_id);

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
    return json_build_object(
      'ok', true, 'durable', true, 'accepted', true, 'duplicate', true, 'outcome', 'acknowledged'
    );
  end if;

  select t.app_account_token into v_token
    from public.premium_app_account_tokens t
   where t.user_id = p_user_id;
  if v_token is null or v_token <> p_app_account_token then
    return json_build_object('ok', false, 'error', 'account_token_mismatch');
  end if;

  select * into v_entitlement
    from public.trip_entitlements e
   where e.transaction_id = trim(p_transaction_id);
  if v_entitlement.id is not null then
    if v_entitlement.owner_user_id <> p_user_id then
      return json_build_object('ok', false, 'error', 'transaction_binding_mismatch');
    end if;
    -- Same group-then-entitlement lock order as the purchase grant.
    perform 1 from public.groups where id = v_entitlement.group_id for update;
    select * into v_entitlement
      from public.trip_entitlements e
     where e.id = v_entitlement.id
     for update;
  end if;

  update public.premium_store_notifications
     set accepted = true
   where id = v_notification.id;

  v_store_status := public.trip_store_revocation_status(trim(p_transaction_id));

  if v_entitlement.id is not null then
    if v_store_status is not null then
      -- A refund after a revoke (or vice versa) keeps the first terminal status.
      if v_entitlement.status not in ('refunded', 'revoked') then
        update public.trip_entitlements
           set status = v_store_status, updated_at = now()
         where id = v_entitlement.id
        returning * into v_entitlement;
        v_outcome := 'revoked';
      end if;
    end if;

    v_was_refunded := v_entitlement.status = 'refunded';
    perform public.expire_stale_entitlements(v_entitlement.group_id);
    select * into v_entitlement from public.trip_entitlements where id = v_entitlement.id;
    if v_was_refunded and v_store_status is null and exists (
      select 1 from public.premium_store_notifications n
       where n.transaction_id = trim(p_transaction_id) and n.accepted
         and n.notification_type = 'REFUND'
    ) then
      if v_entitlement.status in ('active', 'expired') then
        v_outcome := 'reinstated';
      elsif v_entitlement.status = 'refunded' then
        v_outcome := 'reinstatement_blocked';
      end if;
    end if;
  end if;

  return json_build_object(
    'ok', true,
    'durable', true,
    'accepted', true,
    'duplicate', false,
    'outcome', v_outcome,
    'store_status', v_store_status,
    'status', v_entitlement.status,
    'entitlement_id', v_entitlement.id
  );
end;
$$;

revoke all on function public.apply_trip_storekit_notification(
  text, uuid, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_trip_storekit_notification(
  text, uuid, text, text, text, uuid, timestamptz
) to service_role;

comment on function public.apply_trip_storekit_notification(
  text, uuid, text, text, text, uuid, timestamptz
) is 'Service-role-only, idempotent App Store REFUND/REVOKE/REFUND_REVERSED apply and acceptance for the Small Trip Pass.';

-- Same grant boundary as 20260825000000, plus: a transaction Apple currently
-- considers refunded or revoked can never be granted.
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

  perform public.lock_trip_storekit_transaction(p_original_transaction_id);

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

  perform 1 from public.groups where id = p_group_id for update;
  perform public.expire_stale_entitlements(p_group_id);

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

  if public.trip_store_revocation_status(trim(p_transaction_id)) is not null then
    return json_build_object('ok', false, 'error', 'transaction_revoked');
  end if;

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
