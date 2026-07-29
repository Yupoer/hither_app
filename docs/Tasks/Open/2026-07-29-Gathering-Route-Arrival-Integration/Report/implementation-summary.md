# Implementation Summary — Gathering Route Arrival Integration

## Implemented

- 移除抵達寫入前刷新，以樂觀 arrival 狀態銜接正式資料列，失敗才回復。
- 抵達按鈕只在實際共同行程目標顯示；隱藏時倒數控制擴展。
- 隊員行程前送出 `request_start`，行程中固定顯示不可點擊的「前往中」。
- DB constraint、trigger category、Realtime 與 Edge push 均讓 `request_start` 沿用 follower request 偏好，且只通知隊長。
- iOS transit 直接使用既有 Google Routes proxy；所有 provider 路線在共用 boundary 做 10 公尺折線簡化。
- 手動／自動成功抵達後排程本人本地通知；失敗 soft-fail，取消後可再次通知。

## Verification

- Focused Jest：7 suites、116 tests passed。
- Full Jest：126 suites、1064 tests passed。
- `npm.cmd --prefix apps/mobile run typecheck`：passed。
- `git diff --check origin/master`：passed。
- Deno 執行環境未安裝；新增的 Edge 訊息案例已寫入 `fcm_test.ts`，尚未在本機執行。
- 未執行真機、OTA、原生 build、正式 migration 或 Edge Function 部署。
