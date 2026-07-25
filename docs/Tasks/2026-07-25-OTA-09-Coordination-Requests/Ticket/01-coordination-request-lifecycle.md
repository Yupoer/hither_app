# 01 — 建立協調請求生命週期

**What to build:** 讓 Leader 能針對集合點、時間、路線或行程建立協調請求，成員能回應，且 request 狀態能從 open 到 resolved 或 expired。

**Blocked by:** None — can start immediately

**Status:** done

- [x] request 保存 subject、options、deadline、policy、default outcome 與 status。
- [x] participant response 與 navigation technical state 分開保存。
- [x] 未回覆維持 null／unanswered，不轉成同意或拒絕。
- [x] 關閉後拒絕新回應，並保留可查詢的 resolved outcome。
- [x] 開啟 request 不阻塞立即啟動的導航。
