# 02 — 修正 OTA 重載與更新後進入隊伍閃退

**What to build:** 讓「立即更新」只執行一次可辨識的重載，並讓重新啟動後從「查看我的隊伍」進入既有隊伍可重複、安全地完成，不再發生 process termination 或未處理例外。

**Blocked by:** 01 — 建立 7/28 外出實測證據與後端外送清單.

**Status:** ready-for-agent

- [ ] 以指定時間窗或可重現步驟確認兩次離開 App 的實際 crash class 與最後 action。
- [ ] 手動與自動 OTA apply 共用 single-flight lifecycle；連點、pending update、fetch failure 與 reload failure 都有確定結果。
- [ ] 更新後 membership hydration、navigation replace、Live Activity 清理與 map mount 可重入且不讀取失效狀態。
- [ ] 新增最小回歸測試，覆蓋 apply→reload→查看我的隊伍→進入隊伍與重複點擊。
- [ ] release-like iOS/Android 驗證沒有新 native termination、空白畫面或卡死。
