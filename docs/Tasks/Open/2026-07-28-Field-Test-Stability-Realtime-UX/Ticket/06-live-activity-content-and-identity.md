# 06 — 統一 Live Activity 內容、名稱與圖示

**What to build:** 每個導航 session 只保留一個 Live Activity；完整尺寸顯示集合點名稱、距離、ETA、進度與抵達人數，其他系統尺寸在容量內保持相同語意與正確交通圖示。

**Blocked by:** 04 — 以本機定位驅動所有個人即時進度.

**Status:** ready-for-agent

- [ ] push-to-start 與 App 內 start 能識別並收斂成同一 activity，不留下完整/簡化兩個並存實例。
- [ ] 有目標時所有尺寸優先顯示集合點名稱，隊伍名稱只在目標名稱缺失時 fallback。
- [ ] Lock Screen 與 expanded Dynamic Island 顯示距離、ETA、進度、抵達/總人數。
- [ ] 移除「前往集合點」前的重複交通圖示，leading identity 使用目前交通方式圖片並保留可及性文字。
- [ ] compact/minimal 在 iOS 固定尺寸內呈現核心資訊；文件與 UI 不宣稱能強迫系統永遠展開。
- [ ] native update 節流與 database persistence 節流均有回歸測試。
