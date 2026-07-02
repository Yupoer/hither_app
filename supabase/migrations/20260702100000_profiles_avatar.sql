-- 個人 emoji 頭像。
-- profiles 加入 realtime publication，暱稱／頭像變更即時同步給同群成員
-- （RLS 已限制只有本人與同群成員可見 profiles 列）。

alter table public.profiles
  add column if not exists avatar text;

alter publication supabase_realtime add table public.profiles;
