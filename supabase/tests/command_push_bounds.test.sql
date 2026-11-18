begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(20);

create table public.test_command_pushes(payload jsonb not null);
create or replace function extensions.notify_push(payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.test_command_pushes(payload) values (payload);
$$;

insert into auth.users(id, email) values
  ('d1111111-1111-4111-8111-111111111111', 'command-sender@example.test'),
  ('d2222222-2222-4222-8222-222222222222', 'command-target@example.test');
insert into public.profiles(id, nickname) values
  ('d1111111-1111-4111-8111-111111111111', 'Sender'),
  ('d2222222-2222-4222-8222-222222222222', 'Target');
insert into public.groups(id, name, invite_code, created_by) values
  ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Command bounds', 'CMDBND',
   'd1111111-1111-4111-8111-111111111111');
insert into public.memberships(group_id, user_id, role) values
  ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1111111-1111-4111-8111-111111111111', 'leader'),
  ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd2222222-2222-4222-8222-222222222222', 'follower');

select ok(
  not has_table_privilege('authenticated', 'public.commands', 'INSERT'),
  'authenticated callers cannot insert commands directly'
);
select ok(
  not has_table_privilege('authenticated', 'hither_private.command_push_budgets', 'SELECT'),
  'authenticated callers cannot inspect command budgets'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);

select throws_ok(
  $$insert into public.commands(group_id, sender_id, type, message) values
    ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(), 'custom', 'bypass')$$,
  '42501', null, 'the Data API insert path is denied'
);

select is(
  public.apply_core_operation_v3(
    'd6000000-0000-4000-8000-000000000001',
    'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(),
    'itinerary', 'd6000000-0000-4000-8000-000000000001', 0,
    'send_command', '{"type":"custom","message":"Meet here"}', 1
  )->>'status',
  'accepted',
  'a bounded command is accepted through the durable RPC'
);
reset role;
select ok(
  (select count(*) = 1 from public.core_notification_outbox
    where operation_id = 'd6000000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.test_command_pushes),
  'an accepted command creates one recipient delivery'
);
select ok(
  (select burst_count = 1 and sustained_count = 1
   from hither_private.command_push_budgets
   where group_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and sender_id = 'd1111111-1111-4111-8111-111111111111'),
  'an accepted command consumes both budgets'
);

set local role authenticated;
select is(
  public.apply_core_operation_v3(
    'd6000000-0000-4000-8000-000000000001',
    'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(),
    'itinerary', 'd6000000-0000-4000-8000-000000000001', 0,
    'send_command', '{"type":"custom","message":"Meet here"}', 1
  )->>'status',
  'duplicate',
  'an idempotent replay returns the existing operation'
);
reset role;
select ok(
  (select count(*) = 1 from public.core_notification_outbox
    where operation_id = 'd6000000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.test_command_pushes)
  and (select burst_count = 1 and sustained_count = 1
       from hither_private.command_push_budgets
       where group_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
         and sender_id = 'd1111111-1111-4111-8111-111111111111'),
  'an idempotent replay creates no work and consumes no quota'
);

set local role authenticated;
select is(
  public.apply_core_operation_v3(
    'd6000000-0000-4000-8000-000000000101',
    'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(),
    'itinerary', 'd6000000-0000-4000-8000-000000000101', 0,
    'send_command', jsonb_build_object('type', 'custom', 'message', repeat('漢', 342)), 101
  )#>>'{conflict,code}',
  'validation',
  'a multibyte message over 1024 bytes is rejected'
);
reset role;
select ok(
  not exists(select 1 from public.core_operations
    where operation_id = 'd6000000-0000-4000-8000-000000000101')
  and not exists(select 1 from public.core_notification_outbox
    where operation_id = 'd6000000-0000-4000-8000-000000000101')
  and (select burst_count = 1 and sustained_count = 1
       from hither_private.command_push_budgets
       where group_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
         and sender_id = 'd1111111-1111-4111-8111-111111111111'),
  'an oversized message creates no receipt, delivery, or quota use'
);
set local role authenticated;
select is(
  public.apply_core_operation_v3(
    'd6000000-0000-4000-8000-000000000102',
    'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(),
    'itinerary', 'd6000000-0000-4000-8000-000000000102', 0,
    'send_command', jsonb_build_object('type', 'custom', 'message', 'ok', 'padding', repeat('x', 4096)), 102
  )#>>'{conflict,code}',
  'validation',
  'an oversized command envelope is rejected'
);
reset role;
select ok(
  not exists(select 1 from public.core_operations
    where operation_id = 'd6000000-0000-4000-8000-000000000102')
  and not exists(select 1 from public.core_notification_outbox
    where operation_id = 'd6000000-0000-4000-8000-000000000102')
  and (select burst_count = 1 and sustained_count = 1
       from hither_private.command_push_budgets
       where group_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
         and sender_id = 'd1111111-1111-4111-8111-111111111111'),
  'an oversized envelope creates no receipt, delivery, or quota use'
);

set local role authenticated;
do $$
declare
  i integer;
  v_id uuid;
  v_result jsonb;
begin
  for i in 2..10 loop
    v_id := ('d6000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    v_result := public.apply_core_operation_v3(
      v_id, 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(),
      'itinerary', v_id::text, 0, 'send_command',
      jsonb_build_object('type', 'custom', 'message', 'bounded'), i
    );
    assert v_result->>'status' = 'accepted', v_result::text;
  end loop;
end;
$$;

select is(
  public.apply_core_operation_v3(
    'd6000000-0000-4000-8000-000000000011',
    'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(),
    'itinerary', 'd6000000-0000-4000-8000-000000000011', 0,
    'send_command', '{"type":"custom","message":"burst"}', 11
  )#>>'{conflict,message}',
  'command quota exceeded',
  'the eleventh command in one minute is rejected'
);
reset role;
select ok(
  not exists(select 1 from public.core_operations
    where operation_id = 'd6000000-0000-4000-8000-000000000011')
  and not exists(select 1 from public.core_notification_outbox
    where operation_id = 'd6000000-0000-4000-8000-000000000011')
  and (select count(*) = 10 from public.test_command_pushes)
  and (select burst_count = 10 and sustained_count = 10
       from hither_private.command_push_budgets
       where group_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
         and sender_id = 'd1111111-1111-4111-8111-111111111111'),
  'a burst rejection creates no receipt, delivery, or extra quota use'
);

update hither_private.command_push_budgets
set burst_window_started_at = now(), burst_count = 0,
    sustained_window_started_at = now(), sustained_count = 120
where group_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and sender_id = 'd1111111-1111-4111-8111-111111111111';
set local role authenticated;
select is(
  public.apply_core_operation_v3(
    'd6000000-0000-4000-8000-000000000120',
    'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(),
    'itinerary', 'd6000000-0000-4000-8000-000000000120', 0,
    'send_command', '{"type":"custom","message":"sustained"}', 120
  )#>>'{conflict,message}',
  'command quota exceeded',
  'the daily sender budget rejects additional commands'
);
reset role;
select ok(
  not exists(select 1 from public.core_operations
    where operation_id = 'd6000000-0000-4000-8000-000000000120')
  and not exists(select 1 from public.core_notification_outbox
    where operation_id = 'd6000000-0000-4000-8000-000000000120')
  and (select count(*) = 10 from public.test_command_pushes),
  'a sustained rejection creates no durable or downstream work'
);

insert into auth.users(id, email) values
  ('d3333333-3333-4333-8333-333333333333', 'command-extra-1@example.test'),
  ('d4444444-4444-4444-8444-444444444444', 'command-extra-2@example.test'),
  ('d5555555-5555-4555-8555-555555555555', 'command-extra-3@example.test'),
  ('d6666666-6666-4666-8666-666666666666', 'command-extra-4@example.test');
insert into public.profiles(id, nickname) values
  ('d3333333-3333-4333-8333-333333333333', 'Extra 1'),
  ('d4444444-4444-4444-8444-444444444444', 'Extra 2'),
  ('d5555555-5555-4555-8555-555555555555', 'Extra 3'),
  ('d6666666-6666-4666-8666-666666666666', 'Extra 4');
insert into public.memberships(group_id, user_id, role)
select 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'follower'
from auth.users
where id in (
  'd3333333-3333-4333-8333-333333333333',
  'd4444444-4444-4444-8444-444444444444',
  'd5555555-5555-4555-8555-555555555555',
  'd6666666-6666-4666-8666-666666666666'
);
update hither_private.command_push_budgets
set burst_window_started_at = now(), burst_count = 0,
    sustained_window_started_at = now(), sustained_count = 0
where group_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and sender_id = 'd1111111-1111-4111-8111-111111111111';
set local role authenticated;
select is(
  public.apply_core_operation_v3(
    'd6000000-0000-4000-8000-000000000201',
    'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(),
    'itinerary', 'd6000000-0000-4000-8000-000000000201', 0,
    'send_command', '{"type":"custom","message":"too many recipients"}', 201
  )#>>'{conflict,message}',
  'command recipient limit exceeded',
  'a command cannot expand beyond four recipients'
);
reset role;
select ok(
  not exists(select 1 from public.core_notification_outbox
    where operation_id = 'd6000000-0000-4000-8000-000000000201')
  and not exists(select 1 from public.commands
    where id = 'd6000000-0000-4000-8000-000000000201')
  and (select count(*) = 10 from public.test_command_pushes)
  and (select burst_count = 0 and sustained_count = 0
       from hither_private.command_push_budgets
       where group_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
         and sender_id = 'd1111111-1111-4111-8111-111111111111'),
  'a fan-out rejection rolls back command work and restores quota'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd2222222-2222-4222-8222-222222222222', true);
select is(
  public.apply_core_operation_v3(
    'd6000000-0000-4000-8000-000000000202',
    'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth.uid(),
    'itinerary', 'd6000000-0000-4000-8000-000000000202', 0,
    'send_command', '{"type":"request_start","message":"Please start"}', 202
  )->>'status',
  'accepted',
  'a targeted follower request remains available'
);
reset role;
select ok(
  (select count(*) = 1 and bool_and(target_user_id = 'd1111111-1111-4111-8111-111111111111')
   from public.core_notification_outbox
   where operation_id = 'd6000000-0000-4000-8000-000000000202')
  and (select burst_count = 1 and sustained_count = 1
       from hither_private.command_push_budgets
       where group_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
         and sender_id = 'd2222222-2222-4222-8222-222222222222'),
  'the targeted request reaches its leader and consumes one budget unit'
);

select * from finish();
rollback;
