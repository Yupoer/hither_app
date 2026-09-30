# 程式碼效能與隊伍流程修正（2026-09-30）

所有同步排程、輪詢間隔、定位頻率及重試時序保持原值。本次沒有新增 App dependency、修改原生模組、app config 或 runtime。

| 範圍 | 實作 |
| --- | --- |
| 建立／加入入口 | RoleSelect 固定只顯示語言選單，消除離場動畫期間多出的返回鍵；Auth 改用既有 SwiftUI NativeGlassButton。 |
| 查看隊伍 | 按鈕固定顯示，零隊伍不顯示數字；空狀態中央並排原生「創建」「加入」按鈕，直接進入對應 Auth 頁。 |
| 隊伍狀態 | 共用服務通知所有已掛載的同帳號畫面，離開／清空立即更新數字；mutation revision 防止較早的請求覆蓋刪除後狀態。 |
| 資料讀取 | 獨立讀取併行、縮減會員與個人資料欄位、頭像只解析一次；不增加同步排程。 |
| 地圖與同步運算 | 歷史名稱、待確認抵達、行程比對、定位 patch 及 outbox receipt 改用 Map／Set，減少迴圈內的線性搜尋。 |
| 背景導航 | 無會員、solo 或停止分享時，省略無用的導航 session 查詢。 |
| 動畫 | 三點共用同一個 900ms clock，各相差三分之一週期；隱藏／背景頁停止 shader frame callback，避免其他頁時鐘繼續重繪隱藏 shader。 |
| 隊伍卡片 | 只在展開時建立完整成員頭像陣列。 |
| 資料庫 | 成員刪除／轉移共用 trigger 清除舊群組中的即時位置；五個 group／destination 外鍵索引支援查詢及 cascade。 |

## 資料庫部署與驗證

- 正式專案：`htqrucnjafhhvxdqslbv`。
- Migration：`20260930102815_team_cleanup_and_query_indexes.sql`，已套用並登記；正式唯讀查詢確認 trigger 啟用、五個索引存在、authenticated 無法直接呼叫 trigger function。
- 正式環境已有 12 個遠端 migration 版本不在本地。未重播或修復這些歷史版本，只部署並 reconcile 本次 migration。
- 以 PGlite 隔離 PostgreSQL 重用真實初始 FK／RLS 和既有群組刪除函式，通過：一次離開多群、最後成員群組及行程 cascade、仍有他人的群組／會員／位置保留、離開者位置移除、不能刪除他人 membership、測試 fixture rollback。
- 可重跑：`node supabase/tests/run-team-cleanup-local.mjs <PGlite dist/index.js 路徑>`。測試套件安裝在暫存目錄，不是 App dependency。此測試不覆蓋外部推播服務或原生裝置畫面。
- 正式唯讀盤點仍有 86 個歷史空群組（2026-06-17 至 2026-07-14），以及既有孤立位置紀錄。這次不批次刪除歷史資料；新 trigger 處理往後的會員刪除。
- 自動審核拒絕正式資料庫的合成 fixture 測試與 RLS policy 刪除；改用隔離測試，保留原有 RLS policies，部署成功。

## 驗證與限制

- Jest：295 suites、2,341 tests 全通過。
- 受影響的非 UI 邏輯 function coverage 89.43%，高於既有 85% gate；line coverage 94.93%。
- TypeScript、test meta gate、runtime alignment 通過。
- ESLint：0 errors、669 warnings；既有專案警告仍需獨立整理。
- 本次為程式碼及資料庫驗證，沒有 iOS 實機 UI 驗收或裝置 CPU／耗電量測，不宣稱量測過的效能百分比。
- Supabase performance advisors 的未索引外鍵由 47 減為 42；其他索引依實際查詢量再評估，避免盲目增加寫入成本。既有多重 policies 保持不變。參考：[外鍵索引](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)、[多重 permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)。
- 既有 security advisors 包含匿名可執行的 security-definer function 與未啟用 leaked-password protection；本次未改登入權限。參考：[function 權限](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[密碼保護](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。
