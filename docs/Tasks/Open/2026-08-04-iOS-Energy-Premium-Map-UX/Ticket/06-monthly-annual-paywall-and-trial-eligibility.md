# 06 — 呈現月訂閱、年訂閱與七天試用資格

**What to build:** 在 Premium 付款頁顯示 Apple 提供的月訂閱與年訂閱商品資訊，以及符合資格者的七天免費試用，讓使用者在進入付款確認前看到正確方案。

**Blocked by:** 05 — 建立個人 Premium 與團隊 Premium 投影。

**Status:** ready-for-agent

- [ ] 同一 subscription group 提供 monthly 與 annual 兩個 auto-renewable subscription。
- [ ] 商業目標價格為月費 NT$60、年費 NT$400；UI 顯示 StoreKit localized display price，不使用硬編價格冒充商店價格。
- [ ] 七天免費試用以 introductory offer 呈現，是否符合資格由 App Store 判定，不使用本地 boolean。
- [ ] 不符合試用資格時不顯示或承諾免費七天。
- [ ] 使用者能清楚選擇月繳或年繳，並理解試用結束後會自動續訂。
- [ ] 商品未配置、StoreKit 不可用、離線與舊 runtime 都顯示可復原且不會本地解鎖的狀態。
- [ ] 移除舊七天 trip pass、NT$30 與單次購買語意。
- [ ] 商品載入、方案切換、試用資格、取消與不可用狀態有行為測試。

