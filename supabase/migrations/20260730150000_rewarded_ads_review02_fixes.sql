-- Review-02: redeem idempotent replay must bind product_code + group_id.
-- Do not leak another team's extra-point credits via mismatched p_group_id.

create or replace function public.redeem_store_product(
  p_product_code text,
  p_group_id uuid default null,
  p_client_request_key text default null
)
returns json
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_product public.store_product_catalog%rowtype;
  v_wallet public.token_wallets%rowtype;
  v_is_member boolean;
  v_member_count integer;
  v_kind text;
  v_days integer;
  v_credits integer;
  v_redemption_id text;
  v_ent public.trip_entitlements%rowtype;
  v_blocking public.trip_entitlements%rowtype;
  v_started timestamptz;
  v_expires timestamptz;
  v_new_balance integer;
  v_ue public.user_entitlements%rowtype;
  v_credit_bal integer;
  v_prior public.token_ledger%rowtype;
  v_req_key text;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public.is_auth_user_anonymous(v_uid) then
    return json_build_object('ok', false, 'error', 'registration_required');
  end if;

  case p_product_code
    when 'team_premium_1d' then
      v_kind := 'team_premium_days'; v_days := 1; v_credits := 0;
    when 'team_premium_3d' then
      v_kind := 'team_premium_days'; v_days := 3; v_credits := 0;
    when 'team_premium_7d' then
      v_kind := 'team_premium_days'; v_days := 7; v_credits := 0;
    when 'team_extra_points_3' then
      v_kind := 'team_extra_points'; v_days := 0; v_credits := 3;
    when 'team_extra_points_10' then
      v_kind := 'team_extra_points'; v_days := 0; v_credits := 10;
    when 'personal_live_activity_lifetime' then
      v_kind := 'personal_live_activity_lifetime'; v_days := 0; v_credits := 0;
    else
      return json_build_object('ok', false, 'error', 'product_unavailable');
  end case;

  select * into v_product
  from public.store_product_catalog
  where code = p_product_code
  for share;
  if not found or not v_product.active then
    return json_build_object('ok', false, 'error', 'product_unavailable');
  end if;

  v_req_key := nullif(trim(coalesce(p_client_request_key, '')), '');
  if v_req_key is not null then
    if length(v_req_key) > 128 then
      return json_build_object('ok', false, 'error', 'invalid_request_key');
    end if;
    v_redemption_id := 'redeem:' || v_uid::text || ':' || v_req_key;

    select * into v_prior
    from public.token_ledger
    where external_ref = v_redemption_id
    limit 1;

    if found then
      -- Bind replay to original product + group (no cross-product / cross-team leak).
      if v_prior.product_code is distinct from p_product_code
         or v_prior.group_id is distinct from p_group_id then
        return json_build_object(
          'ok', false,
          'error', 'idempotency_conflict',
          'redemption_id', v_redemption_id
        );
      end if;

      return json_build_object(
        'ok', true,
        'already', true,
        'product_code', coalesce(v_prior.product_code, p_product_code),
        'balance', v_prior.balance_after,
        'redemption_id', v_redemption_id,
        'extra_point_credits', case
          when v_prior.group_id is not null then (
            select balance from public.trip_extra_point_credits
            where group_id = v_prior.group_id
          )
          else null
        end,
        'live_activity_personal', public.user_has_live_activity_lifetime(v_uid)
      );
    end if;
  else
    v_redemption_id := 'redeem:' || replace(gen_random_uuid()::text, '-', '');
  end if;

  v_wallet := public.ensure_token_wallet(v_uid);
  if v_wallet.balance < v_product.price_tokens then
    return json_build_object(
      'ok', false,
      'error', 'insufficient_balance',
      'balance', v_wallet.balance,
      'price', v_product.price_tokens,
      'shortfall', v_product.price_tokens - v_wallet.balance
    );
  end if;

  if v_product.scope = 'team' then
    if p_group_id is null then
      return json_build_object('ok', false, 'error', 'group_required');
    end if;

    perform 1 from public.groups where id = p_group_id for update;

    select exists(
      select 1 from public.memberships m
      where m.group_id = p_group_id and m.user_id = v_uid
    ) into v_is_member;
    if not v_is_member then
      return json_build_object('ok', false, 'error', 'not_member');
    end if;

    perform public.expire_stale_entitlements(p_group_id);
    v_member_count := public.group_member_count(p_group_id);
  end if;

  if v_kind = 'team_premium_days' then
    if v_days not in (1, 3, 7) then
      return json_build_object('ok', false, 'error', 'invalid');
    end if;
    if v_member_count < 2 or v_member_count > 5 then
      return json_build_object(
        'ok', false,
        'error', 'not_applicable',
        'message', 'Premium day pass requires 2–5 members'
      );
    end if;

    if public.group_has_active_premium(p_group_id) then
      select * into v_blocking
      from public.trip_entitlements e
      where e.group_id = p_group_id
        and e.status = 'active'
        and (e.expires_at is null or e.expires_at > now())
      order by e.created_at desc
      limit 1;

      if not found then
        return json_build_object(
          'ok', false,
          'error', 'not_applicable',
          'message', 'team already has lifetime or non-token premium'
        );
      end if;

      if v_blocking.source is distinct from 'token_redemption' then
        return json_build_object(
          'ok', false,
          'error', 'not_applicable',
          'message', 'team already has purchase/promo/grant premium',
          'source', v_blocking.source
        );
      end if;

      v_started := v_blocking.started_at;
      v_expires := coalesce(v_blocking.expires_at, now()) + make_interval(days => v_days);

      update public.token_wallets
      set balance = balance - v_product.price_tokens,
          updated_at = now()
      where user_id = v_uid
        and balance >= v_product.price_tokens
      returning balance into v_new_balance;
      if not found then
        return json_build_object(
          'ok', false,
          'error', 'insufficient_balance',
          'price', v_product.price_tokens
        );
      end if;

      insert into public.token_ledger (
        user_id, delta, balance_after, reason, external_ref, product_code, group_id, metadata
      ) values (
        v_uid, -v_product.price_tokens, v_new_balance, 'redeem_product',
        v_redemption_id, v_product.code, p_group_id,
        jsonb_build_object('days', v_days, 'stacked', true)
      );

      update public.trip_entitlements
      set expires_at = v_expires,
          updated_at = now()
      where id = v_blocking.id
      returning * into v_ent;

      return json_build_object(
        'ok', true,
        'product_code', v_product.code,
        'balance', v_new_balance,
        'redemption_id', v_redemption_id,
        'entitlement_id', v_ent.id,
        'started_at', v_ent.started_at,
        'expires_at', v_ent.expires_at,
        'source', 'token_redemption',
        'stacked', true
      );
    end if;

    v_started := now();
    v_expires := now() + make_interval(days => v_days);

    update public.token_wallets
    set balance = balance - v_product.price_tokens,
        updated_at = now()
    where user_id = v_uid
      and balance >= v_product.price_tokens
    returning balance into v_new_balance;
    if not found then
      return json_build_object(
        'ok', false,
        'error', 'insufficient_balance',
        'price', v_product.price_tokens
      );
    end if;

    insert into public.token_ledger (
      user_id, delta, balance_after, reason, external_ref, product_code, group_id, metadata
    ) values (
      v_uid, -v_product.price_tokens, v_new_balance, 'redeem_product',
      v_redemption_id, v_product.code, p_group_id,
      jsonb_build_object('days', v_days, 'stacked', false)
    );

    insert into public.trip_entitlements (
      group_id, owner_user_id, plan_code, status, source,
      started_at, expires_at, transaction_id
    ) values (
      p_group_id, v_uid, 'small_trip_pass', 'active', 'token_redemption',
      v_started, v_expires, v_redemption_id
    )
    returning * into v_ent;

    return json_build_object(
      'ok', true,
      'product_code', v_product.code,
      'balance', v_new_balance,
      'redemption_id', v_redemption_id,
      'entitlement_id', v_ent.id,
      'started_at', v_ent.started_at,
      'expires_at', v_ent.expires_at,
      'source', 'token_redemption',
      'stacked', false
    );
  end if;

  if v_kind = 'team_extra_points' then
    if v_credits not in (3, 10) then
      return json_build_object('ok', false, 'error', 'invalid');
    end if;

    update public.token_wallets
    set balance = balance - v_product.price_tokens,
        updated_at = now()
    where user_id = v_uid
      and balance >= v_product.price_tokens
    returning balance into v_new_balance;
    if not found then
      return json_build_object(
        'ok', false,
        'error', 'insufficient_balance',
        'price', v_product.price_tokens
      );
    end if;

    insert into public.token_ledger (
      user_id, delta, balance_after, reason, external_ref, product_code, group_id, metadata
    ) values (
      v_uid, -v_product.price_tokens, v_new_balance, 'redeem_product',
      v_redemption_id, v_product.code, p_group_id,
      jsonb_build_object('credits', v_credits)
    );

    insert into public.trip_extra_point_credits (group_id, balance)
    values (p_group_id, v_credits)
    on conflict (group_id) do update
    set balance = public.trip_extra_point_credits.balance + excluded.balance,
        updated_at = now()
    returning balance into v_credit_bal;

    return json_build_object(
      'ok', true,
      'product_code', v_product.code,
      'balance', v_new_balance,
      'redemption_id', v_redemption_id,
      'extra_point_credits', v_credit_bal
    );
  end if;

  if v_kind = 'personal_live_activity_lifetime' then
    if public.user_has_live_activity_lifetime(v_uid) then
      return json_build_object(
        'ok', false,
        'error', 'not_applicable',
        'message', 'live activity already unlocked'
      );
    end if;

    update public.token_wallets
    set balance = balance - v_product.price_tokens,
        updated_at = now()
    where user_id = v_uid
      and balance >= v_product.price_tokens
    returning balance into v_new_balance;
    if not found then
      return json_build_object(
        'ok', false,
        'error', 'insufficient_balance',
        'price', v_product.price_tokens
      );
    end if;

    insert into public.token_ledger (
      user_id, delta, balance_after, reason, external_ref, product_code, metadata
    ) values (
      v_uid, -v_product.price_tokens, v_new_balance, 'redeem_product',
      v_redemption_id, v_product.code,
      jsonb_build_object('kind', 'personal_live_activity_lifetime')
    );

    insert into public.user_entitlements (
      user_id, entitlement_code, status, source, transaction_ref
    ) values (
      v_uid, 'personal_live_activity_lifetime', 'active', 'token_redemption', v_redemption_id
    )
    returning * into v_ue;

    return json_build_object(
      'ok', true,
      'product_code', v_product.code,
      'balance', v_new_balance,
      'redemption_id', v_redemption_id,
      'live_activity_personal', true,
      'entitlement_id', v_ue.id
    );
  end if;

  return json_build_object('ok', false, 'error', 'invalid');
exception
  when unique_violation then
    if v_req_key is not null then
      select * into v_prior
      from public.token_ledger
      where external_ref = 'redeem:' || v_uid::text || ':' || v_req_key
      limit 1;
      if found then
        if v_prior.product_code is distinct from p_product_code
           or v_prior.group_id is distinct from p_group_id then
          return json_build_object('ok', false, 'error', 'idempotency_conflict');
        end if;
        return json_build_object(
          'ok', true,
          'already', true,
          'product_code', coalesce(v_prior.product_code, p_product_code),
          'balance', v_prior.balance_after,
          'redemption_id', v_prior.external_ref
        );
      end if;
    end if;
    return json_build_object('ok', false, 'error', 'conflict');
  when check_violation then
    return json_build_object('ok', false, 'error', 'invalid');
end;
$$;

revoke all on function public.redeem_store_product(text, uuid, text) from public, anon;
grant execute on function public.redeem_store_product(text, uuid, text) to authenticated;
