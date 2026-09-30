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
- 初次盤點有 86 個歷史空群組（2026-06-17 至 2026-07-14）；後續使用者明確授權全部刪除，清理結果見下方。
- 自動審核拒絕正式資料庫的合成 fixture 測試與 RLS policy 刪除；改用隔離測試，保留原有 RLS policies，部署成功。

## 驗證與限制

- Jest：295 suites、2,341 tests 全通過。
- 受影響的非 UI 邏輯 function coverage 89.43%，高於既有 85% gate；line coverage 94.93%。
- TypeScript、test meta gate、runtime alignment 通過。
- ESLint：0 errors、669 warnings；既有專案警告仍需獨立整理。
- 本次為程式碼及資料庫驗證，沒有 iOS 實機 UI 驗收或裝置 CPU／耗電量測，不宣稱量測過的效能百分比。
- Supabase performance advisors 的未索引外鍵由 47 減為 42；其他索引依實際查詢量再評估，避免盲目增加寫入成本。既有多重 policies 保持不變。參考：[外鍵索引](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)、[多重 permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)。
- 既有 security advisors 包含匿名可執行的 security-definer function 與未啟用 leaked-password protection；本次未改登入權限。參考：[function 權限](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[密碼保護](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

## 後續：完整刪除空群組

使用者明確指定：沒有成員的群組，其歷史完成景點與所有群組相關資料都可刪除。

- 已部署並登記 `20260930111355_purge_empty_groups_completely.sql`。短暫鎖定 memberships，避免清理檢查與加入／離開競爭；未變更任何同步頻率。
- 將 `token_ledger` 與 `promo_redemptions` 的 group FK 由 SET NULL 改為 CASCADE，正式資料庫所有指向 groups 的外鍵現皆為 CASCADE，沒有缺少 group FK 的實體 `group_id` 欄位。
- 正式清除 86 個零成員群組，連帶清除 337 筆 itinerary_items 與 86 筆 member_locations；這些空群組的 visited_waypoints、subgroups、token_ledger、promo_redemptions 在刪除前均為 0 筆。
- 清理後空群組為 0；有成員群組仍為 20、memberships 仍為 21、profiles 仍為 17、token_wallets 仍為 8、錢包 balance 合計仍為 0。既有最後成員離開 trigger 啟用中。
- 隔離 PostgreSQL 測試通過歷史空群組 purge、保留有成員群組及帳號、未來最後成員離開時連帶清除景點／位置／代幣紀錄／兌換紀錄。可重跑：`node supabase/tests/purge_empty_groups.test.mjs <PGlite dist/index.js 路徑>`。
- 既有遠端 migration 漂移未改動；只 reconcile 本次版本。後端改動不需新增 OTA。Security advisors 檢查完成，既有登入與 function 權限警告同上。
