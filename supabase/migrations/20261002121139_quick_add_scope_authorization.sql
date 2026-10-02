create or replace function public.quick_add_itinerary_item(
  p_group_id uuid, p_subgroup_id uuid, p_title text, p_address text,
  p_latitude double precision, p_longitude double precision, p_day integer,
  p_kind text default 'stop', p_stay_anchor boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  -- Reuse the current role and anonymous-expiry rules before bypassing RLS for the lock.
  if not public.can_manage_itinerary_scope(p_group_id, p_subgroup_id, (select auth.uid())) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_day is null or p_day < 1 or p_kind <> 'stop' or p_stay_anchor then
    raise exception 'quick add requires a scheduled stop' using errcode = '22023';
  end if;
  v_id := public.add_itinerary_item(p_group_id, p_subgroup_id, p_title, p_address,
    p_latitude, p_longitude, p_day, p_kind, p_stay_anchor);
  perform public.promote_itinerary_first_stop(v_id);
  return v_id;
end;
$$;
