alter table public.commands
  add column destination_id uuid references public.itinerary_items(id) on delete cascade,
  add column target_user_id uuid references auth.users(id) on delete cascade,
  add column core_delivery boolean not null default false,
  add column request_status text check (request_status in ('pending', 'approved', 'rejected')),
  add constraint commands_start_request_shape check (
    (destination_id is null and target_user_id is null and request_status is null)
    or (type = 'request_start' and message is not null and destination_id is not null
        and target_user_id is not null and request_status is not null)
  );

drop policy "commands: select if member" on public.commands;
create policy "commands: select if recipient or group broadcast" on public.commands
  for select to authenticated using (
    extensions.is_member(group_id)
    and (
      (type <> 'request_start' and not core_delivery)
      or sender_id = (select auth.uid())
      or (type = 'need_help' and core_delivery and public.can_manage_itinerary_scope(group_id, null))
      or (
        target_user_id = (select auth.uid())
        and exists (
          select 1 from public.itinerary_items i
          where i.id = commands.destination_id
            and public.can_manage_itinerary_scope(commands.group_id, i.subgroup_id)
        )
      )
      or (type = 'request_start' and target_user_id is null
          and public.can_manage_itinerary_scope(group_id, null))
    )
  );

drop policy "commands: insert own if authorized" on public.commands;
create policy "commands: insert own broadcasts if authorized" on public.commands
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and extensions.is_member(group_id)
    and destination_id is null and target_user_id is null and request_status is null and not core_delivery
    and (type in ('need_restroom','need_break','need_help','found_something','request_start','custom')
      or exists (select 1 from public.memberships m where m.group_id = commands.group_id
        and m.user_id = (select auth.uid()) and m.role = 'leader'))
  );

create or replace function public.on_command_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
begin
  if new.core_delivery then
    return new;
  end if;
  if new.type = 'custom' then
    select case when m.role = 'leader' then 'leader_commands' else 'follower_requests' end
      into v_category
      from public.memberships m
     where m.group_id = new.group_id
       and m.user_id = new.sender_id
     limit 1;
    v_category := coalesce(v_category, 'follower_requests');
  elsif new.type in ('need_restroom','need_break','need_help','found_something','request_start') then
    v_category := 'follower_requests';
  else
    v_category := 'leader_commands';
  end if;

  perform extensions.notify_push(jsonb_build_object(
    'category', v_category,
    'group_id', new.group_id,
    'sender_id', new.sender_id,
    'target_user_id', new.target_user_id,
    'type', new.type,
    'message', new.message,
    'entity_id', new.id
  ));
  return new;
end;
$$;

drop policy "core_operations: select own or leader" on public.core_operations;
create policy "core_operations: select own or group operation" on public.core_operations
  for select to authenticated using (
    actor_id = (select auth.uid())
    or (extensions.is_member(group_id)
      and not (operation_type = 'send_command' and payload @> '{"type":"request_start"}' and payload ? 'destinationId'))
  );

drop policy "core notification outbox: own or group read" on public.core_notification_outbox;
create policy "core notification outbox: authorized reader" on public.core_notification_outbox
  for select to authenticated using (
    case when payload @> '{"type":"request_start"}' and payload ? 'destinationId'
      then exists (
        select 1 from public.commands c where c.id = core_notification_outbox.operation_id
      )
      else target_user_id = (select auth.uid()) or extensions.is_member(group_id)
    end
  );

create function hither_private.persist_gathering_start(
  p_operation_id uuid, p_group_id uuid, p_actor uuid, p_destination_id uuid
)
returns public.commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.memberships%rowtype;
  v_item public.itinerary_items%rowtype;
  v_recipient uuid;
  v_request public.commands%rowtype;
begin
  select * into v_member from public.memberships
    where group_id = p_group_id and user_id = p_actor;
  if not found then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  select * into v_item from public.itinerary_items
  where id = p_destination_id and group_id = p_group_id
    and closed_at is null and day is not null
    and latitude is not null and longitude is not null;
  if not found then
    raise exception 'destination cannot be started' using errcode = '55000';
  end if;
  if v_item.subgroup_id is not null and v_item.subgroup_id is distinct from v_member.subgroup_id
     and v_member.role <> 'leader' then
    raise exception 'request subgroup must match membership' using errcode = '42501';
  end if;

  select m.user_id into v_recipient
    from public.memberships m
    left join public.subgroups s on s.id = v_item.subgroup_id and s.group_id = p_group_id
    where m.group_id = p_group_id and m.user_id <> p_actor
      and hither_private.can_manage_itinerary_scope_actor(p_group_id, v_item.subgroup_id, m.user_id)
    order by (m.user_id is not distinct from s.leader_id) desc, m.user_id
    limit 1;
  if v_recipient is null then
    raise exception 'destination has no available organizer' using errcode = '55000';
  end if;

  insert into public.commands (id, group_id, sender_id, type, message, destination_id, target_user_id, request_status, core_delivery)
  values (p_operation_id, p_group_id, p_actor, 'request_start', v_item.title, v_item.id, v_recipient, 'pending', true)
  returning * into v_request;
  return v_request;
end;
$$;

revoke all on function hither_private.persist_gathering_start(uuid, uuid, uuid, uuid) from public, anon, authenticated;

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
  v_targets integer := 0;
  v_ids jsonb := '[]'::jsonb;
  v_expires timestamptz;
  v_pref boolean;
  v_row public.core_notification_outbox%rowtype;
  v_request public.commands%rowtype;
  v_notification_payload jsonb := p_payload;
begin
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

  if p_payload->>'type' = 'request_start' and p_payload ? 'destinationId' then
    v_request := hither_private.persist_gathering_start(
      p_operation_id, p_group_id, p_sender_id, (p_payload->>'destinationId')::uuid
    );
    v_notification_payload := p_payload || jsonb_build_object('message', v_request.message);
  end if;

  v_category := case when v_request.id is not null then 'follower_requests'
                     when v_sender_role = 'leader' then 'leader_commands'
                     else 'follower_requests' end;
  v_target_role := case when p_payload->>'type' = 'request_start'
                        then 'leader' else 'member' end;
  v_expires := least(
    coalesce(p_received_at, now()) + interval '5 minutes',
    coalesce(nullif(p_payload->>'expiresAt', '')::timestamptz,
             coalesce(p_received_at, now()) + interval '5 minutes')
  );
  -- A client may shorten a TTL but may never extend the server five-minute
  -- delivery window.  Already expired commands are accepted durable no-ops:
  -- keep the receipt, but do not create a notification or call APNs.
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

  if p_payload->>'type' = 'need_help' then
    insert into public.commands (id, group_id, sender_id, type, created_at, core_delivery)
    values (p_operation_id, p_group_id, p_sender_id, 'need_help', p_received_at, true);
  end if;

  for v_target in
    select m.user_id, m.role, m.subgroup_id
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
      )
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
          -- send-push consumes a flat PushPayload.  Keep the complete command
          -- under payload as well, but mirror its routing fields at top level
          -- for older edge-function versions and include the server TTL.
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

create function public.resolve_gathering_start(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_request public.commands%rowtype;
  v_scope uuid;
  v_scope_key text;
  v_result jsonb;
begin
  select * into v_request from public.commands
    where id = p_request_id and target_user_id = v_actor;
  if not found then
    raise exception 'start request is not available to this user' using errcode = '42501';
  end if;
  select subgroup_id into v_scope from public.itinerary_items
    where id = v_request.destination_id and group_id = v_request.group_id;
  if not found or not public.can_manage_itinerary_scope(v_request.group_id, v_scope) then
    raise exception 'destination organizer required' using errcode = '42501';
  end if;
  v_scope_key := coalesce(v_scope::text, 'main');
  perform pg_advisory_xact_lock(hashtext(v_request.group_id::text || ':v3:' || v_scope_key));
  select request_status into v_request.request_status from public.commands
    where id = p_request_id for update;
  if not found or v_request.request_status <> 'pending' then
    return;
  end if;

  if p_approve and not exists (
    select 1 from public.navigation_sessions s where s.group_id = v_request.group_id
      and s.scope_key = v_scope_key and s.status = 'active'
      and s.destination_id = v_request.destination_id
  ) then
    v_result := hither_private.apply_core_operation_actor(
      gen_random_uuid(), v_request.group_id, v_actor,
      'active_gathering', v_request.group_id::text, 0, 'start_gathering',
      jsonb_build_object('destinationId', v_request.destination_id,
                         'navigationRequestId', v_request.id, 'scopeSubgroupId', v_scope),
      1
    );
    if v_result->>'status' not in ('accepted', 'duplicate') then
      raise exception '%' , coalesce(v_result->'conflict'->>'message', 'navigation start rejected')
        using errcode = '55000';
    end if;
  end if;

  update public.commands
    set request_status = case when p_approve then 'approved' else 'rejected' end
    where id = v_request.id;
end;
$$;

revoke all on function public.resolve_gathering_start(uuid, boolean) from public, anon;
grant execute on function public.resolve_gathering_start(uuid, boolean) to authenticated;
