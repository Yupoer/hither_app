# 02 — Operation outbox 與同步衝突結果

**What to build:** 讓離線 mutation 先以 operation outbox 安全保存，連線後可重試、去重、處理版本衝突，並把同步結果回寫本地狀態。

**Blocked by:** 01 — 核心旅程快照與離線讀取

**Status:** done

- [x] local state 與 outbox operation 在同一個 transaction 中寫入。
- [x] operation 具有 id、entity version、retry state 與 conflict result。
- [x] 重送同一 operation 不會產生重複副作用。
- [x] stale version 會回傳可顯示的 conflict，而非靜默覆寫。
- [x] reconnect、process termination 與 outbox replay contract 測試通過。
