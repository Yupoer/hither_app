# 01 — 修復跨文件來源的 KML／KMZ 匯入

**What to build:** 使用者從 iOS／Android 系統文件選擇器選擇 KML 或 KMZ 後，App 能可靠讀取、解析並顯示集合點預覽；取消、讀檔失敗、壓縮檔損壞與內容錯誤會得到不同且可重試的結果。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] iOS 與 Android 的本機、雲端文件 provider URI 都先轉成 App 可可靠讀取的資源，再交給同一 KML parser。
- [ ] KML 與 KMZ 成功案例都能從選檔走到集合點預覽，不改變既有匯入上限、隊長審批與進度行為。
- [ ] 使用者取消選檔時維持匯入畫面，不顯示錯誤。
- [ ] 讀檔、KMZ 解壓、找不到 KML、KML 無集合點、座標無效與檔案過大的錯誤可區分並可重試。
- [ ] 診斷只記錄失敗階段、平台、副檔名、MIME 與檔案大小，不記錄檔案內容或使用者路徑。
- [ ] fixture 測試涵蓋 KML、KMZ、空檔、損壞 zip、無 Point、無效座標及常見 URI scheme。
- [ ] 至少保留 iOS 與 Android 各一次真實系統文件選擇器驗證；無法執行時明確標記為未驗證，不以單元測試替代。
