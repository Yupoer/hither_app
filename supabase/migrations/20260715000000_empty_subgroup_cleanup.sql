-- 離開小隊後若無人：刪除空小隊 + 其集合點，避免 UI 殘留「0 人」卡片與孤兒地點。
--
-- 既有 self_merge / trigger 已有刪空隊邏輯，但 trigger 非 SECURITY DEFINER，
-- 在 RLS（subgroups delete = leader only）下非隊長離隊時可能刪不掉。
-- 此 migration：
--   1) 把空隊 trigger 改為 SECURITY DEFINER
--   2) self_merge 在刪空隊前明確清 itinerary（CASCADE 的保險）
--   3) 一次性掃掉既有無人小隊

-- ── 1. Trigger：membership 離隊後清空小隊 ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_empty_group_or_subgroup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 檢查 subgroup
  IF OLD.subgroup_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships WHERE subgroup_id = OLD.subgroup_id
    ) THEN
      -- itinerary_items.subgroup_id ON DELETE CASCADE；先刪隊即可帶走集合點
      DELETE FROM public.subgroups WHERE id = OLD.subgroup_id;
    END IF;
  END IF;

  -- 檢查 group
  IF OLD.group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships WHERE group_id = OLD.group_id
    ) THEN
      DELETE FROM public.groups WHERE id = OLD.group_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_delete_empty_group_or_subgroup ON public.memberships;

CREATE TRIGGER trigger_delete_empty_group_or_subgroup
AFTER DELETE OR UPDATE OF group_id, subgroup_id ON public.memberships
FOR EACH ROW
EXECUTE FUNCTION public.delete_empty_group_or_subgroup();

-- ── 2. self_merge：最後一人離隊時清行程 + 刪隊 ─────────────────────────────

CREATE OR REPLACE FUNCTION public.self_merge(p_group uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current uuid;
  v_parent uuid;
BEGIN
  SELECT subgroup_id INTO v_current
    FROM public.memberships
   WHERE group_id = p_group
     AND user_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not a member of group %', p_group;
  END IF;

  -- 已在最上層：冪等 no-op
  IF v_current IS NULL THEN
    RETURN;
  END IF;

  SELECT parent_subgroup_id INTO v_parent
    FROM public.subgroups
   WHERE id = v_current;

  UPDATE public.memberships
     SET subgroup_id = v_parent
   WHERE group_id = p_group
     AND user_id = (SELECT auth.uid());

  -- 無人且無子小隊 → 清集合點（顯式，不單靠 CASCADE）再刪隊
  IF NOT EXISTS (
        SELECT 1 FROM public.memberships m WHERE m.subgroup_id = v_current
      )
     AND NOT EXISTS (
        SELECT 1 FROM public.subgroups c WHERE c.parent_subgroup_id = v_current
      )
  THEN
    DELETE FROM public.itinerary_items WHERE subgroup_id = v_current;
    DELETE FROM public.subgroups WHERE id = v_current;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.self_merge(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.self_merge(uuid) TO authenticated;

-- ── 3. 一次性：清掉已殘留的空小隊（及其集合點 via CASCADE） ───────────────

DELETE FROM public.subgroups s
 WHERE NOT EXISTS (
   SELECT 1 FROM public.memberships m WHERE m.subgroup_id = s.id
 )
 AND NOT EXISTS (
   SELECT 1 FROM public.subgroups c WHERE c.parent_subgroup_id = s.id
 );
