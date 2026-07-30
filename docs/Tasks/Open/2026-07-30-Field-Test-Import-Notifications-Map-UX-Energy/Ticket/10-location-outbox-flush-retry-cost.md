# 10 — 降低位置 outbox flush 延遲與失敗重試

**What to build:** 原地與低移動情境不會因位置 outbox 的慢速 flush、重複 flush 或失敗重試持續喚醒 CPU／網路；明確操作仍立即同步，被動位置仍維持產品要求的更新節奏。

**Blocked by:** 08 — 建立原地發熱的可比較效能基線.

**Status:** ready-for-agent

- [ ] 以 Ticket 08 證據分辨目前 p95 接近 2 秒來自本機序列化、SQLite、等待網路、伺服器處理、併發排隊或 retry backlog。
- [ ] 同一 outbox 在同一時間只有一個有效 flush；前景、背景、heartbeat 與手動同步不會建立平行重複工作。
- [ ] 原地樣本依既有 motion gate／coalescing 重用最後位置，不因 15 秒 timer tick 每次新增或立即上傳。
- [ ] 被動位置維持 30 秒至 1 分鐘的產品同步語意；明確 Force Refresh、開始／抵達等操作仍可立即同步。
- [ ] 暫時性失敗使用有界 retry 與 backoff，永久拒絕安全丟棄；不建立無界 queue 或無限重試。
- [ ] 失敗批次不阻擋更新、較新且有效的位置事件；coalescing 不跨 group、navigation session 或必要事件邊界。
- [ ] diagnostics 能區分等待本機 serial queue、RPC latency、retry delay 與永久拒絕，但不增加高頻寫入本身的耗電。
- [ ] focused 測試涵蓋同時 flush、前背景切換、靜止 heartbeat、慢網路、暫時性失敗、永久拒絕與手動立即同步。
- [ ] 使用 Ticket 08 相同情境重測；outbox p95 與超過 1 秒次數需明確下降，或證明不可控網路等待已移出高頻關鍵路徑。
