# 05 — 整合 Server-owned Coordination Deadline

**What to build:** 讓 coordination request 的到期結算由伺服器排程 owner 負責，即使 Client 關閉仍能完成；前景 Client 不再固定寫入 deadline resolver。

**Blocked by:** 02 — 將已提交 Premium／Map 修正重播到最新 master。

**Status:** done (source + client); multi-connection SKIP LOCKED Unverified

- [x] service-role scheduler 只處理到期且仍 open 的 request，使用 bounded batch 與可觀測錯誤結果。
- [x] concurrent workers 透過 row locking／skip-locked 等等價機制避免重複 claim，同一 request 重試保持冪等。
- [x] 部分 batch 失敗不吞掉其他結果，失敗項目可安全重試且不延後已成功結算。
- [x] Client 移除固定 resolver write／read cadence，仍透過 Realtime 與既有 recovery snapshot 收到結果。
- [x] 資料庫 runtime 測試涵蓋 concurrent claim、retry、empty batch、partial failure、authorization 與冪等（單 session pgTAP；雙連線 concurrency Unverified）。
- [x] 沒有 Supabase scheduler／service-role runtime 證據時標成 Implemented locally 或 Unverified，不宣稱 production 已運行。
- [x] Deadline 相關 migration、tests、Client contract 與文件在清冊中全部有落點。

**Evidence:** `process_due_coordination_requests`；client 無 `setInterval`／`OPEN_REQUEST_RECOVERY_INTERVAL_MS`；pgTAP scheduler tests。
