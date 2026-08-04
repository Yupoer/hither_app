# 03 — 將協調請求 Deadline 移到伺服器

**What to build:** 讓協調請求的 deadline 由伺服器準時結算，Client 只接收結果與執行必要恢復，不再由每台前景裝置每 45 秒固定寫入 resolver 再讀取 requests。

**Blocked by:** 01 — 建立啟動能耗觀測與 Instruments 基線。

**Status:** ready-for-agent

- [ ] deadline resolver 有單一 server-side 排程 owner，App 關閉時仍能完成到期決策。
- [ ] 沒有 open coordination request 時，Client 週期性 deadline write 與其後 read 均為零。
- [ ] 有 open request 時，使用者透過 Realtime 收到 resolved outcome；missed event 可由既有 60 秒 recovery 恢復。
- [ ] 多個排程觸發、重試或多 Client 同時在線不會重複套用結果。
- [ ] deadline policy、default outcome、已手動解決與剛好跨 deadline 的競態維持既有產品語意。
- [ ] 排程失敗可觀測且可安全重試，不使用無上限 Client retry。
- [ ] before／after 證據包含 idle 與 open-request 情境的 RPC／GET 數量。
- [ ] server resolver、Realtime delivery、recovery 與冪等有端到端測試。

