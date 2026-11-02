begin;

create function extensions.group_sync_aliases(p_value jsonb, p_aliases jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_result jsonb; v_text text; v_seen text[] := '{}';
begin
  case jsonb_typeof(p_value)
  when 'string' then
    v_text := p_value #>> '{}';
    while p_aliases ? v_text and not v_text = any(v_seen) loop
      v_seen := array_append(v_seen, v_text); v_text := p_aliases->>v_text;
    end loop;
    return to_jsonb(v_text);
  when 'array' then
    select coalesce(jsonb_agg(extensions.group_sync_aliases(value,p_aliases) order by ordinality),'[]')
      into v_result from jsonb_array_elements(p_value) with ordinality;
  when 'object' then
    select coalesce(jsonb_object_agg(key,extensions.group_sync_aliases(value,p_aliases)),'{}')
      into v_result from jsonb_each(p_value);
  else return p_value;
  end case;
  return v_result;
end;
$$;
revoke all on function extensions.group_sync_aliases(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.sync_group(p_group_id uuid, p_actor_id uuid, p_core_operations jsonb default '[]',
  p_location_events jsonb default '[]', p_refresh jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid()); v_operation jsonb; v_result jsonb;
  v_core_results jsonb := '[]'; v_aliases jsonb := '{}'; v_stopped boolean := false;
  v_sequence bigint; v_previous_sequence bigint; v_location_result jsonb; v_snapshot jsonb;
  v_ack jsonb; v_acknowledged boolean; v_refresh_acks jsonb := '[]';
  v_refresh_request jsonb; v_requested_at timestamptz;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;
  if p_actor_id is distinct from v_actor then raise exception 'account_changed' using errcode='28000'; end if;
  if not extensions.is_member(p_group_id) then raise exception 'not_member' using errcode='42501'; end if;
  if jsonb_typeof(p_core_operations) is distinct from 'array'
    or jsonb_typeof(p_location_events) is distinct from 'array'
    or jsonb_typeof(p_refresh) is distinct from 'object'
    or jsonb_array_length(p_core_operations)>20 or jsonb_array_length(p_location_events)>50
    or octet_length(jsonb_build_object('p_group_id',p_group_id,'p_actor_id',p_actor_id,'p_core_operations',p_core_operations,
      'p_location_events',p_location_events,'p_refresh',p_refresh)::text)>262144
    or jsonb_typeof(coalesce(p_refresh->'acknowledgements','[]')) is distinct from 'array'
    or jsonb_array_length(coalesce(p_refresh->'acknowledgements','[]'))>50 then
    raise exception 'invalid group sync envelope' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_location_events) e
    where e->>'groupId' is distinct from p_group_id::text or e->>'actorId' is distinct from v_actor::text) then
    raise exception 'location actor/group mismatch' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_group_id::text||':'||v_actor::text,0));
  for v_operation in select value from jsonb_array_elements(p_core_operations) loop
    v_sequence := (v_operation->>'sequence')::bigint;
    if v_sequence is null or (v_previous_sequence is not null and v_sequence<=v_previous_sequence) then
      raise exception 'core prefix must preserve sequence' using errcode='22023';
    end if;
    v_previous_sequence := v_sequence;
    if v_stopped then
      v_core_results := v_core_results || jsonb_build_array(jsonb_build_object(
        'operation_id',v_operation->>'operation_id','status','not_submitted'));
      continue;
    end if;
    begin
      v_result := public.apply_core_operation_v3((v_operation->>'operation_id')::uuid,p_group_id,v_actor,
        v_operation->>'entity_type',
        extensions.group_sync_aliases(to_jsonb(v_operation->>'entity_id'),v_aliases)#>>'{}',
        (v_operation->>'entity_version')::integer,v_operation->>'operation_type',
        extensions.group_sync_aliases(v_operation->'payload',v_aliases),v_sequence,
        array(select value::uuid from jsonb_array_elements_text(coalesce(v_operation->'dependency_ids','[]'))),
        (v_operation->>'created_at')::timestamptz);
    exception when others then
      v_result := jsonb_build_object('operation_id',v_operation->>'operation_id','status','retry',
        'code',sqlstate,'message',sqlerrm);
    end;
    v_core_results := v_core_results || jsonb_build_array(v_result);
    if v_result->>'status' in ('accepted','duplicate') then
      v_aliases := v_aliases || coalesce(v_result#>'{effects,destinationIdAliases}','{}');
    else v_stopped := true;
    end if;
  end loop;
  v_location_result := public.ingest_location_batch(p_location_events);
  for v_ack in select value from jsonb_array_elements(coalesce(p_refresh->'acknowledgements','[]')) loop
    v_requested_at := (v_ack->>'requestedAt')::timestamptz; v_acknowledged := false;
    if coalesce((select sharing_enabled from public.member_privacy_settings where user_id=v_actor),true)
      and exists(select 1 from public.location_upload_events e
      where e.id=(v_ack->>'eventId')::uuid and e.user_id=v_actor and e.group_id=p_group_id
        and e.ingested_at>=v_requested_at and e.captured_at>=v_requested_at
        and e.captured_at<=e.ingested_at+interval '2 minutes') then
      v_acknowledged := public.ack_my_location_refresh(p_group_id,v_requested_at);
    end if;
    v_refresh_acks := v_refresh_acks || jsonb_build_array(jsonb_build_object(
      'requestedAt',v_ack->>'requestedAt','eventId',v_ack->>'eventId','accepted',v_acknowledged));
  end loop;
  if coalesce((p_refresh->>'requestPeers')::boolean,false) then
    v_refresh_request := public.request_group_location_refresh(p_group_id);
  end if;
  v_snapshot := public.get_group_public_recovery_snapshot(p_group_id);
  v_snapshot := v_snapshot || jsonb_build_object('daily_accommodations',coalesce((
    select jsonb_agg(to_jsonb(d) order by d.stay_date,d.id)
      from public.daily_accommodations d where d.group_id=p_group_id),'[]'));
  return jsonb_build_object('coreResults',v_core_results,'locationResult',v_location_result,
    'locationReceipts',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'groupId',e.group_id,
      'capturedAt',extract(epoch from e.captured_at)*1000,'receivedAt',e.ingested_at))
      from public.location_upload_events e where e.user_id=v_actor and e.group_id=p_group_id
        and (v_location_result->'acceptedIds' ? e.id::text
          or exists(select 1 from jsonb_array_elements(coalesce(p_refresh->'acknowledgements','[]')) a
            where a->>'eventId'=e.id::text))),'[]'),
    'snapshot',v_snapshot,'refreshRequest',v_refresh_request,'refreshAcknowledgements',v_refresh_acks,
    'pendingRefreshes',coalesce((select jsonb_agg(to_jsonb(p)) from public.location_refresh_pending p
      where p.group_id=p_group_id and p.user_id=v_actor),'[]'),
    'acknowledgedIds',case when p_refresh->>'requestedAt' is not null
      then public.get_group_location_refresh_acknowledgements(p_group_id,(p_refresh->>'requestedAt')::timestamptz)
      else '[]'::jsonb end);
end;
$$;
revoke all on function public.sync_group(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.sync_group(uuid,uuid,jsonb,jsonb,jsonb) to authenticated;
commit;

