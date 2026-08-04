# 01 — 鎖定最新 master 並建立完整 WIP 清冊

**What to build:** 在不改動或遺失任何內容的前提下，取得執行時最新 `origin/master`，並把 local-only commits、tracked modifications、untracked items 與獨立專案資產逐一登錄，讓後續每個項目都有可追蹤處置。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] fetch 後記錄唯一基準 SHA，並把規劃時 `origin/master@da459bf` 明確保留為舊快照而非當下遠端事實。
- [x] 記錄工作分支、HEAD、兩側 commit 分歧與兩個 local commits 的完整 SHA、目的及 touched domains。
- [x] 每個 tracked／untracked item 都有來源、owner、目標 ticket、整合／排除／移轉處置、驗證狀態與預定 commit；數量摘要不得取代逐項記錄。
- [x] `support-site`、專案設定、文件、Mobile 與 Supabase 分別分類；未知 owner 不得自行刪除，標為 Blocked。
- [x] 識別 `.env`、secrets、依賴目錄、原生產生目錄、Expo cache 與 build artifacts，標示為禁止提交。
- [x] 建立基準保護清單，涵蓋 Expo Dev Client、preview、package lock、Expo dependencies、runtimeVersion 0.1.5、App Store 設定與最新 master 功能。
- [x] 本 ticket 結束時原始 WIP 仍可恢復，沒有 merge、reset、deploy、build 或發布動作。

**Evidence:** `wip-manifest.md`；backup `wip-org-backup-20260804`；lost `2026-08-04-WIP-org.md` 已 disposition。
