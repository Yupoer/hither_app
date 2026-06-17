-- Phase S — Hither Supabase 後端初始化
-- 表：profiles / groups / memberships / itinerary_items / member_locations
-- 全表開 RLS，policy 採 TO authenticated + auth.uid()。
-- helper is_member() 用 SECURITY DEFINER 避免 memberships 自我參照 RLS 遞迴。

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  created_at timestamptz default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('leader','follower')),
  status text not null check (status in ('active','idle','arrived','offline')) default 'active',
  unique(group_id, user_id)
);

create table if not exists public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  description text,
  address text,
  latitude double precision,
  longitude double precision,
  position int not null,
  type text,
  created_at timestamptz default now()
);

create table if not exists public.member_locations (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  latitude double precision,
  longitude double precision,
  updated_at timestamptz default now(),
  primary key (group_id, user_id)
);

-- FK 覆蓋索引（advisor: unindexed_foreign_keys）
create index if not exists idx_groups_created_by on public.groups(created_by);
create index if not exists idx_itinerary_items_group_id on public.itinerary_items(group_id);
create index if not exists idx_member_locations_user_id on public.member_locations(user_id);
create index if not exists idx_memberships_user_id on public.memberships(user_id);

-- ============================================================
-- HELPER: is_member(gid) — SECURITY DEFINER 繞過 memberships RLS 防遞迴
-- 放 extensions（非 exposed schema），鎖 search_path，內含 auth.uid()
-- ============================================================

create or replace function extensions.is_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.memberships m
    where m.group_id = gid
      and m.user_id = (select auth.uid())
  )
$$;

revoke execute on function extensions.is_member(uuid) from public;
grant execute on function extensions.is_member(uuid) to authenticated;

-- ============================================================
-- RLS
-- ============================================================

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.memberships enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.member_locations enable row level security;

-- profiles --------------------------------------------------
create policy "profiles: select own or co-member"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists(
      select 1 from public.memberships m1
      join public.memberships m2 on m1.group_id = m2.group_id
      where m1.user_id = (select auth.uid())
        and m2.user_id = profiles.id
    )
  );

create policy "profiles: insert own"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- groups ----------------------------------------------------
create policy "groups: select if member"
  on public.groups for select to authenticated
  using (extensions.is_member(id));

create policy "groups: insert own"
  on public.groups for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "groups: update if leader"
  on public.groups for update to authenticated
  using (exists(
    select 1 from public.memberships m
    where m.group_id = groups.id and m.user_id = (select auth.uid()) and m.role = 'leader'
  ))
  with check (exists(
    select 1 from public.memberships m
    where m.group_id = groups.id and m.user_id = (select auth.uid()) and m.role = 'leader'
  ));

create policy "groups: delete if leader"
  on public.groups for delete to authenticated
  using (exists(
    select 1 from public.memberships m
    where m.group_id = groups.id and m.user_id = (select auth.uid()) and m.role = 'leader'
  ));

-- memberships -----------------------------------------------
create policy "memberships: select if member"
  on public.memberships for select to authenticated
  using (extensions.is_member(group_id));

create policy "memberships: insert self"
  on public.memberships for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "memberships: update if leader"
  on public.memberships for update to authenticated
  using (exists(
    select 1 from public.memberships m
    where m.group_id = memberships.group_id and m.user_id = (select auth.uid()) and m.role = 'leader'
  ))
  with check (user_id = memberships.user_id);  -- 防改 user_id

create policy "memberships: delete if leader or self"
  on public.memberships for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists(
      select 1 from public.memberships m
      where m.group_id = memberships.group_id and m.user_id = (select auth.uid()) and m.role = 'leader'
    )
  );

-- itinerary_items -------------------------------------------
create policy "itinerary_items: select if member"
  on public.itinerary_items for select to authenticated
  using (extensions.is_member(group_id));

create policy "itinerary_items: insert if leader"
  on public.itinerary_items for insert to authenticated
  with check (exists(
    select 1 from public.memberships m
    where m.group_id = itinerary_items.group_id and m.user_id = (select auth.uid()) and m.role = 'leader'
  ));

create policy "itinerary_items: update if leader"
  on public.itinerary_items for update to authenticated
  using (exists(
    select 1 from public.memberships m
    where m.group_id = itinerary_items.group_id and m.user_id = (select auth.uid()) and m.role = 'leader'
  ))
  with check (exists(
    select 1 from public.memberships m
    where m.group_id = itinerary_items.group_id and m.user_id = (select auth.uid()) and m.role = 'leader'
  ));

create policy "itinerary_items: delete if leader"
  on public.itinerary_items for delete to authenticated
  using (exists(
    select 1 from public.memberships m
    where m.group_id = itinerary_items.group_id and m.user_id = (select auth.uid()) and m.role = 'leader'
  ));

-- member_locations ------------------------------------------
create policy "member_locations: select if member"
  on public.member_locations for select to authenticated
  using (extensions.is_member(group_id));

create policy "member_locations: insert own"
  on public.member_locations for insert to authenticated
  with check (user_id = (select auth.uid()) and extensions.is_member(group_id));

create policy "member_locations: update own"
  on public.member_locations for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================
-- GRANTS (2026-04-28 breaking change：新表不再自動暴露 Data API)
-- ============================================================

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.groups to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.itinerary_items to authenticated;
grant select, insert, update, delete on public.member_locations to authenticated;

-- ============================================================
-- REALTIME
-- ============================================================

alter publication supabase_realtime add table public.member_locations;
alter publication supabase_realtime add table public.memberships;
alter publication supabase_realtime add table public.itinerary_items;
