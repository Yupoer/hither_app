# 01 — 建立跨平台錯誤上下文與 correlation contract

**What to build:** 下一次 iOS 或 Android 出現 React fallback、UI action failure 或 API failure 時，Supabase `performance_events` 必須保留足以直接定位問題的同一組上下文，而不是只留下 `Error + stackHash + unknown screen`。

**Blocked by:** None — can start immediately

**Status:** draft — awaiting granularity approval

## Why this ticket exists

已確認目前事件包含 `error.react_render`、`stackHash=37a18da1`，但 `lastScreen=unknown`，沒有 component stack、action correlation、request correlation 或可讀錯誤訊息。既有 sanitizer 也會丟棄部分已由呼叫端產生的 context。

## Implementation plan

1. 沿用現有 SQLite performance outbox、consent gate、batch scheduler、Supabase upload 與 RLS，不新增 crash SDK 或第二條 telemetry pipeline。
2. 擴充既有 allow-list，保留 `routeName`、`routeKey`、`lastScreen`、`actionId`、`screen`、`requestId`、operation、status、error code、update/runtime/build context、parent trace ID。
3. 新增 bounded error diagnostics：`errorMessage`、`errorDetails`、`errorHint`、`errorFrames`、`sourceLocation`、`componentStack`。錯誤訊息與 stack 只保留有限長度及檔名/行列資訊。
4. 在寫入 outbox 前遮蔽 JWT、Bearer token、長 token、UUID、URL query、座標及未 allow-list 欄位；資料庫 payload 上限仍維持既有 32 KB contract。
5. 在 React Navigation container 的 ready/state change 更新最深 active route；root boundary 與 map boundary 傳入 `ErrorInfo.componentStack`。
6. 將 UI action 的 action ID 與目前 screen 接到同一 parent trace；不改變 action 的 single-flight、timeout、retry 或 finally 行為。

## Acceptance criteria

- [x] Root React error event 同時包含 update/runtime/build、route、screen、exception kind、stack hash、bounded error message、source frames 與 component stack。
- [x] UI action error 能以 action ID、screen、parent trace ID 對應到同一次操作。
- [x] Request ID 與 operation context 能保留；group/user/coordinate/token 等敏感值仍不會進 payload。
- [x] 新增 contract test 驗證 allow-list 保留、敏感值遮蔽、長度上限與未授權欄位丟棄。
- [x] 不改變既有使用者 recovery 行為；consent 關閉時不寫入 outbox。

**Status:** implemented (local)
