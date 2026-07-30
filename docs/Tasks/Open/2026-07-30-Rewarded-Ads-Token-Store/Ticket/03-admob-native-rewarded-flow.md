# 03 — AdMob Native Rewarded Ad 流程

**What to build:** 讓已註冊使用者從商店主動載入並觀看 iOS／Android Google Rewarded Ad，完成後進入 server 驗證狀態，直到 SSV 入帳後看到更新的 token 餘額。

**Blocked by:** 01 — 四分頁商店入口與滑動操作；02 — 安全 Token Wallet、Ledger 與 SSV 入帳

**Status:** ready-for-agent

- [ ] 加入支援 Expo config plugin、Rewarded Ads、SSV custom data 與 UMP consent 的 Google Mobile Ads native integration。
- [ ] native App ID 使用核定的 iOS／Android App ID；Rewarded Ad Unit 依平台選擇，開發與自動測試使用 Google 官方 test unit。
- [ ] 廣告請求前完成最新 UMP consent 判定；不能請求廣告時提供可理解、可重試且不 crash 的狀態。
- [ ] CTA 狀態完整涵蓋載入中、可以播放、播放中、已關閉、Google 驗證中、已入帳、no fill、網路錯誤與重新載入。
- [ ] 使用者必須明確點擊才顯示廣告；App 開啟、導航、抵達、集合點完成與切頁都不自動播放。
- [ ] reward session 建立成功後才允許展示對應廣告；同一時間不會因重複點擊載入或顯示多個廣告。
- [ ] client rewarded callback 不直接修改 token，只切換 verifying UI 並等待 server snapshot。
- [ ] SSV 延遲、App 背景化或重開時可恢復 verifying／credited 結果，不要求使用者重看同一廣告。
- [ ] 使用者可在一個 session 結束後立即載入下一個可用廣告，App 不實作每日或 24 小時頻率限制。
- [ ] native module 缺失、Expo Go、unsupported runtime 與廣告 SDK 初始化失敗時優雅降級，不影響其他三個區塊。
- [ ] focused tests 驗證狀態轉移、匿名 gate、重複點擊、dismiss without reward、late SSV、no fill 與 error recovery。
- [ ] Android emulator 與 iOS simulator 以 Google test ads 保留 load/show/dismiss/reward callback 證據；未驗證的平台不得標記 native 完成。
