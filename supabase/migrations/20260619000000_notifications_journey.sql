-- APNs 推播 + 快捷指令 + 通知偏好 + 隊長行程(開始/暫停) + Live Activity 後端
--
-- 新增：
--   push_tokens             每位使用者的 APNs device token（Edge Function 以 service role 讀）
--   commands                隊長指令 / 成員快捷請求（realtime + 觸發推播）
--   notification_preferences 四類別獨立開關（server-side 強制：Edge Function 過濾收件人）
--   groups.journey_status   行程狀態 going|paused（隊長控制，realtime 廣播）
--   itinerary_items.created_by 新增集合點者（推播時排除自己）
--   pg_net triggers         insert/update 後呼叫 send-push Edge Function
--
-- 推播決策（誰、何時）在 server-side：trigger -> Edge Function。client 只負責寫入。

-- ============================================================
-- push_tokens
-- ============================================================

create table if not exists public.push_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null default 'ios',
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

create index if not exists idx_push_tokens_user_id on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;

create policy "push_tokens: select own"
  on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));

create policy "push_tokens: insert own"
  on public.push_tokens for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "push_tokens: update own"
  on public.push_tokens for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "push_tokens: delete own"
  on public.push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- commands（隊長指令 + 成員快捷請求）
-- ============================================================

create table if not exists public.commands (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  type text not null check (type in (
    -- leader
    'gather','find_gathering','depart','rest','be_careful',
    'go_left','go_right','stop','hurry_up',
    -- follower
    'need_restroom','need_break','need_help','found_something'
  )),
  message text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
);

create index if not exists idx_commands_group_id on public.commands(group_id);
create index if not exists idx_commands_sender_id on public.commands(sender_id);

alter table public.commands enable row level security;

create policy "commands: select if member"
  on public.commands for select to authenticated
  using (extensions.is_member(group_id));

create policy "commands: insert own if member"
  on public.commands for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and extensions.is_member(group_id)
  );

-- ============================================================
-- notification_preferences（四類別獨立開關，預設全開）
-- ============================================================

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  add_gathering boolean not null default true,
  leader_commands boolean not null default true,
  follower_requests boolean not null default true,
  journey boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "notification_preferences: select own"
  on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create policy "notification_preferences: insert own"
  on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "notification_preferences: update own"
  on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================
-- groups.journey_status + itinerary_items.created_by
-- ============================================================

alter table public.groups
  add column if not exists journey_status text not null default 'paused'
  check (journey_status in ('going','paused'));

-- 新增集合點者（推播時排除自己）。預設取當下登入者。
alter table public.itinerary_items
  add column if not exists created_by uuid references auth.users(id) default auth.uid();

-- ============================================================
-- GRANTS（2026-04-28 起新表不自動暴露 Data API）
-- ============================================================

grant select, insert, update, delete on public.push_tokens to authenticated;
grant select, insert on public.commands to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;

-- ============================================================
-- REALTIME
-- ============================================================

alter publication supabase_realtime add table public.commands;
alter publication supabase_realtime add table public.groups;

-- ============================================================
-- 推播觸發（pg_net -> Edge Function send-push）
--
-- Edge Function URL 與 service_role key 不可硬編。請於部署後設定：
--   alter database postgres set app.settings.edge_url      = 'https://<ref>.supabase.co/functions/v1/send-push';
--   alter database postgres set app.settings.service_role  = '<service_role_key>';
-- 兩者任一為空時 notify_push 直接 no-op（migration 在未設定前仍可安全套用）。
-- ============================================================

create extension if not exists pg_net with schema extensions;

create or replace function extensions.notify_push(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := current_setting('app.settings.edge_url', true);
  v_key text := current_setting('app.settings.service_role', true);
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- 尚未設定憑證：安全略過，不阻擋寫入
  end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := payload
  );
end;
$$;

revoke all on function extensions.notify_push(jsonb) from public, anon, authenticated;

-- commands -> 依 type 區分 leader_commands / follower_requests 類別
create or replace function public.on_command_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
begin
  if new.type in ('need_restroom','need_break','need_help','found_something') then
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

create trigger trg_command_insert
  after insert on public.commands
  for each row execute function public.on_command_insert();

-- itinerary_items insert -> add_gathering（排除 created_by）
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
    'title', new.title
  ));
  return new;
end;
$$;

create trigger trg_itinerary_insert
  after insert on public.itinerary_items
  for each row execute function public.on_itinerary_insert();

-- groups.journey_status change -> journey
create or replace function public.on_journey_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.journey_status is distinct from old.journey_status then
    perform extensions.notify_push(jsonb_build_object(
      'category', 'journey',
      'group_id', new.id,
      'sender_id', (select auth.uid()),
      'status', new.journey_status
    ));
  end if;
  return new;
end;
$$;

create trigger trg_journey_change
  after update of journey_status on public.groups
  for each row execute function public.on_journey_change();
