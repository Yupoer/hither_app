# OTA-01 Code Review

> 日期：2026-07-26  
> 結果：**未通過，任務保留於待審區**

## Findings

### [P1] `apply_core_operation` 沒有驗證集合點是否存在、是否為下一個 pending 點

規格要求 server 拒絕 invalid、duplicate、stale、concurrent transition，且 Start 只能作用於下一個 pending 集合點。`supabase/migrations/20260725000200_core_operation_sync.sql:294-354` 的 Start 驗證只檢查目前 phase 不是已在 `en_route`，以及 payload 有非空 `activeDestinationId`；沒有查詢 `itinerary_items`、群組歸屬、`closed_at`、順序或既有 point status。End 亦在 `:394-415` 直接採用 client 提供的 `nextDestinationId`，未知 ID 還會被加入 `pending`。

因此，具備有效群組 membership 的舊 client、離線重播或竄改 payload，都可能讓不存在、已完成或跳過前一點的 ID 進入 `en_route`／`pending`，並在 `:440-460` 同步改寫 legacy `groups` journey 欄位。MapScreen 的 `:148-153` 只是在 client 端限制按鈕，不能取代 server authority。

**修正要求：**在 RPC 內以 `p_group_id` 鎖定並驗證 itinerary item，Start 僅接受實際下一個未關閉且 pending 的點；End 僅接受 server active point，`nextDestinationId` 必須是合法的下一個點，否則回傳 `invalid_transition`。補上跨裝置／stale replay 的 SQL integration test。

### [P1] legacy navigation 失敗時仍保留 optimistic gathering outbox，可能產生沒有 navigation session 的 team `en_route`

`apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts:160-186` 先呼叫 `enqueueLeaderGatheringStart`，再呼叫 legacy `startSession`；`startSession` 的 catch 對所有錯誤一律當作 offline，清除 request 但不撤銷或標記前面的 outbox。這包含 business rejection 或競態錯誤，不只是網路中斷。之後 core outbox 可能成功套用，並由 migration `:440-460` 將 `groups.journey_status` 設為 `going`，但 `navigation_sessions` 並沒有對應 session。

**修正要求：**只在可判定為暫時性網路錯誤時保留 outbox；對 server business rejection 轉成 conflict／rollback。更根本地，讓 legacy session 建立與 team phase transition 使用單一 server transaction 或明確的 operation correlation，避免兩個 authoritative path 產生分歧。

## Verification

- `npm.cmd run typecheck`：通過。
- OTA-01／OTA-04 相關 targeted tests：通過，但現有測試未實際執行上述 SQL payload validation 與 legacy session 競態。
