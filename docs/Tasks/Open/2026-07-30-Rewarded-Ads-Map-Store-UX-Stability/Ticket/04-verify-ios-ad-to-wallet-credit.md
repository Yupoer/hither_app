# 04 — 驗證 iOS 廣告至 Wallet Token +1 完整流程

**What to build:** 以包含正確原生依賴的新 iOS release-like 安裝檔，證明使用者可以從商店觀看 Rewarded Ad，經 Google SSV 後只獲得一個 Token；同時留下 Android 的獨立驗證結果或明確未驗證狀態。

**Blocked by:** 02 — 同步 iOS／Android AdMob 原生設定; 03 — 強化 Rewarded Ads 原生邊界與生命週期復原.

**Status:** ready-for-agent

- [ ] iOS 新安裝檔可完成「開啟商店 → 觀看廣告 → 看完 → 等待 SSV → wallet balance +1」，過程不閃退。
- [ ] 入帳由 server-authoritative wallet snapshot 與 append-only ledger 證明，手機端不直接寫入 Token。
- [ ] 同一 Google transaction 或 reward session 的重複 callback 最多產生一筆入帳。
- [ ] 提前關閉、無填充、離線、載入／顯示失敗與 SSV 拒絕均不增加 Token，且介面可恢復或重試。
- [ ] late SSV 可以在重新整理或重新開啟商店後反映正確餘額，不需要重看一次廣告才能同步。
- [ ] 證據包含 App／原生版本、平台、測試廣告設定、生命週期結果與去識別化 server 結果，不包含秘密或個人資料。
- [ ] Android 若有可用環境，執行相同 smoke flow；若沒有，明確記錄「Android 未驗證」，不得由 iOS 結果推定通過。
- [ ] 驗證結論區分自動化測試、模擬器／裝置、server 與 release-like 原生證據，且不把任何一種證據擴張成其他環境已通過。
