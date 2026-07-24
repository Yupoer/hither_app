# 02 — 分類 Supabase RPC、Edge Function 與 registration failure

**What to build:** 使用者遇到 Supabase/RPC、Google Maps proxy 或 Live Activity registration 問題時，錯誤要被歸到正確 subsystem 並保留 operation/status/code/message；這些可恢復的上游錯誤不得被誤判成 root React render failure。

**Blocked by:** 01 — 建立共通錯誤上下文與安全欄位後才能寫入可查證的分類事件

**Status:** draft — awaiting granularity approval

## Why this ticket exists

查證到同一調查窗口有 PostgreSQL `leader role required`、Google Maps Edge Function 503，以及 `device_live_activity_tokens_token` duplicate-key 409。現有 Supabase trace 主要只處理 rejected Promise；PostgREST 常以 resolved `{ data, error }` 回傳，因此錯誤可能漏記。

## Implementation plan

1. 在共通 Supabase trace boundary 同時處理 rejected promise 與 resolved `{ error }` response；保留原始 response，不改變 service-level error handling。
2. 對每個事件寫入 stable operation，例如 RPC/function/table operation、duration、outcome、database code、HTTP status、message/details/hint、route/action/parent trace。
3. 將 `leader role required` 視為 leader-role authorization/state mismatch 類別；沿用現有 leader-only guard 與 soft-fail，不增加盲目 retry，也不把它升級成 root boundary。
4. 將 Google Maps 503/429/401/network failure 綁定到 map/search/directions subsystem；沿用目前 fallback 行為，不在沒有證據前更換 renderer 或增加 retry loop。
5. 將 Live Activity token duplicate-key 視為 registration idempotency conflict；確認它不會遮蔽主要 map/session UI，並保留可搜尋的 operation/code/status。

## Acceptance criteria

- [x] Resolved Supabase `{ error }` 會產生 error event，含 operation、database code、status、message、duration 與 parent context。
- [x] Rejected network error 會產生相同格式的 error event，不依賴 full tracing 開關才能留下。
- [x] `leader role required`、Maps 503/429/401、token duplicate-key 409 可由 operation/code/status 區分。
- [x] 既有 fallback、soft-fail、idempotency 與 service-level throw 行為不被改壞。
- [x] 新增 contract test 覆蓋 403/503/409 與成功 response，且成功 response 不會產生 false error event。

**Status:** implemented (local)
