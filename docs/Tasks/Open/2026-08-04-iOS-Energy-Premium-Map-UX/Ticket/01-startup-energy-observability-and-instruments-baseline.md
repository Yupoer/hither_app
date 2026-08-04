# 01 — 建立啟動能耗觀測與 Instruments 基線

**What to build:** 建立可觀察 App 開啟後前兩分鐘的低負擔效能接縫，讓開發者能把 CPU、記憶體、畫面、地圖、定位、網路與同步活動對齊同一個 session，並以固定 Instruments 情境產生可比較的基線。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 啟動後 0、15、30、60、120 秒各產生至多一筆效能樣本，進入背景、登出或 unmount 時取消未執行採樣。
- [ ] 穩定期恢復既有低頻採樣，不留下高頻 timer、render loop 或網路 flush。
- [ ] 樣本可區分 CPU、physical memory、FPS、thermal、App state、tracking mode、location callback、accepted location、route recalc、Realtime callback、snapshot、render 與 request count。
- [ ] 無法安全從 App 取得的 GPU、MapKit compositor 與 radio 指標明確交由 Instruments／MetricKit，不建立虛假近似值。
- [ ] launch、map ready、location acquisition、snapshot、route calculation、marker tracking 與 background transition 有可在 Instruments 對齊的 signpost。
- [ ] 診斷資料不包含 access token、精確座標、邀請碼、Apple transaction payload 或其他個人資料。
- [ ] 固定 Map visible／非地圖頁、定位 on／off、網路 on／blocked 的三分鐘 A/B protocol，記錄 build、裝置、OS、電量、亮度與網路條件。
- [ ] 測試驗證採樣時序、取消、去重、敏感資料排除與穩定期低頻行為。
