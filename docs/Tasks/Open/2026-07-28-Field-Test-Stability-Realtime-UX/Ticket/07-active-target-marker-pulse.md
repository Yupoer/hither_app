# 07 — 加入目前目標旗幟的五秒提示動畫

**What to build:** 地圖同時顯示多個集合點時，只有目前正在前往的旗幟每五秒短暫縮放或搖動一次，並在狀態改變後立即停止。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 只有 active destination 動畫，非目標與完成點保持靜止。
- [ ] 動畫每五秒觸發一次短 pulse，不是持續動畫。
- [ ] 切換目標、抵達完成、App 背景、unmount 與 Reduce Motion 都會停止或改用靜態強調。
- [ ] 不開啟持續 marker bitmap tracking，不造成全地圖 re-render。
- [ ] fake timer/animation contract 與實機 frame/thermal 檢查通過。
