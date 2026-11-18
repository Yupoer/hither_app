drop policy if exists "commands: insert own broadcasts if authorized" on public.commands;
revoke insert on public.commands from public, anon, authenticated;

create table hither_private.command_push_budgets (
  group_id uuid not null,
  sender_id uuid not null,
  burst_window_started_at timestamptz not null,
  burst_count integer not null check (burst_count between 0 and 10),
  sustained_window_started_at timestamptz not null,
  sustained_count integer not null check (sustained_count between 0 and 120),
  primary key (group_id, sender_id),
  foreign key (group_id, sender_id)
    references public.memberships(group_id, user_id) on delete cascade
);
revoke all on table hither_private.command_push_budgets
  from public, anon, authenticated, service_role;

create function hither_private.claim_command_push_budget(
  p_operation_id uuid,
  p_group_id uuid,
  p_sender_id uuid,
  p_now timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_budget hither_private.command_push_budgets%rowtype;
begin
  insert into hither_private.command_push_budgets(
    group_id, sender_id, burst_window_started_at, burst_count,
    sustained_window_started_at, sustained_count
  ) values (p_group_id, p_sender_id, v_now, 0, v_now, 0)
  on conflict (group_id, sender_id) do nothing;

  select * into v_budget
  from hither_private.command_push_budgets
  where group_id = p_group_id and sender_id = p_sender_id
  for update;

  if exists (
    select 1 from public.core_operations o
    where o.operation_id = p_operation_id and o.status = 'accepted'
  ) then
    return 'replay';
  end if;

  if v_budget.burst_window_started_at + interval '1 minute' <= v_now then
    v_budget.burst_window_started_at := v_now;
    v_budget.burst_count := 0;
  end if;
  if v_budget.sustained_window_started_at + interval '24 hours' <= v_now then
    v_budget.sustained_window_started_at := v_now;
    v_budget.sustained_count := 0;
  end if;
  if v_budget.burst_count >= 10 or v_budget.sustained_count >= 120 then
    return 'rate_limited';
  end if;

  update hither_private.command_push_budgets
  set burst_window_started_at = v_budget.burst_window_started_at,
      burst_count = v_budget.burst_count + 1,
      sustained_window_started_at = v_budget.sustained_window_started_at,
      sustained_count = v_budget.sustained_count + 1
  where group_id = p_group_id and sender_id = p_sender_id;
  return 'claimed';
end;
$$;
revoke all on function hither_private.claim_command_push_budget(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;

create function hither_private.release_command_push_budget(
  p_group_id uuid,
  p_sender_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update hither_private.command_push_budgets
  set burst_count = greatest(burst_count - 1, 0),
      sustained_count = greatest(sustained_count - 1, 0)
  where group_id = p_group_id and sender_id = p_sender_id;
$$;
revoke all on function hither_private.release_command_push_budget(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.core_v3_enqueue_notification(
  p_operation_id uuid,
  p_group_id uuid,
  p_sender_id uuid,
  p_scope_subgroup_id uuid,
  p_payload jsonb,
  p_received_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_role text;
  v_category text;
  v_target_role text;
  v_target record;
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_candidate_count integer;
  v_targets integer := 0;
  v_ids jsonb := '[]'::jsonb;
  v_expires timestamptz;
  v_pref boolean;
  v_row public.core_notification_outbox%rowtype;
  v_request public.commands%rowtype;
  v_notification_payload jsonb := p_payload;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or octet_length(p_payload::text) > 4096
     or octet_length(coalesce(p_payload->>'message', '')) > 1024 then
    raise exception 'command payload is too large' using errcode = '22023';
  end if;
  if p_payload->>'type' is null or p_payload->>'type' not in (
    'gather', 'find_gathering', 'depart', 'rest', 'be_careful',
    'go_left', 'go_right', 'stop', 'hurry_up', 'need_restroom',
    'need_break', 'need_help', 'request_help', 'found_something',
    'request_start', 'custom'
  ) then
    raise exception 'invalid command type' using errcode = '22023';
  end if;

  select m.role into v_sender_role
  from public.memberships m
  where m.group_id = p_group_id and m.user_id = p_sender_id;
  if not found then
    raise exception 'sender is not a group member' using errcode = '42501';
  end if;
  if p_payload->>'type' in (
       'gather', 'find_gathering', 'depart', 'rest', 'be_careful',
       'go_left', 'go_right', 'stop', 'hurry_up'
     ) and v_sender_role <> 'leader' then
    raise exception 'leader command requires leader membership' using errcode = '42501';
  end if;

  v_category := case
    when p_payload->>'type' = 'request_start' and p_payload ? 'destinationId'
      then 'follower_requests'
    when v_sender_role = 'leader' then 'leader_commands'
    else 'follower_requests'
  end;
  v_target_role := case when p_payload->>'type' = 'request_start'
                        then 'leader' else 'member' end;
  v_expires := least(
    coalesce(p_received_at, now()) + interval '5 minutes',
    coalesce(nullif(p_payload->>'expiresAt', '')::timestamptz,
             coalesce(p_received_at, now()) + interval '5 minutes')
  );
  if p_payload->>'type' = 'request_start' and p_payload ? 'destinationId' then
    v_request := hither_private.persist_gathering_start(
      p_operation_id, p_group_id, p_sender_id, (p_payload->>'destinationId')::uuid
    );
    v_notification_payload := p_payload || jsonb_build_object('message', v_request.message);
  end if;
  if octet_length(v_notification_payload::text) > 4096
     or octet_length(coalesce(v_notification_payload->>'message', '')) > 1024 then
    raise exception 'command payload is too large' using errcode = '22023';
  end if;
  -- Clients may shorten the delivery window, but cannot extend it beyond five
  -- minutes. Expired operations retain their idempotent receipt without push work.
  if v_expires <= coalesce(p_received_at, now()) then
    return jsonb_build_object(
      'category', v_category,
      'targetRole', v_target_role,
      'targetCount', 0,
      'notificationIds', '[]'::jsonb,
      'expiresAt', v_expires,
      'expired', true
    );
  end if;

  select coalesce(array_agg(m.user_id order by m.user_id), '{}'::uuid[])
  into v_candidate_ids
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id <> p_sender_id
    and (
      (v_request.id is not null and m.user_id = v_request.target_user_id)
      or (
        v_request.id is null
        and (p_scope_subgroup_id is null or m.subgroup_id = p_scope_subgroup_id or m.role = 'leader')
        and (
          (p_payload->>'type' = 'request_start' and m.role = 'leader')
          or ((p_payload->>'type') is distinct from 'request_start' and not coalesce(m.solo, false))
        )
      )
    );
  v_candidate_count := cardinality(v_candidate_ids);
  -- join_group caps groups at five members, so one sender can have at most
  -- four recipients. Reject legacy or privileged over-cap groups before fan-out.
  if v_candidate_count > 4 then
    raise exception 'command recipient limit exceeded' using errcode = 'P0001';
  end if;

  if p_payload->>'type' = 'need_help' then
    insert into public.commands (id, group_id, sender_id, type, created_at, core_delivery)
    values (p_operation_id, p_group_id, p_sender_id, 'need_help', p_received_at, true);
  end if;

  for v_target in
    select m.user_id, m.role, m.subgroup_id
    from public.memberships m
    where m.group_id = p_group_id and m.user_id = any(v_candidate_ids)
  loop
    select case v_category
      when 'leader_commands' then coalesce(np.leader_commands, true)
      when 'follower_requests' then coalesce(np.follower_requests, true)
      else coalesce(np.journey, true)
    end into v_pref
    from public.notification_preferences np
    where np.user_id = v_target.user_id;
    if coalesce(v_pref, true) then
      insert into public.core_notification_outbox(
        operation_id, group_id, sender_id, target_user_id,
        category, target_role, payload, created_at, expires_at
      ) values (
        p_operation_id, p_group_id, p_sender_id, v_target.user_id,
        v_category, case when v_target.role = 'leader' then 'leader' else 'member' end,
        coalesce(v_notification_payload, '{}'::jsonb) || jsonb_build_object(
          'category', v_category,
          'groupId', p_group_id::text,
          'senderId', p_sender_id::text,
          'targetUserId', v_target.user_id::text,
          'expiresAt', v_expires
        ),
        coalesce(p_received_at, now()), v_expires
      )
      on conflict (operation_id, target_user_id) do nothing
      returning * into v_row;
      if found then
        v_targets := v_targets + 1;
        v_ids := v_ids || jsonb_build_array(v_row.id::text);
        begin
          -- Older send-push deployments consume flat routing fields while the
          -- complete command remains nested for current deployments.
          perform extensions.notify_push(jsonb_build_object(
            'type', v_row.payload->>'type',
            'message', v_row.payload->>'message',
            'latitude', v_row.payload->'latitude',
            'longitude', v_row.payload->'longitude',
            'expires_at', v_row.expires_at,
            'entity_id', v_row.operation_id,
            'operation_id', v_row.operation_id,
            'category', v_row.category,
            'group_id', v_row.group_id,
            'sender_id', v_row.sender_id,
            'target_user_id', v_row.target_user_id,
            'payload', v_row.payload
          ));
          update public.core_notification_outbox
          set delivery_status = 'attempted', attempted_at = now()
          where id = v_row.id and delivery_status = 'queued';
        exception when others then
          update public.core_notification_outbox
          set delivery_status = 'attempted', attempted_at = now()
          where id = v_row.id and delivery_status = 'queued';
        end;
      end if;
    end if;
  end loop;
  return jsonb_build_object(
    'category', v_category,
    'targetRole', v_target_role,
    'targetCount', v_targets,
    'notificationIds', v_ids,
    'expiresAt', v_expires
  );
end;
$$;
revoke all on function public.core_v3_enqueue_notification(
  uuid, uuid, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;

create or replace function public.apply_core_operation_v3(
  p_operation_id uuid,
  p_group_id uuid,
  p_actor_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_entity_version integer,
  p_operation_type text,
  p_payload jsonb,
  p_sequence bigint,
  p_dependency_ids uuid[] default '{}'::uuid[],
  p_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_budget_status text;
  v_budget_claimed boolean := false;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_actor_id is null or p_actor_id <> v_uid then
    return jsonb_build_object('status', 'conflict', 'operation_id', p_operation_id,
      'conflict', jsonb_build_object('code', 'account_changed', 'message', 'operation actor does not match auth.uid()'));
  end if;
  if p_operation_type <> 'send_command' then
    return hither_private.apply_core_operation_actor(p_operation_id, p_group_id, v_uid,
      p_entity_type, p_entity_id, p_entity_version, p_operation_type, p_payload,
      p_sequence, p_dependency_ids, p_created_at);
  end if;

  if exists (
    select 1 from public.core_operations o
    where o.operation_id = p_operation_id and o.status = 'accepted'
  ) then
    return hither_private.apply_core_operation_actor(p_operation_id, p_group_id, v_uid,
      p_entity_type, p_entity_id, p_entity_version, p_operation_type, p_payload,
      p_sequence, p_dependency_ids, p_created_at);
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object'
     or octet_length(p_payload::text) > 4096
     or octet_length(coalesce(p_payload->>'message', '')) > 1024 then
    return jsonb_build_object('status', 'conflict', 'operation_id', p_operation_id,
      'conflict', jsonb_build_object('code', 'validation', 'message', 'command payload is too large'));
  end if;
  if p_payload->>'type' is null or p_payload->>'type' not in (
    'gather', 'find_gathering', 'depart', 'rest', 'be_careful',
    'go_left', 'go_right', 'stop', 'hurry_up', 'need_restroom',
    'need_break', 'need_help', 'request_help', 'found_something',
    'request_start', 'custom'
  ) then
    return jsonb_build_object('status', 'conflict', 'operation_id', p_operation_id,
      'conflict', jsonb_build_object('code', 'validation', 'message', 'invalid command type'));
  end if;

  perform 1 from public.memberships m
  where m.group_id = p_group_id and m.user_id = v_uid
  for key share;
  if found then
    v_budget_status := hither_private.claim_command_push_budget(
      p_operation_id, p_group_id, v_uid, clock_timestamp()
    );
    if v_budget_status = 'rate_limited' then
      return jsonb_build_object('status', 'conflict', 'operation_id', p_operation_id,
        'conflict', jsonb_build_object('code', 'validation', 'message', 'command quota exceeded'));
    end if;
    v_budget_claimed := v_budget_status = 'claimed';
  end if;

  v_result := hither_private.apply_core_operation_actor(p_operation_id, p_group_id, v_uid,
    p_entity_type, p_entity_id, p_entity_version, p_operation_type, p_payload,
    p_sequence, p_dependency_ids, p_created_at);
  if v_budget_claimed and v_result->>'status' not in ('accepted', 'duplicate') then
    perform hither_private.release_command_push_budget(p_group_id, v_uid);
  end if;
  return v_result;
end;
$function$;
revoke all on function public.apply_core_operation_v3(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz
) from public, anon;
grant execute on function public.apply_core_operation_v3(
  uuid, uuid, uuid, text, text, integer, text, jsonb, bigint, uuid[], timestamptz
) to authenticated;
