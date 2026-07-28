# 03 — 修正外出導航發熱、卡頓與音訊干擾

**What to build:** 依 7/28 證據移除造成過量 CPU、radio/GPS 喚醒、背景工作或 render churn 的根因，使長時間地圖導航不再明顯發熱、卡頓或干擾 Podcast。

**Blocked by:** 01 — 建立 7/28 外出實測證據與後端外送清單.

**Status:** ready-for-agent

- [ ] 只修正報告中有量測證據的 hot path，並記錄修改前後 CPU、thermal、memory、frame stall、network count 與 background duration。
- [ ] 確認沒有重複定位 owner、無界 retry、過密 route recompute、持續 marker bitmap tracking 或 whole-screen GPS render。
- [ ] 保留定位、抵達、outbox、Live Activity、Realtime 與 session acknowledgement 語意。
- [ ] 最小自動測試能防止被修正的 timer/subscription/render/upload 回歸。
- [ ] release-like 實機在 Podcast 播放、前背景切換與導航期間達成報告設定的效能門檻。
