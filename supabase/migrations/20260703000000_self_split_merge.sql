-- 自助拆分／併回：任何成員都能自己脫隊，不必等大群 leader。
--
-- 沿用 set_solo 的安全模型：memberships / subgroups 的寫入 RLS 是 leader-only，
-- 這裡用 SECURITY DEFINER 繞過，但函式本體把寫入死鎖在 user_id = auth.uid()，
-- 一般成員永遠只動得到自己那一列，無法提權。
--
-- self_split — 在自己「當前小隊」底下開一個新小隊（parent = 當前 subgroup_id，
--   null 即直屬大群），自己當隊長並搬進去。self-split 起手必定 1 人，
--   故 subgroups migration 那條「小隊至少 2 人」只適用於 leader 批次拆分，
--   這裡刻意不套用。
-- self_merge — 把自己往上搬一層（回 parent，parent 為 null 即回大群）；
--   若離開後該小隊「已無成員且無子小隊」則順手刪除。

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
  -- 找呼叫者在本群的 membership 與當前小隊；非成員 → 擋下，
  -- 免得替不相干的 group id 亂建小隊。
  select subgroup_id into v_parent
    from public.memberships
   where group_id = p_group
     and user_id = (select auth.uid());
  if not found then
    raise exception 'not a member of group %', p_group;
  end if;

  -- 新小隊巢狀在呼叫者當前小隊底下（v_parent 為 null 即直屬大群），
  -- 呼叫者即隊長。parent 取自本人 membership，不吃外部參數，無法指到別隊。
  insert into public.subgroups (group_id, parent_subgroup_id, name, mode, leader_id)
  values (p_group, v_parent, p_name, 'led', (select auth.uid()))
  returning * into v_sub;

  -- 把自己搬進新小隊（只動自己這一列）。
  update public.memberships
     set subgroup_id = v_sub.id
   where group_id = p_group
     and user_id = (select auth.uid());

  return v_sub;
end;
$$;

create or replace function public.self_merge(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_parent uuid;
begin
  -- 找呼叫者在本群的 membership 與當前小隊；非成員 → 擋下。
  select subgroup_id into v_current
    from public.memberships
   where group_id = p_group
     and user_id = (select auth.uid());
  if not found then
    raise exception 'not a member of group %', p_group;
  end if;

  -- 不在任何小隊 → 已在最上層，no-op（冪等，client 不必處理假錯誤）。
  if v_current is null then
    return;
  end if;

  -- 目標層級：當前小隊的 parent（null 即回大群）。target 取自 DB，不吃外部參數。
  select parent_subgroup_id into v_parent
    from public.subgroups
   where id = v_current;

  update public.memberships
     set subgroup_id = v_parent
   where group_id = p_group
     and user_id = (select auth.uid());

  -- 清掉剛離開、且已無成員「又無子小隊」的小隊。
  -- 「無子小隊」這條不能省：parent_subgroup_id 是 on delete cascade，
  -- 若小隊還掛著巢狀子隊就刪，會連子隊一起 cascade，
  -- 再把子隊裡別人的 membership.subgroup_id 設成 null——
  -- 這是這兩支 RPC 唯一可能傷到他人的路徑，必須擋。
  delete from public.subgroups s
   where s.id = v_current
     and not exists (
       select 1 from public.memberships m where m.subgroup_id = s.id
     )
     and not exists (
       select 1 from public.subgroups c where c.parent_subgroup_id = s.id
     );
end;
$$;

revoke all on function public.self_split(uuid, text) from public, anon;
grant execute on function public.self_split(uuid, text) to authenticated;

revoke all on function public.self_merge(uuid) from public, anon;
grant execute on function public.self_merge(uuid) to authenticated;
