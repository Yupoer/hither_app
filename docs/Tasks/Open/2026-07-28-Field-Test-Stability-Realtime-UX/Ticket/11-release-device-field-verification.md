# 11 — 完成 release-like 外出情境整合驗證

**What to build:** 在 release-like iOS/Android 實機重跑本批外出情境，證明 crash、即時進度、Live Activity、地圖、成員更新、被動模式與效能修改能共同運作。

**Blocked by:** 02 — 修正 OTA 重載與更新後進入隊伍閃退; 03 — 修正外出導航發熱、卡頓與音訊干擾; 04 — 以本機定位驅動所有個人即時進度; 05 — 修正集合點抵達、完成與卡片層級; 06 — 統一 Live Activity 內容、名稱與圖示; 07 — 加入目前目標旗幟的五秒提示動畫; 08 — 強制更新改為自己先更新且成功時靜默; 09 — 簡化被動模式文案並共用完整快捷指令; 10 — 啟用 Google Transit 並強化 Apple 大眾運輸顯示.

**Status:** ready-for-agent

- [ ] 執行 OTA apply→重啟→查看我的隊伍→進入隊伍，不發生未預期 termination。
- [ ] 實際移動時卡片、我的進度與 Live Activity 同步更新，抵達/延後完成/完成流程正確。
- [ ] 驗證單一 Live Activity、集合點名稱、完整內容、交通圖示與系統 compact 降級。
- [ ] 驗證目標旗幟 pulse、自己先更新、無成功提示、被動模式完整/自訂指令與兩種 map provider。
- [ ] 播放 Podcast 並執行前背景、鎖屏、導航、高精準切換；相較 baseline 無 thermal、CPU、frame stall、audio 或 watchdog 回歸。
- [ ] 將裝置、OS、build、update ID、測試時間與量測摘要寫入任務 Report。
