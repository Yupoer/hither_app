-- Quick-add is one transaction in both the durable and direct RPC paths.
create or replace function public.promote_itinerary_first_stop(p_destination_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_item public.itinerary_items%rowtype;
  v_position integer;
  v_tail public.itinerary_items%rowtype;
  v_count integer;
begin
  select * into v_item from public.itinerary_items where id = p_destination_id;
  if not found then raise exception 'destination not found' using errcode = 'P0002'; end if;
  if v_item.day is null or v_item.day < 1 or v_item.kind <> 'stop' or v_item.closed_at is not null then
    raise exception 'quick add requires an open scheduled stop' using errcode = '22023';
  end if;
  if not exists (select 1 from public.memberships m where m.group_id = v_item.group_id
    and m.user_id = (select auth.uid()) and (m.role = 'leader'
      or (v_item.subgroup_id is not null and m.subgroup_id = v_item.subgroup_id))) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform 1 from public.groups where id = v_item.group_id for update;
  select min(i.position) into v_position from public.itinerary_items i
    where i.group_id = v_item.group_id and i.subgroup_id is not distinct from v_item.subgroup_id
      and i.day = v_item.day and i.id <> v_item.id and i.closed_at is null and i.kind = 'stop';
  if v_position is null then
    select count(*) into v_count from public.itinerary_items i
      where i.group_id = v_item.group_id and i.subgroup_id is not distinct from v_item.subgroup_id
        and i.day = v_item.day and i.id <> v_item.id;
    if v_count = 0 then return; end if;
    select * into v_tail from public.itinerary_items i
      where i.group_id = v_item.group_id and i.subgroup_id is not distinct from v_item.subgroup_id
        and i.day = v_item.day and i.id <> v_item.id order by i.position desc limit 1;
    v_position := case when v_count > 1 and v_tail.kind = 'accommodation' and v_tail.stay_anchor
      then v_tail.position else coalesce(v_tail.position, -1) + 1 end;
  end if;
  update public.itinerary_items i set position = i.position + 1
    where i.group_id = v_item.group_id and i.subgroup_id is not distinct from v_item.subgroup_id
      and i.day = v_item.day and i.id <> v_item.id and i.position >= v_position and i.position < v_item.position;
  update public.itinerary_items set position = v_position where id = v_item.id;
end;
$$;
revoke all on function public.promote_itinerary_first_stop(uuid) from public, anon, authenticated;

create or replace function public.quick_add_itinerary_item(
  p_group_id uuid, p_subgroup_id uuid, p_title text, p_address text,
  p_latitude double precision, p_longitude double precision, p_day integer,
  p_kind text default 'stop', p_stay_anchor boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_day is null or p_day < 1 or p_kind <> 'stop' or p_stay_anchor then
    raise exception 'quick add requires a scheduled stop' using errcode = '22023';
  end if;
  v_id := public.add_itinerary_item(p_group_id, p_subgroup_id, p_title, p_address,
    p_latitude, p_longitude, p_day, p_kind, p_stay_anchor);
  perform public.promote_itinerary_first_stop(v_id);
  return v_id;
end;
$$;
revoke all on function public.quick_add_itinerary_item(uuid,uuid,text,text,double precision,double precision,integer,text,boolean) from public, anon;
grant execute on function public.quick_add_itinerary_item(uuid,uuid,text,text,double precision,double precision,integer,text,boolean) to authenticated;

-- Preserve all later auth/navigation fixes in the live v3 definition.
do $patch$
declare
  definition text;
  anchor text := E'        v_provider_id, v_uid\n      );\n      v_state := public.core_itinerary_state(p_group_id);';
begin
  definition := replace(pg_get_functiondef(
    'public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamptz)'::regprocedure), E'\r\n', E'\n');
  if position(anchor in definition) = 0 then raise exception 'quick-add v3 anchor missing'; end if;
  execute replace(definition, anchor, E'        v_provider_id, v_uid\n      );\n      if v_payload->>''placement'' = ''firstStop'' then\n        perform public.promote_itinerary_first_stop(v_destination_id);\n      elsif v_payload ? ''placement'' then\n        raise exception ''invalid destination placement'' using errcode = ''22023'';\n      end if;\n      v_state := public.core_itinerary_state(p_group_id);');
end;
$patch$;
