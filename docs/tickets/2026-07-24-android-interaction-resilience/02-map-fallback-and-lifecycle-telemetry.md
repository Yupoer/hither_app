# 02 — Map fallback 與 lifecycle telemetry 修正

**What to build:**

讓 Map React subtree 發生錯誤時穩定停留在可操作 fallback，最多允許一次使用者重載；普通 re-render 不得清除 fallback。Map ready 後未 loaded 的診斷事件與 lifecycle telemetry 必須符合既定事件契約。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] fallback 不會因 parent re-render 自動消失
- [ ] 使用者 retry 最多重建一次 Map surface
- [ ] 第二次失敗仍保留 fallback，並可回到主畫面
- [ ] ready 後未 loaded 記錄 `map_loaded_timeout`，且不自動 remount
- [ ] 保留 provider、initialCenter 與 Android location callback ownership 契約

