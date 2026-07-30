# 01 — 蒐集 iOS Rewarded Ads 閃退與版本證據

**What to build:** 建立一份可重現、可比對且去識別化的 iOS Rewarded Ads 診斷證據，讓後續修復以實際原生例外與安裝檔狀態為依據，同時記錄 Android 是否能重現或仍待驗證。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 在最接近使用者回報環境的 iOS release-like 安裝檔重現「商店 → 觀看廣告」，記錄是否在點擊、同意、載入或顯示階段終止。
- [ ] 保存去識別化的原生例外、堆疊、發生時間與廣告生命週期最後事件；不得保存 access token、完整 callback query、原始 reward session 或個人資料。
- [ ] 記錄可比對的 App 版本、更新版本、執行平台、原生安裝檔來源、Expo SDK、Google Mobile Ads 套件與原生依賴版本。
- [ ] 比對已提交原生設定、Expo 設定及實際安裝檔中的 Google Mobile Ads App ID 與原生模組存在狀態。
- [ ] 區分「已觀察事實」、「高風險不一致」與「待驗證假設」，不得在證據不足時宣稱單一根因。
- [ ] 若 Android 環境可用，執行同一入口的 smoke reproduction；若不可用，明確記錄為未驗證而非通過。
- [ ] 產出足以讓 Ticket 02 與 Ticket 03 採取明確修復的根因結論，或列出仍需保留的最小分支。
