# 08 — 同步續訂、到期、退款、撤銷與恢復購買

**What to build:** 透過 Apple server lifecycle 與交易歷史保持個人／團隊 Premium 正確，即使使用者未開啟 App、換機、續訂失敗或退款，權益仍會收斂到 Apple 的有效狀態。

**Blocked by:** 07 — 完成可驗證的 StoreKit 購買流程。

**Status:** ready-for-agent

- [ ] App Store Server Notifications V2 驗證 notification 簽章並處理 renewal、expiration、refund、revocation 與方案變更。
- [ ] webhook、Client purchase reconciliation 與 restore 共用冪等 transaction／entitlement ledger。
- [ ] notification 重播、亂序與重試不會重複 grant，也不會讓較舊狀態覆蓋較新狀態。
- [ ] Restore 以 Apple transaction history／current entitlement 與 Hither server ledger reconciliation 為準，不只取單一本地 purchase。
- [ ] 換機或「Apple 已付款但初次 grant 失敗」能在驗證後補發 entitlement。
- [ ] 到期、退款或撤銷會更新個人 Premium，並在最後一名有效 Premium 消失時關閉相關團隊功能。
- [ ] monthly／annual 方案切換與 introductory offer 結束後續訂保持同一個人 ownership。
- [ ] sandbox notifications、restore、重播、亂序與 membership 重算有端到端測試。

