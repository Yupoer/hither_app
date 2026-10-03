-- Extend the UUID receipt processor without changing its replay/actor guards.
do $migration$
declare definition text; anchor text;
begin
  definition := replace(pg_get_functiondef('public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamptz)'::regprocedure), E'\r\n', E'\n');
  anchor := '  -- Determine the target before version checks';
  if strpos(definition, anchor) = 0 then raise exception 'v3 authorization anchor missing'; end if;
  definition := replace(definition, anchor, $authorization$
  if p_operation_type = 'set_solo' then
    if p_entity_type <> 'itinerary' or p_entity_id <> v_uid::text
       or v_payload->>'userId' is distinct from v_uid::text
       or not extensions.is_member(p_group_id) then
      return public.core_v3_conflict(
        p_operation_id, p_group_id, v_uid, p_entity_type, p_entity_id,
        p_entity_version, p_operation_type, v_payload, p_sequence,
        p_dependency_ids, p_created_at, 'unauthorized', 'solo status is user scoped',
        null, null, v_device_id, v_scope_key, v_session_id, v_occurred_at);
    end if;
  end if;
  -- Determine the target before version checks$authorization$);
  anchor := '    ''resolve_gather_point_request'',''replace_snapshot''';
  if strpos(definition, anchor) = 0 then raise exception 'v3 mergeable anchor missing'; end if;
  definition := replace(definition, anchor, anchor || ',''set_solo''');
  anchor := '    if p_operation_type = ''set_trip_details'' then';
  if strpos(definition, anchor) = 0 then raise exception 'v3 mutation anchor missing'; end if;
  definition := replace(definition, anchor, $mutation$
    if p_operation_type = 'set_solo' then
      if jsonb_typeof(v_payload->'solo') is distinct from 'boolean' then
        raise exception 'invalid solo status' using errcode = '22023';
      end if;
      perform public.set_solo(p_group_id, (v_payload->>'solo')::boolean);
      v_state := jsonb_build_object('userId', v_uid::text, 'solo', (v_payload->>'solo')::boolean);
    elsif p_operation_type = 'set_trip_details' then$mutation$);
  execute definition;
end;
$migration$;

-- Keep one receipt per recipient: bounded storage, explicit version equality.
create table public.location_refresh_acknowledgements (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null,
  acknowledged_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.location_refresh_acknowledgements enable row level security;
revoke all on table public.location_refresh_acknowledgements from public, anon, authenticated;

create or replace function public.ack_my_location_refresh(p_group_id uuid, p_requested_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_deleted integer;
begin
  if v_uid is null or not extensions.is_member(p_group_id) then return false; end if;
  delete from public.location_refresh_pending where group_id = p_group_id
    and user_id = v_uid and requested_at = p_requested_at;
  get diagnostics v_deleted = row_count;
  if v_deleted = 1 then
    insert into public.location_refresh_acknowledgements(group_id, user_id, requested_at)
      values (p_group_id, v_uid, p_requested_at)
      on conflict (group_id, user_id) do update set requested_at = excluded.requested_at, acknowledged_at = now();
    return true;
  end if;
  -- Lost ACK response can be retried without changing another request version.
  return exists (select 1 from public.location_refresh_acknowledgements a
    where a.group_id = p_group_id and a.user_id = v_uid and a.requested_at = p_requested_at);
end;
$$;

create function public.get_group_location_refresh_acknowledgements(p_group_id uuid, p_requested_at timestamptz)
returns jsonb language plpgsql security definer stable set search_path = '' as $$
begin
  if not extensions.is_member(p_group_id) then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(a.user_id::text order by a.user_id), '[]'::jsonb)
    from public.location_refresh_acknowledgements a where a.group_id = p_group_id
      and a.requested_at = p_requested_at
      and exists (select 1 from public.memberships m where m.group_id = a.group_id and m.user_id = a.user_id)
      and public.anonymous_access_is_active(a.user_id));
end;
$$;
revoke all on function public.get_group_location_refresh_acknowledgements(uuid, timestamptz) from public, anon;
grant execute on function public.get_group_location_refresh_acknowledgements(uuid, timestamptz) to authenticated;
