# 04 — 成員更新改為 push＋pull 並刷新自己狀態列

**What to build:** 成員區塊「更新」會把本機位置 push 到遠端、再 pull 遠端成員／群組位置資料，並立刻更新自己在成員列的狀態；成功後不得仍顯示「尚無位置更新」（若已有有效 sample）。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 更新流程順序：self one-shot + upload（push）→ remote pull／roster reload。
- [ ] 自己的成員列 freshness 使用最新有效 sample，成功後不再卡在「尚無位置更新」。
- [ ] 成功可靜默；permission、cooldown、失敗仍有明確回饋。
- [ ] 測試驗證呼叫順序與 self-row 文案更新。
