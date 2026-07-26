# OTA-05 Code Review

> 日期：2026-07-26  
> 結果：**未通過，任務保留於待審區**

## Findings

### [P1] 14 天 expiry 只阻擋新加入／建立，沒有阻擋既有 anonymous member 的持續存取

`supabase/migrations/20260725010000_anonymous_access_hardening.sql:139-158` 的 expiry check 位於 `join_group`，`:225-243` 位於 membership INSERT trigger，`:394-409` 位於 `create_group`。這些檢查不會在既有 member 讀取或執行群組操作時再次執行。基礎 `extensions.is_member` 僅以 `memberships` 判斷 membership（`supabase/migrations/20260617000000_supabase_init.sql:66-77`），而 groups、memberships、itinerary 的 RLS 也只呼叫該 membership predicate（同檔 `:116-118`、`:143-145`、`:169-172`）。目前沒有共用的 expiry-aware authorization guard。

cleanup 是 service-role function，且 migration 只提供 optional daily pg_cron／外部排程（`20260725010000_anonymous_access_hardening.sql:285-360`）。因此 anonymous session 在到期後、下次 cleanup 前仍能使用既有 membership 讀取旅團／行程，排程缺失時甚至可長期保持 active，違反「匿名 access 不超過 14 天」及「stale access 不留在單一 client」的規格。Client 顯示 expiry 不能取代 server authorization。

**修正要求：**在所有共享群組資料的共用 membership predicate 或 RPC authorization layer 加入 `anonymous_expires_at > now()` 檢查，並為既有 membership 的 read／mutation／navigation path 增加到期測試。cleanup 仍可保留作資料清理，但不能作為唯一 access control。

## Verification

- `npm.cmd run typecheck`：通過。
- OTA-05 anonymous access targeted tests：通過；現有 contract tests 驗證 join/create/cleanup 定義，未驗證到期後既有 membership 的 read／mutation 被拒絕。
