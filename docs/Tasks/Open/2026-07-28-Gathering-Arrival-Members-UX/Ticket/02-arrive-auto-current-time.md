# 02 — 抵達一律套用當下時間且不跳出選擇

**What to build:** 使用者點集合點「抵達」後，直接以裝置當下時間寫入抵達，不再顯示抵達時間選項（隊長時間／當下／同步等），也不因時間選擇再跳出提示。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Self Arrive 路徑不再呈現抵達時間 Alert。
- [ ] 寫入的抵達時間為當下（now），不需使用者選擇。
- [ ] 抵達成功後既有個人抵達 UI（勾選、指令列）仍可用。
- [ ] 失敗時仍顯示既有抵達錯誤回饋。
- [ ] 測試鎖定：無 time-choice UI、timestamp policy 為 now。
