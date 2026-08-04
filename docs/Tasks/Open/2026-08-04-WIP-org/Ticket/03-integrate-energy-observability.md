# 03 — 整合啟動能耗觀測與原生 profiling seam

**What to build:** 讓 Hither 在啟動前兩分鐘提供有限且隱私安全的觀測，穩定期自動降頻，進入背景或 unmount 後停止，並為 Instruments 與 MetricKit 保留可對齊的原生事件邊界。

**Blocked by:** 02 — 將已提交 Premium／Map 修正重播到最新 master。

**Status:** done (client); Instruments/MetricKit runtime Unverified

- [x] 0、15、30、60、120 秒各產生預期啟動樣本，且不因重 render 重複建立 sampler。
- [x] 穩定期切換低頻採樣，App background 與 owner unmount 取消所有計時與訂閱。
- [x] 樣本涵蓋 CPU、memory、FPS、thermal、location、route、Realtime、snapshot、render 與 network counters，並以 delta／window 語意避免誤讀累計值。
- [x] signpost 與 MetricKit lifecycle 可重入且不含 token、座標、邀請碼或個資；無法安全取得的 GPU／radio 指標不偽造。
- [x] 自動化驗證 sampler timing、cancellation、counter reset／delta、privacy filter 與重複 mount 行為。
- [ ] 建立 Map visible／非地圖頁、定位 on／off、網路 on／blocked 的 Instruments A／B protocol；未執行實機時狀態為 Unverified。
- [x] WIP 清冊中所有 Energy 來源與文件均有落點或明確排除處置。

**Evidence:** `energyObservability.ts` pauseForBackground/resumeFromForeground；Jest energyObservability.test.ts。
