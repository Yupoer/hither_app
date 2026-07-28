# 04 — 以本機定位驅動所有個人即時進度

**What to build:** 每次本機接受新的定位取樣時，立即以同一份衍生模型更新集合點卡片、我的進度與 Live Activity 的距離、ETA、進度，不等待位置上傳或 Realtime 回傳。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 距離由最新有效本機座標與目前目標計算；ETA 使用目前交通方式；進度以初始距離計算並限制在 0–100%。
- [ ] 集合點卡片、我的進度與 Live Activity 讀取同一份 personal progress model。
- [ ] GPS jitter、暫時無 fix、遠離目標、抵達、完成與切換目標都有確定行為。
- [ ] 本機顯示更新與後端上傳 cadence 分離，沒有新增 watcher、polling loop 或 Supabase round trip。
- [ ] 表格化測試證明三個 surface 在同一 sample 後得到一致結果。
