# 05 — 建立個人 Premium 與團隊 Premium 投影

**What to build:** 將 Premium ownership 固定為個人訂閱，同時提供「目前團隊至少一名現役成員有效訂閱」的團隊能力投影，供個人功能與團隊功能分別判斷。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] entitlement owner 是 Hither user，不再綁定單一 trip 或自動轉移給 Leader。
- [ ] 個人 Premium 功能只讀取目前使用者的有效 entitlement。
- [ ] 團隊 Premium 功能只在目前 memberships 中至少一名使用者具有有效 entitlement 時開啟。
- [ ] Premium 成員加入新團隊後，該團隊重新計算並開啟團隊功能。
- [ ] 最後一名 Premium 成員離隊或被移除後，舊團隊立即關閉團隊功能，但該使用者個人 Premium 不受影響。
- [ ] 到期、退款與撤銷造成最後一份有效 entitlement 消失時，團隊功能關閉。
- [ ] 零、一、多名 Premium 成員及同一使用者加入多個團隊都有 server-authoritative 測試。
- [ ] 舊七天 trip pass 資料有明確相容或淘汰策略，不被誤認為新的 auto-renewable subscription。
