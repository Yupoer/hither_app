# 06 — 整合 Premium、StoreKit 與 Supabase 安全交付鏈

**What to build:** 完成月／年訂閱、七天 introductory offer、個人與團隊 Premium projection、交易驗證、durable grant、notification lifecycle 與 restore，使 Client 與 server contract 可依安全順序發布。

**Blocked by:** 02 — 將已提交 Premium／Map 修正重播到最新 master。

**Status:** done (source / client local); Apple sandbox + Deno Unverified/Blocked

- [x] 月／年 catalog 顯示 StoreKit localized price，trial 只在 Apple eligibility 與有效 introductory offer 同時成立時呈現。
- [x] Apple JWS、certificate chain、bundle、environment、product、transaction、account token、purchase／expiry／revocation 狀態缺一即 fail closed（source；sandbox Unverified）。
- [x] entitlement durable grant 或冪等確認成功後才 finish transaction；失敗保留 unfinished purchase，啟動與 foreground 可恢復。
- [x] notification ledger 對 duplicate、out-of-order、immutable payload、renewal、expiration、refund、revocation 與 retry 保持冪等且 order-safe（source）。
- [x] Restore 與 reconciliation 以 Apple history／current entitlement 及 server ledger 為準，不以 local flag 解鎖（source）。
- [x] 個人 Premium 只屬於訂閱者；團隊 projection 隨現役 membership 與 entitlement 變動重算，legacy Pro／trip pass 不成為新來源；trigger REVOKE 已 hardening。
- [x] migration、Edge Function、SQL tests 與 Client contract 成套進 Git；Deno tests 環境不可用。
- [x] Apple sandbox、Deno、pgTAP／Supabase runtime 與 App Store Connect 配置各自有 Pass／Fail／Unverified／Blocked，不互相替代。
- [x] Native dependency／設定變更明確標記需要新 binary，不以 OTA 取代。
