# OTA-04 Code Review

> 日期：2026-07-26  
> 結果：**未通過，任務保留於待審區**

## Findings

### [P1] local-first outbox 與 legacy navigation session 不是同一個可一致提交的 operation

`apps/mobile/src/state/coreDataSync.ts:105-113` 在 SQLite 寫入 optimistic gathering 與 outbox 後即非同步 flush；`apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts:160-186` 才呼叫 `startSession`，而且把所有錯誤都視為 offline。當 `startSession` 因為 session 已存在、權限／狀態競態或其他 business rejection 失敗時，先前的 core outbox 仍可重試並成功。`supabase/migrations/20260725000200_core_operation_sync.sql:440-460` 只依 core operation bridge `groups` 為 going，沒有確認相符的 `navigation_sessions`。

結果是 SQLite、`core_entity_versions`、legacy `groups` 與 navigation session 可能互相矛盾；重新連線後 client 會把一個沒有實際導航 session 的 team phase 當成 authoritative，違反 OTA-04 的 remote-authoritative convergence 與 OTA-01 的跨裝置一致性。

**修正要求：**將 gathering transition 與 session 建立合併為同一個 server-side transaction／correlation，或讓 core RPC 在套用前驗證對應 session；對非暫時性錯誤將 outbox 寫成 conflict 並回寫 server state，而不是無條件重試。

### [P1] server core operation 接受未驗證的 itinerary entity，local-first replay 可污染共享狀態

`supabase/migrations/20260725000200_core_operation_sync.sql:294-415` 對 active gathering 只驗證 phase 與 payload 是否有 ID，沒有驗證 `activeDestinationId`／`nextDestinationId` 是否屬於 `p_group_id`、是否已完成、是否為下一個合法點。End 還會把未知的 `nextDestinationId` 新增為 pending。這使離線 operation replay 的 idempotency 與 versioning 建立在未驗證 domain state 上，並可能將錯誤 state bridge 到 `groups`。

**修正要求：**把 itinerary ownership、順序、closed／point status 與 transition legality 放進 RPC 的 transaction lock 內驗證；新增實際 SQL integration tests，而不是只以 migration 字串 contract test 覆蓋。

## Verification

- `npm.cmd run typecheck`：通過。
- OTA-04 targeted tests：通過；現有測試涵蓋 local applicator，但未涵蓋 remote RPC 與 legacy session 的一致性。
