# 04 — Premium 一／三／七日卡兌換

**What to build:** 讓任何已註冊團隊成員以自己的 token 為目前 2–5 人 trip 兌換 Premium 一日、三日或七日卡，並在 Account／Premium 狀態看到 server-valid 到期時間。

**Blocked by:** 01 — 四分頁商店入口與滑動操作；02 — 安全 Token Wallet、Ledger 與 SSV 入帳

**Status:** ready-for-agent

- [ ] server catalog 提供一日、三日、七日團隊商品及核定價格、scope、active 狀態與排序。
- [ ] 兌換前顯示目前團隊名稱、期限、token 價格與不可退款提示；使用者確認後才提交。
- [ ] 只有已註冊且仍是目前團隊有效成員的使用者可兌換，token 從兌換者個人 wallet 扣除。
- [ ] 兌換與 trip entitlement grant 在同一 server transaction 內完成；餘額不足、權限或 grant 失敗皆不扣 token。
- [ ] 1／3／7 日卡沿用 Small Trip 2–5 人適用範圍並綁定目前 trip，不洩漏到其他 trip。
- [ ] 尚有效的 token 日卡再次兌換時，從既有到期時間延長；已過期則從 server 現在時間起算。
- [ ] 團隊已有有效 lifetime、verified purchase 或 promo Premium 時，日卡回傳不適用且不扣 token。
- [ ] Premium 有效期間提供現有 Premium 權益、無限集合點與團隊成員即時動態資格。
- [ ] Account／Premium 狀態顯示團隊、source、到期時間與剩餘時間，重裝或換裝置後由 server 恢復。
- [ ] 到期後不刪除既有旅程或超額集合點；既有點仍可查看、排序、導航與完成。
- [ ] tests 涵蓋三種期限、累加、到期、2–5 人邊界、跨 trip 隔離、既有其他 entitlement、餘額不足、並行兌換與失敗回滾。
