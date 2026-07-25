# 01 — 建立正式方案權益與限制

**What to build:** 讓 Free Plan 與 Small Trip Premium Pass 的人數、行程點數、trip scope、啟用時間與到期時間由 server 判定，並讓 App 顯示與 server 結果一致。

**Blocked by:** None — can start immediately

**Status:** done

- [x] Free Plan 以含 Leader 的總人數 5 人與每 itinerary 5 點為限制。
- [x] Small Trip Pass 僅接受 2–5 人旅程，綁定單一 trip 並在 7 天後失效。
- [x] server 對過期、撤銷、退款、無效與重複授權回傳可區分的結果。
- [x] client 不再以直接寫入 Pro 狀態作為權益來源。
- [x] 方案限制與 entitlement contract 測試涵蓋邊界值。
