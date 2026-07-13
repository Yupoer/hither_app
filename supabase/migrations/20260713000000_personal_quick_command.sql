-- Persist account-scoped UI preferences. The object is intentionally open so
-- future personal preferences can be added without another profile column.
alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- A custom quick command replaces one role-specific shortcut in the client.
-- Keep the command type permissive at the database boundary so the existing
-- notification pipeline can carry the account-defined message.
alter table public.commands
  drop constraint if exists commands_type_check;

alter table public.commands
  add constraint commands_type_check check (
    type in (
      'gather',
      'find_gathering',
      'depart',
      'rest',
      'be_careful',
      'go_left',
      'go_right',
      'stop',
      'hurry_up',
      'need_restroom',
      'need_break',
      'found_something',
      'need_help',
      'custom'
    )
  );

-- The custom slot is role-scoped in the client, so classify it from the
-- sender's membership instead of assuming every `custom` command is a leader
-- command.
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
  elsif new.type in ('need_restroom','need_break','need_help','found_something') then
    v_category := 'follower_requests';
  else
    v_category := 'leader_commands';
  end if;

  perform extensions.notify_push(jsonb_build_object(
    'category', v_category,
    'group_id', new.group_id,
    'sender_id', new.sender_id,
    'type', new.type,
    'message', new.message
  ));
  return new;
end;
$$;
