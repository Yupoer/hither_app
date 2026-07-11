-- Add subscription metadata columns to profiles
alter table public.profiles
  add column if not exists pro_plan text,
  add column if not exists pro_purchased_at timestamptz,
  add column if not exists pro_expires_at timestamptz;

-- Create promo_codes table
create table if not exists public.promo_codes (
  code text primary key,
  plan_name text not null,
  expires_at timestamptz,
  remaining_uses int, -- null means infinite uses
  created_at timestamptz default now()
);

alter table public.promo_codes enable row level security;
-- Only allow selecting if you want to verify code existence, 
-- but actually the RPC is SECURITY DEFINER so we don't strictly need public select access.
-- We'll keep it locked down to just the RPC.

-- Insert the highest-level promo code as requested by the user
insert into public.promo_codes (code, plan_name, expires_at, remaining_uses)
values ('PROMO2026', 'Lifetime Premium', null, null)
on conflict (code) do update 
set plan_name = excluded.plan_name, 
    expires_at = excluded.expires_at, 
    remaining_uses = excluded.remaining_uses;

-- RPC for redeeming promo codes
create or replace function public.redeem_promo_code(p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_is_anonymous boolean;
  v_promo public.promo_codes%rowtype;
begin
  -- Get the calling user
  v_uid := (select auth.uid());
  if v_uid is null then
    return json_build_object('success', false, 'error', 'Not authenticated');
  end if;

  -- Check if user is anonymous (jwt claim 'is_anonymous')
  -- We extract this from the current token
  v_is_anonymous := coalesce((current_setting('request.jwt.claims', true)::json->>'is_anonymous')::boolean, false);
  
  if v_is_anonymous then
    return json_build_object('success', false, 'error', 'Anonymous accounts cannot upgrade to Pro. Please register first.');
  end if;

  -- Fetch the promo code
  select * into v_promo from public.promo_codes where code = p_code;
  if not found then
    return json_build_object('success', false, 'error', 'Invalid promo code');
  end if;

  -- Check expiration
  if v_promo.expires_at is not null and v_promo.expires_at < now() then
    return json_build_object('success', false, 'error', 'Promo code has expired');
  end if;

  -- Check remaining uses
  if v_promo.remaining_uses is not null and v_promo.remaining_uses <= 0 then
    return json_build_object('success', false, 'error', 'Promo code has reached its usage limit');
  end if;

  -- Deduct usage if not infinite
  if v_promo.remaining_uses is not null then
    update public.promo_codes 
    set remaining_uses = remaining_uses - 1 
    where code = p_code;
  end if;

  -- Update the user's profile
  update public.profiles
  set 
    pro = true,
    pro_plan = v_promo.plan_name,
    pro_purchased_at = now()
  where id = v_uid;

  return json_build_object('success', true, 'plan_name', v_promo.plan_name);
end;
$$;

-- Grant execution to authenticated users
grant execute on function public.redeem_promo_code(text) to authenticated;
