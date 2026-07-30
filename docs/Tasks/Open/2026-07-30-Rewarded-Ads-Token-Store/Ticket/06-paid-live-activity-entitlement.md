# 06 — 即時動態付費權益

**What to build:** 讓使用者以 token 永久解鎖個人即時動態，或在目前團隊 Premium 有效期間取得臨時資格；未解鎖時工具頁顯示 locked 並能導向商店。

**Blocked by:** 01 — 四分頁商店入口與滑動操作；02 — 安全 Token Wallet、Ledger 與 SSV 入帳；04 — Premium 一／三／七日卡兌換

**Status:** ready-for-agent

- [ ] server catalog 提供個人即時動態永久商品及核定價格、scope、active 狀態與排序。
- [ ] 成功兌換時，個人 wallet 扣款與永久 user entitlement 在同一 server transaction 完成。
- [ ] 永久 entitlement 綁定已註冊帳號，可在重裝、換裝置、切換 trip 後恢復。
- [ ] effective entitlement 為「個人永久解鎖」或「目前團隊 Premium 有效」；兩者皆無時不得啟動 native Live Activity／Android Live Update。
- [ ] 現有本機即時動態開關只保存使用偏好，不再自行授予權益。
- [ ] 未解鎖時工具頁操作顯示 locked；點擊後切換到商店並定位個人即時動態商品。
- [ ] Premium 到期而沒有永久 entitlement 時停止新的即時動態啟動，並依既有生命週期安全結束不再合法的 session。
- [ ] 權益恢復時保留本機偏好，但不在兌換瞬間繞過導航生命週期建立錯誤 session。
- [ ] unsupported native runtime、Expo Go 與原生功能不可用時保持 graceful fallback，不把有 entitlement 誤顯示成 native 已運作。
- [ ] 不自動 grandfather 現有帳號；需要保留的測試者使用既有 promo／server grant 路徑。
- [ ] tests 涵蓋永久個人、團隊 Premium、兩者同時、皆無、Premium 到期、跨裝置 restore、本機偏好 true/false、locked 導頁與 unsupported runtime。
