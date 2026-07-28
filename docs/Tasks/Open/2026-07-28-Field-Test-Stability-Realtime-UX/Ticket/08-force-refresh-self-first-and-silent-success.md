# 08 — 強制更新改為自己先更新且成功時靜默

**What to build:** 點擊成員位置強制更新後，先取得並顯示自己的最新位置、立即上傳，再要求其他成員更新；成功時不跳提示，但錯誤與冷卻仍明確顯示。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] self one-shot location 與 immediate upload 在 peer fan-out 前完成。
- [ ] 自己的 marker、距離與更新時間立即使用新 sample，不等待 group reload。
- [ ] accepted success 不顯示「已要求其他成員更新位置」。
- [ ] permission、無 fix、upload failure、fan-out failure 與 cooldown 仍有可操作回饋。
- [ ] 測試驗證呼叫順序、success alert 缺席與錯誤訊息保留。
