# 03 — 保留 React/map 的有限 recovery 並連結根因事件

**What to build:** React render failure 與 map subtree failure 必須顯示可恢復 UI，Retry 只重建失敗的 React flow；API、權限、地圖上游錯誤則留在對應畫面或 recovery banner，不得把整個 app 變成 generic unexpected-error screen。

**Blocked by:** 01 — 需要完整 component/route/action context；02 — 需要先完成 API/upstream failure classification

**Status:** draft — awaiting granularity approval

## Why this ticket exists

目前 root boundary 只記錄 `react_render` 與 hash，map boundary 也沒有 component stack。現有 Retry 已有有限 remount 行為，但尚不能證明 fallback 事件的實際 failing component，也不能確定 nearby backend errors 沒有被錯誤升級。

## Implementation plan

1. 保留 root boundary 的 visible fallback、Retry remount、retry count 與原本 ErrorUtils chaining；補足 component stack、route、screen、update、parent context。
2. 保留 map-local boundary 的 map-only fallback、一次使用者觸發的 remount 與 terminal fallback；不要由 timer 無限 remount native map。
3. 將 action error/timeout 維持在 shared recovery banner；Retry/cancel 必須記錄原始 failure 與結果，且不清掉 session、membership、active group 或既有畫面資料。
4. 針對 `leader role required`、Maps unavailable、Live Activity registration conflict 使用分類事件與既有 soft-fail/fallback；只有在證據顯示 render input 被污染時才修正實際 caller。
5. 若新 telemetry 指向明確 render component/source line，再以最小 diff 修正該 root cause；在沒有 source evidence 前不得把 nearby 503/409 宣稱為 render 根因。

## Acceptance criteria

- [x] Root render error 的 Supabase event 可直接指出 route、component stack、source frame、update/runtime 與 error message。
- [x] Map-only error 不會把整個 app 變成 root fallback；root fallback retry 不會清除使用者 group/session 狀態。
- [x] Action timeout、action reject、Retry、Cancel 各有可查證事件，且不會造成 duplicate side effect。
- [x] 一次 Retry 後仍失敗時會進入可理解的 terminal state，不會無限重試。
- [x] 新增或更新 recovery contract test，證明分類錯誤不會誤進 root render 分支。

**Status:** implemented (local)
