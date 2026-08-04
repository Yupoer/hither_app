# 08 — 收斂文件、設定、support-site 與所有無主 WIP

**What to build:** 逐項完成非核心程式 WIP 的整合、排除或移轉，讓文件狀態、專案設定、Mobile delivery 與獨立支援網站的交付邊界可追溯，且沒有任何無主項目。

**Blocked by:** 03 — 整合啟動能耗觀測與原生 profiling seam；04 — 整合單一群組 Recovery Snapshot；05 — 整合 Server-owned Coordination Deadline；06 — 整合 Premium、StoreKit 與 Supabase 安全交付鏈；07 — 整合 Map 路線、Marker 與邀請 UX WIP。

**Status:** ready-for-agent

- [ ] 專案與安裝文件只保留與最終整合事實一致的變更，不把暫時工作筆記當正式設定。
- [ ] Spec、Ticket、implementation summary 與 Code Review 狀態依實際證據更新，保留歷史文件且不覆寫不同輪次結論。
- [ ] `support-site` 明確判定 owner；若不屬於 Mobile，以獨立 commit／repo／部署紀錄處理，不混入 Mobile commit。
- [ ] `.env`、secrets、依賴目錄、native generated directories、Expo cache 與 build artifacts 均未 staged 或提交。
- [ ] 每個原始 tracked／untracked item 都能回指整合 commit、明確排除紀錄或移轉落點；沒有只靠刪除消失的項目。
- [ ] 清冊重新掃描後無 unknown／unassigned entries；仍需 user 或 external owner 決策者標為 Blocked 並阻止最終清潔宣告。
- [ ] 此 ticket 不執行 production deploy、OTA、build、submit 或未授權外部發布。
