# 05 — 額外集合點消耗額度

**What to build:** 讓已註冊團隊成員以 token 為目前 trip 增加 3 或 10 個一次性集合點額度；Free Plan 優先使用每 itinerary 5 個未完成點容量，只有成功建立第 6 個以上集合點時才扣額度。

**Blocked by:** 01 — 四分頁商店入口與滑動操作；02 — 安全 Token Wallet、Ledger 與 SSV 入帳

**Status:** ready-for-agent

- [ ] server catalog 提供額外 3／10 點團隊商品及核定價格、scope、active 狀態與排序。
- [ ] 任何已註冊的目前團隊成員可確認後用個人 token 增加團隊 credit；扣款與 credit grant 原子完成。
- [ ] 移除 temporary unlimited gathering-points 行為，正式恢復 server-authoritative Free Plan 限制。
- [ ] Free 上限只計算同一 itinerary scope 中 `closed_at IS NULL` 的未完成集合點，最多 5 個。
- [ ] 未完成點少於 5 個時新增不消耗 credit；Premium 有效時新增不消耗 credit。
- [ ] 已達 5 點、沒有 Premium、credit 大於 0 時，成功新增與扣除 1 credit 在同一交易內完成。
- [ ] 已達 5 點、沒有 Premium、credit 為 0 時回傳現有 point-limit 語意，不建立集合點。
- [ ] insert 失敗、權限失敗、重複請求或並行競爭不得造成額度遺失、負數或多建集合點。
- [ ] 完成或刪除集合點會釋放 Free 容量，但不退回已消耗 credit。
- [ ] credit 綁定目前 trip、沒有到期日、不可移轉；trip 清理時依同一生命週期清理。
- [ ] 路線頁僅在剩餘 credit 大於 0 時顯示「額外集合點剩餘 N」，歸零後完全隱藏。
- [ ] Premium 到期時保留已建立超額點；若未完成點仍超過 5，必須取得 credit／Premium 或降回上限內才能再新增。
- [ ] tests 涵蓋未完成點 4／5／6、closed point、credit 0／1、Premium on/off、insert failure、並行 insert、完成／刪除不退款與 UI 顯示／隱藏。
