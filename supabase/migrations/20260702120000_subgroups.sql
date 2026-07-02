-- 子群組：大群 top-down 拆分成小隊，小隊可再巢狀拆分，之後一層層併回。
--
-- 模型：subgroups 自參照樹（parent_subgroup_id，null = 直屬大群）。
-- 成員掛在葉子小隊上（memberships.subgroup_id）。小隊模式：
--   led    — 有小隊隊長（leader_id）
--   collab — 協作制，不分隊長
-- 規則（client 端強制）：小隊至少 2 人；1 人請改用 Solo 模式。
-- 拆分／併回都是大群 leader 的操作（top-down），沿用 memberships 既有的
-- leader UPDATE policy 寫 subgroup_id，不需新 RPC。

create table if not exists public.subgroups (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  parent_subgroup_id uuid references public.subgroups(id) on delete cascade,
  name text not null,
  mode text not null check (mode in ('led', 'collab')) default 'led',
  leader_id uuid references auth.users(id),
  created_at timestamptz default now()
);

create index if not exists idx_subgroups_group_id on public.subgroups(group_id);
create index if not exists idx_subgroups_parent on public.subgroups(parent_subgroup_id);
create index if not exists idx_subgroups_leader_id on public.subgroups(leader_id);

alter table public.memberships
  add column if not exists subgroup_id uuid references public.subgroups(id) on delete set null;

create index if not exists idx_memberships_subgroup_id on public.memberships(subgroup_id);

alter table public.subgroups enable row level security;

create policy "subgroups: select if member"
  on public.subgroups for select to authenticated
  using (extensions.is_member(group_id));

create policy "subgroups: insert if leader"
  on public.subgroups for insert to authenticated
  with check (exists(
    select 1 from public.memberships m
    where m.group_id = subgroups.group_id
      and m.user_id = (select auth.uid()) and m.role = 'leader'
  ));

create policy "subgroups: update if leader"
  on public.subgroups for update to authenticated
  using (exists(
    select 1 from public.memberships m
    where m.group_id = subgroups.group_id
      and m.user_id = (select auth.uid()) and m.role = 'leader'
  ))
  with check (exists(
    select 1 from public.memberships m
    where m.group_id = subgroups.group_id
      and m.user_id = (select auth.uid()) and m.role = 'leader'
  ));

create policy "subgroups: delete if leader"
  on public.subgroups for delete to authenticated
  using (exists(
    select 1 from public.memberships m
    where m.group_id = subgroups.group_id
      and m.user_id = (select auth.uid()) and m.role = 'leader'
  ));

grant select, insert, update, delete on public.subgroups to authenticated;

alter publication supabase_realtime add table public.subgroups;
