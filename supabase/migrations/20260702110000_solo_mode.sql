-- Solo 模式：成員暫時脫離群組活動 — 不接收群組通知（位置照常分享），
-- 關閉後即回到群組。
--
-- memberships.solo 由本人透過 set_solo() 切換。memberships 的 UPDATE policy
-- 原本是 leader-only；直接開放本人整列 UPDATE 會連 role 一起放行，
-- 所以用 SECURITY DEFINER RPC 限縮到單一欄位。

alter table public.memberships
  add column if not exists solo boolean not null default false;

create or replace function public.set_solo(p_group uuid, p_solo boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.memberships
     set solo = p_solo
   where group_id = p_group
     and user_id = (select auth.uid());
$$;

revoke all on function public.set_solo(uuid, boolean) from public, anon;
grant execute on function public.set_solo(uuid, boolean) to authenticated;
