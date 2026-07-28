# 05 — 修正集合點抵達、完成與卡片層級

**What to build:** 集合點抵達與完成後顯示正確的旗幟、卡片與主要動作；選擇「先不要完成」後仍可隨時按「完成」，卡片後方永遠不露出同步黑條。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 完成點的旗幟移除 active glow/shadow/elevation，且不再被當成目前目標。
- [ ] 集合點卡片任何狀態下都不顯示或透出「變更已保存，等待連線同步」。
- [ ] 全員抵達後選「先不要完成」，主要按鈕為「完成」且不回到「開始」。
- [ ] 重載、Realtime 更新與 outbox pending 後仍保持相同可操作狀態。
- [ ] 擴充既有 gathering/local-first/UI contract，並完成一條實機操作驗證。
