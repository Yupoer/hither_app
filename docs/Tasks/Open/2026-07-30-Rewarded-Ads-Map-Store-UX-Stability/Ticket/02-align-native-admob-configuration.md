# 02 — 同步 iOS／Android AdMob 原生設定

**What to build:** 讓已提交原生專案、Expo 設定與實際新安裝檔包含一致的 Google Mobile Ads／UMP 設定與依賴，使商店可以安全進入 Rewarded Ad 流程，而不因缺少原生設定或模組終止 App。

**Blocked by:** 01 — 蒐集 iOS Rewarded Ads 閃退與版本證據.

**Status:** ready-for-agent

- [ ] 依 Ticket 01 證據修正 iOS 已提交原生專案中的 Google Mobile Ads App ID、原生模組與 UMP 依賴不一致。
- [ ] 確認 Android 已提交或產生的原生設定包含對應 App ID 與所需原生模組，且與 Expo 設定一致。
- [ ] 從乾淨原生依賴狀態產生 iOS 新安裝檔，確認原生依賴解析結果包含 Rewarded Ads 與 UMP。
- [ ] 啟動新安裝檔時不因 Google Mobile Ads 初始化、缺少 App ID 或缺少原生模組而終止程序。
- [ ] 開發／測試環境使用 Google 測試廣告或已登錄測試裝置，不以正式廣告流量作為開發驗證。
- [ ] 舊安裝檔或不支援的執行環境不被誤判為已修復；介面提供更新 App 或無法使用的明確狀態。
- [ ] 驗證報告明確註明此修正需要新原生安裝檔，不能以 OTA 結果取代。
- [ ] 未更動 Token、SSV、wallet、ledger 或商品資料契約。
