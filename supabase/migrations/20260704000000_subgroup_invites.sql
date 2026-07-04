-- 小隊邀請：組成 ≥2 人小隊改為「邀請 → 對方同意」。
--
-- 新設計（2026-07-03 拍板）：小隊只有 Solo 或 小隊(≥2)，一律 collab、不設隊長。
-- 任何小隊成員都能邀請同群的其他人；被邀者同意後才會搬進該小隊。
--
-- 安全模型同 self_split／set_solo：直接寫入 subgroup_invites 不開放，全部走
-- SECURITY DEFINER RPC，函式本體把權限死鎖在「呼叫者是小隊成員 / 被邀者本人」，
-- 一般成員無法替別人接受邀請，也無法把不相干的人塞進小隊。

create table if not exists public.subgroup_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  subgroup_id uuid not null references public.subgroups(id) on delete cascade,
  inviter_id uuid not null references auth.users(id),
  invitee_id uuid not null references auth.users(id),
  status text not null check (status in ('pending', 'accepted', 'declined')) default 'pending',
  created_at timestamptz default now()
);

create index if not exists idx_subgroup_invites_invitee_status
  on public.subgroup_invites(invitee_id, status);
create index if not exists idx_subgroup_invites_subgroup
  on public.subgroup_invites(subgroup_id);

-- 同一 invitee 對同一 subgroup 最多一筆 pending（避免重複邀請堆積）。
create unique index if not exists uq_subgroup_invites_pending
  on public.subgroup_invites(subgroup_id, invitee_id)
  where status = 'pending';

alter table public.subgroup_invites enable row level security;

-- 只有邀請人／被邀人看得到自己的邀請列。寫入不開放（全走 RPC）。
create policy "subgroup_invites: select own"
  on public.subgroup_invites for select to authenticated
  using (invitee_id = (select auth.uid()) or inviter_id = (select auth.uid()));

grant select on public.subgroup_invites to authenticated;

alter publication supabase_realtime add table public.subgroup_invites;

-- invite_to_subgroup — 呼叫者須為 p_subgroup 現有成員；被邀者須為同群成員且
--   尚未在此小隊。同 invitee+subgroup 已有 pending 則沿用（on conflict do nothing）。
create or replace function public.invite_to_subgroup(p_subgroup uuid, p_invitee uuid)
returns public.subgroup_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_invite public.subgroup_invites;
begin
  -- 小隊所屬大群。
  select group_id into v_group
    from public.subgroups
   where id = p_subgroup;
  if not found then
    raise exception 'subgroup % not found', p_subgroup;
  end if;

  -- 呼叫者須為該小隊現有成員（同時保證是本群成員）。
  if not exists (
    select 1 from public.memberships m
     where m.group_id = v_group
       and m.user_id = (select auth.uid())
       and m.subgroup_id = p_subgroup
  ) then
    raise exception 'not a member of subgroup %', p_subgroup;
  end if;

  -- 被邀者須為同群成員，且尚未在此小隊。
  if not exists (
    select 1 from public.memberships m
     where m.group_id = v_group
       and m.user_id = p_invitee
       and (m.subgroup_id is distinct from p_subgroup)
  ) then
    raise exception 'invitee % not eligible for subgroup %', p_invitee, p_subgroup;
  end if;

  insert into public.subgroup_invites (group_id, subgroup_id, inviter_id, invitee_id, status)
  values (v_group, p_subgroup, (select auth.uid()), p_invitee, 'pending')
  on conflict (subgroup_id, invitee_id) where (status = 'pending')
    do update set inviter_id = excluded.inviter_id
  returning * into v_invite;

  return v_invite;
end;
$$;

-- accept_subgroup_invite — 僅被邀者可呼叫：把邀請設 accepted，並把自己搬進小隊
--   （只動自己這一列）。
create or replace function public.accept_subgroup_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subgroup uuid;
  v_group uuid;
begin
  select subgroup_id, group_id into v_subgroup, v_group
    from public.subgroup_invites
   where id = p_invite
     and invitee_id = (select auth.uid())
     and status = 'pending';
  if not found then
    raise exception 'invite % not found or not yours', p_invite;
  end if;

  update public.subgroup_invites
     set status = 'accepted'
   where id = p_invite;

  update public.memberships
     set subgroup_id = v_subgroup
   where group_id = v_group
     and user_id = (select auth.uid());
end;
$$;

-- decline_subgroup_invite — 僅被邀者可呼叫：設 declined，不動 membership。
create or replace function public.decline_subgroup_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.subgroup_invites
     set status = 'declined'
   where id = p_invite
     and invitee_id = (select auth.uid())
     and status = 'pending';
  if not found then
    raise exception 'invite % not found or not yours', p_invite;
  end if;
end;
$$;

revoke all on function public.invite_to_subgroup(uuid, uuid) from public, anon;
grant execute on function public.invite_to_subgroup(uuid, uuid) to authenticated;

revoke all on function public.accept_subgroup_invite(uuid) from public, anon;
grant execute on function public.accept_subgroup_invite(uuid) to authenticated;

revoke all on function public.decline_subgroup_invite(uuid) from public, anon;
grant execute on function public.decline_subgroup_invite(uuid) to authenticated;

-- 去隊長：小隊改為一律 collab、無 leader_id。
--
-- 1) 覆寫 self_split：新小隊 mode='collab'、leader_id=null，其餘行為不變
--    （parent = 呼叫者當前 subgroup_id，把自己搬進去）。
create or replace function public.self_split(p_group uuid, p_name text)
returns public.subgroups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  v_sub public.subgroups;
begin
  select subgroup_id into v_parent
    from public.memberships
   where group_id = p_group
     and user_id = (select auth.uid());
  if not found then
    raise exception 'not a member of group %', p_group;
  end if;

  -- 無隊長協作小隊（leader_id 恆 null）。
  insert into public.subgroups (group_id, parent_subgroup_id, name, mode, leader_id)
  values (p_group, v_parent, p_name, 'collab', null)
  returning * into v_sub;

  update public.memberships
     set subgroup_id = v_sub.id
   where group_id = p_group
     and user_id = (select auth.uid());

  return v_sub;
end;
$$;

-- 2) 清存量：把任何還掛著隊長的舊小隊一律轉為 collab、無隊長。
update public.subgroups set leader_id = null, mode = 'collab' where leader_id is not null;
