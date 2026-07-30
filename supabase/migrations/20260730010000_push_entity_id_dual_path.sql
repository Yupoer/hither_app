-- Ticket 02 / SUG-3: include stable entity_id in notify_push payloads so
-- APNs/FCM data and client Realtime local can share dual-path event identity.
--
-- BUG-6: preserve custom-command role-based category from
-- 20260729113543_request_start_command.sql (follower custom → follower_requests).

-- commands: entity_id = command row id; custom uses sender membership role
create or replace function public.on_command_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
begin
  if new.type = 'custom' then
    select case when m.role = 'follower' then 'follower_requests' else 'leader_commands' end
      into v_category
      from public.memberships m
     where m.group_id = new.group_id
       and m.user_id = new.sender_id
     limit 1;
    v_category := coalesce(v_category, 'leader_commands');
  elsif new.type in (
    'need_restroom','need_break','need_help','found_something','request_start'
  ) then
    v_category := 'follower_requests';
  else
    v_category := 'leader_commands';
  end if;

  perform extensions.notify_push(jsonb_build_object(
    'category', v_category,
    'group_id', new.group_id,
    'sender_id', new.sender_id,
    'type', new.type,
    'message', new.message,
    'entity_id', new.id
  ));
  return new;
end;
$$;

-- itinerary_items: entity_id = destination id
create or replace function public.on_itinerary_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform extensions.notify_push(jsonb_build_object(
    'category', 'add_gathering',
    'group_id', new.group_id,
    'sender_id', new.created_by,
    'title', new.title,
    'entity_id', new.id,
    'destination_id', new.id
  ));
  return new;
end;
$$;

-- SUG-4: straggler dual-path — entity_id = group_alerts.id (matches Realtime row.id)
create or replace function public.on_group_alert_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform extensions.notify_push(jsonb_build_object(
    'category', new.kind,
    'group_id', new.group_id,
    'sender_id', new.sender_id,
    'member_id', new.member_id,
    'member_name', new.member_name,
    'distance_m', new.distance_m,
    'entity_id', new.id
  ));
  return new;
end;
$$;
