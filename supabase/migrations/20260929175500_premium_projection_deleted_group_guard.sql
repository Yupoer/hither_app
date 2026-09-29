create or replace function public.recompute_team_premium_projection(p_group_id uuid)
returns public.premium_team_projections
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_active boolean;
  v_source_version text;
  v_projection public.premium_team_projections%rowtype;
begin
  if p_group_id is null then
    return null;
  end if;

  -- Membership DELETE triggers can run after the empty-group trigger removed
  -- the parent. Do not resurrect a projection for a deleted group.
  perform 1 from public.groups where id = p_group_id for key share;
  if not found then return null; end if;

  v_active := public.group_has_active_subscription_premium(p_group_id);
  select max(e.source_version)
    into v_source_version
    from public.memberships m
    join public.personal_premium_entitlements e on e.user_id = m.user_id
   where m.group_id = p_group_id
     and e.source in ('app_store', 'promo')
     and public.personal_premium_is_live(e.status, e.expires_at);

  v_source_version := coalesce(v_source_version, 'premium-free-v1');

  insert into public.premium_team_projections (
    group_id, team_premium_active, source_version, updated_at
  ) values (
    p_group_id, v_active, v_source_version, now()
  )
  on conflict (group_id) do update
    set team_premium_active = excluded.team_premium_active,
        source_version = excluded.source_version,
        updated_at = excluded.updated_at
  returning * into v_projection;
  return v_projection;
end;
$$;
