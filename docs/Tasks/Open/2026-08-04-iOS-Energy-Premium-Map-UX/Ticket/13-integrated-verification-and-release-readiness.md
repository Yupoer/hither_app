# 13 — 整合驗證與發布前報告

**What to build:** 將能耗、同步、Premium、路線與地圖 UI 的軟體證據和真實平台 gate 整理成一份可審查的發布前結果，清楚區分 Passed、Failed 與 Unverified。

**Blocked by:** 04 — 依實機證據處理剩餘前景熱源；08 — 同步續訂、到期、退款、撤銷與恢復購買；09 — 恢復道路完整幾何與縮放細節融合；10 — 固定 Apple Maps Logo 並完整露出羅盤；11 — 讓集合點 Marker 真正樂觀更新；12 — 修正邀請按鈕 Padding 與文字中心。

**Status:** ready-for-agent

- [ ] 執行本任務 focused tests、相鄰 regression suites、TypeScript typecheck 與 diff check，保存完整命令與結果。
- [ ] 比較相同情境下的 API request count、deadline polling、CPU、memory、FPS、thermal 與可用 Instruments 指標。
- [ ] 使用合法 Apple sandbox transaction 驗證月／年商品、七天 trial eligibility、purchase、finish、restore 與 lifecycle notifications。
- [ ] 偽造 transaction、錯誤帳號／商品／環境、重播、退款與撤銷測試均保持 fail closed。
- [ ] 驗證個人 Premium 與零／一／多名 Premium 團隊成員的加入、離隊與失效矩陣。
- [ ] iOS release-like 裝置驗證圓環路線、zoom LOD、Logo、羅盤、optimistic marker 與邀請按鈕。
- [ ] Jest、typecheck 或模擬器結果不被描述為 StoreKit、MapKit、thermal、GPU 或 App Store Connect 已通過。
- [ ] App Store Connect 商品、subscription group、introductory offer、agreements、tax／banking、server API key 與 notifications URL 各自列為 Pass／Fail／Unverified。
- [ ] 報告明確區分 native build、server deploy、migration、OTA、TestFlight 與 App Store submit；本 ticket 不自行發布。
