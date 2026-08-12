-- #170: Fix custom command category drift when sender membership is missing.
-- Missing role must not default to leader_commands (would hide follower custom
-- under the wrong preference and mis-title the push). Prefer follower_requests.

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
    select case when m.role = 'leader' then 'leader_commands' else 'follower_requests' end
      into v_category
      from public.memberships m
     where m.group_id = new.group_id
       and m.user_id = new.sender_id
     limit 1;
    -- Explicit: only leader role → leader_commands; missing row → follower_requests.
    v_category := coalesce(v_category, 'follower_requests');
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
