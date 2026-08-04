# 07 — 完成可驗證的 StoreKit 購買流程

**What to build:** 讓月／年 Premium 從 Apple 付款頁、簽章交易、伺服器驗證、個人 entitlement 持久化到 transaction finish 形成一條 fail-closed 流程，杜絕偽造交易與已付款未授權。

**Blocked by:** 05 — 建立個人 Premium 與團隊 Premium 投影；06 — 呈現月訂閱、年訂閱與七天試用資格。

**Status:** ready-for-agent

- [ ] Client 使用穩定且不可逆推個資的 app account token 綁定 Apple transaction 與 Hither user。
- [ ] Server 驗證 Apple 簽章、bundle、environment、product、transaction／original transaction、app account token 與有效狀態。
- [ ] 任意 transaction ID、placeholder、錯誤商品、錯誤環境、錯誤帳號或無法驗證資料一律 fail closed。
- [ ] 驗證成功後先 durable grant 個人 entitlement；只有成功或確認 duplicate 已持久化後才 finish transaction。
- [ ] 網路或 server 失敗時保留 unfinished transaction，重啟後能安全重處理。
- [ ] 使用者取消、pending、付款失敗與驗證失敗都不建立 entitlement。
- [ ] 同一交易重試不會重複 grant，且不會因 Client 重複 listener 產生多次付款流程。
- [ ] Apple sandbox 合法交易與偽造／錯誤交易 fixtures 有 server 與 client 端到端測試。

