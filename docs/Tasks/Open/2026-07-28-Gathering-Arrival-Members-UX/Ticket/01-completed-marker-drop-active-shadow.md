# 01 — 完成後集合點標記移除 active 陰影

**What to build:** 集合點被 team-complete（`closedAt`）後，地圖旗幟不再帶 active 陰影／glow／elevation，也不再被當成目前目標或脈衝動畫對象。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Team-completed 標記使用非 active 樣式，無 active shadow／glow／elevation。
- [ ] Completed 集合點不進入 target pulse／active target 集合。
- [ ] 個人抵達但尚未 team-complete 的點不因本 ticket 被誤標成 completed 樣式。
- [ ] 擴充既有 marker／pulse contract，並完成一條地圖狀態驗證路徑。
