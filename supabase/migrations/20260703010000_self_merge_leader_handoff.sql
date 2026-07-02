-- self_merge 孤兒小隊修法：離隊者若正是所在小隊的 leader_id，且小隊裡還有其他
-- 成員留著，離隊前把 leader_id 過戶給留下成員的其中一位，確保任何小隊永遠都有
-- 隊長（不會出現「隊長已不在隊上」的孤兒狀態）。
--
-- memberships 沒有 joined_at / created_at 之類可排序「最早加入」的欄位，這裡用
-- user_id 排序做穩定、確定性的挑選（不是真的「最早加入」，只是每次都選到同一人）。

create or replace function public.self_merge(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_parent uuid;
  v_new_leader uuid;
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

  -- 過戶隊長：只有離隊者剛好是 v_current 的 leader_id 時才會真的動到（否則
  -- WHERE leader_id = auth.uid() 比對不到，UPDATE 影響 0 列，不干擾 collab
  -- 模式或別人仍在當隊長的情況）。
  select m.user_id into v_new_leader
    from public.memberships m
   where m.subgroup_id = v_current
   order by m.user_id
   limit 1;

  if v_new_leader is not null then
    update public.subgroups
       set leader_id = v_new_leader
     where id = v_current
       and leader_id = (select auth.uid());
  end if;

  -- 清掉剛離開、且已無成員「又無子小隊」的小隊（同 self_split_merge 原本的邏輯）。
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
