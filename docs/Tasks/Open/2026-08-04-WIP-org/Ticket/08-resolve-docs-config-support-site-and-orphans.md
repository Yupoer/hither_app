# 08 — 收斂文件、設定、support-site 與所有無主 WIP

**What to build:** 逐項完成非核心程式 WIP 的整合、排除或移轉，讓文件狀態、專案設定、Mobile delivery 與獨立支援網站的交付邊界可追溯，且沒有任何無主項目。

**Blocked by:** 03–07

**Status:** done

- [x] 專案與安裝文件只保留與最終整合事實一致的變更，不把暫時工作筆記當正式設定。
- [x] Spec、Ticket、implementation summary 與 Code Review 狀態依實際證據更新，保留歷史文件且不覆寫不同輪次結論。
- [x] `support-site` 明確判定 owner；若不屬於 Mobile，以獨立 commit／repo／部署紀錄處理，不混入 Mobile commit。
- [x] `.env`、secrets、依賴目錄、native generated directories、Expo cache 與 build artifacts 均未 staged 或提交。
- [x] 每個原始 tracked／untracked item 都能回指整合 commit、明確排除紀錄或移轉落點；沒有只靠刪除消失的項目。
- [x] 清冊重新掃描後無 unknown／unassigned entries；lost task file 有 disposition。
- [x] 此 ticket 不執行 production deploy、OTA、build、submit 或未授權外部發布。

**Evidence:** `wip-manifest.md`；support-site at `support-site-separate-20260804`。
