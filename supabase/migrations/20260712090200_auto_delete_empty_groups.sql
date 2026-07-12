-- 自動刪除沒有人的群組(groups)與小隊(subgroups)
-- 由於虛擬隊員僅存在於 Client 端，資料庫中沒有真實成員即代表沒有人。
-- 當 memberships 被刪除或更新群組/小隊 ID 時，檢查原本的群組/小隊是否已經空了。

CREATE OR REPLACE FUNCTION public.delete_empty_group_or_subgroup()
RETURNS TRIGGER AS $$
BEGIN
  -- 檢查 subgroup
  IF OLD.subgroup_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE subgroup_id = OLD.subgroup_id) THEN
      DELETE FROM public.subgroups WHERE id = OLD.subgroup_id;
    END IF;
  END IF;

  -- 檢查 group
  IF OLD.group_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE group_id = OLD.group_id) THEN
      DELETE FROM public.groups WHERE id = OLD.group_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_delete_empty_group_or_subgroup ON public.memberships;

CREATE TRIGGER trigger_delete_empty_group_or_subgroup
AFTER DELETE OR UPDATE OF group_id, subgroup_id ON public.memberships
FOR EACH ROW
EXECUTE FUNCTION public.delete_empty_group_or_subgroup();
