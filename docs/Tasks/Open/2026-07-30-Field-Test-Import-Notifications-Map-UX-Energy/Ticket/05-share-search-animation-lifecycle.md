# 05 — 修正分享與搜尋動畫生命週期

**What to build:** 分享與搜尋按鈕的完成格由外部操作生命週期控制：分享視窗關閉、搜尋頁顯示完成後，動畫才重設；取消、失敗與 reduced-motion 都能正確解除 busy。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 延伸既有 Amicro 按鈕的受控完成狀態，不建立第二套動畫元件。
- [ ] 分享動畫完成後才開啟系統分享視窗，並在系統分享 Promise 完成或取消後回到起始格。
- [ ] 分享 API throw 或不可用時會顯示既有錯誤處理並解除 busy，不會留下永久完成格。
- [ ] 搜尋動畫完成後才開啟搜尋地點頁，並在該頁完成顯示後回到起始格。
- [ ] 搜尋頁開啟失敗或被關閉時，按鈕能恢復且下一次點擊仍有效。
- [ ] 動畫進行或外部操作尚未結束時，重複點擊不會重複開啟分享視窗或搜尋頁。
- [ ] reduced-motion 路徑保留相同先後順序與單次操作語意，不因零動畫時間跳過功能。
- [ ] 行為測試驗證 animation complete、外部 Promise／頁面 open complete、reset 的順序，以及取消與失敗路徑。
