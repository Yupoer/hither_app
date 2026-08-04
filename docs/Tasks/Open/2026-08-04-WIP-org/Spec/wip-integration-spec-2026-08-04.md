# 本地 WIP 整合與 master 交付 Spec

建立日期：2026-08-04
狀態：partial — local integration + review-01 fixes; external gates Unverified/Blocked
文件範圍：定義整合、驗證與交付；runtime/native/release gates 不得由 Jest 單獨宣告完成

## Problem Statement

Hither 目前同時存在落後於遠端主線的工作分支、兩個尚未進入 `origin/master` 的本地 commit，以及分散在 Mobile、Supabase、文件、專案設定與獨立支援網站中的 tracked／untracked WIP。這些內容混合了已完成修正、仍待驗證的功能、部署來源、報告與可能不屬於 Mobile delivery 的資產；若直接整批 merge、重設工作樹或只挑明顯檔案，很容易回退最新 master 的 Expo Dev Client、preview、依賴、runtimeVersion 0.1.5 或 App Store 設定，也可能遺失尚未提交的必要工作。

規劃時的本地快照為工作分支 `codex/ios-energy-premium-map-ux-20260804`、HEAD `9aa6660`、本地 remote-tracking `origin/master` 為 `da459bf`，兩側分歧為遠端側 13 個 commit、工作分支側 2 個 commit；另有 35 個 tracked entries 與 21 個 untracked entries。這些數字只代表規劃時快照，本輪未執行 fetch，不能把 `da459bf` 宣稱為執行時最新遠端狀態。

交付需要把每一項 WIP 分類為整合、明確排除並移除，或移至正確獨立專案；完成 Energy observability、群組 recovery snapshot、server-owned coordination deadline、Premium／StoreKit／Supabase、Map／UX 與同步相關能力；保留可追溯驗證證據；最後才建立乾淨 commit、merge 至 master、push 遠端 master 並核對 SHA。任何 Jest 或 typecheck 成功都不能取代 StoreKit、MapKit、Supabase runtime、Instruments、EAS、TestFlight 或 App Store gate。

## Solution

執行時先 fetch 並鎖定當下最新 `origin/master`，再建立不可遺漏的 WIP 清冊。清冊以 commit、tracked modification、untracked item 與獨立專案資產為單位，為每一項記錄 owner、目標切片、處置、驗證與最終 commit。不得以整批 merge 舊分支或清空工作樹代替逐項判斷。

以窄而完整的交付切片整合：先重播兩個本地 Premium／Map review-fix commits，再分別完成 Energy observability、單一 recovery snapshot、server-owned deadline、Premium／StoreKit／Supabase release-safe flow，以及 Map／UX 剩餘 WIP。各切片都必須在最新 master 上保持既有行為、帶有最高可行測試 seam，並能獨立回報 Implemented locally、Passed、Failed、Unverified 或 Blocked。

文件、專案設定與 `support-site` 另設處置切片。`support-site` 若不是 Mobile delivery 的一部分，必須留在獨立交付邊界，不得混入 Mobile commit；所有 secrets、環境檔、依賴目錄、原生產生目錄與建置產物均不得提交。完成所有切片後，執行整合驗證與外部 gate matrix，使用明確 staged paths 建立 task-scoped commits，merge 到 master、push 遠端 master、核對 remote SHA，最後證明工作樹沒有未處理 WIP。

## User Stories

1. As a Hither 維護者, I want to 以執行時最新 `origin/master` 為唯一基準, so that 舊 WIP 不會回退主線的新設定與修正
2. As a Hither 維護者, I want to 看見所有本地 commit、tracked modification 與 untracked item 的逐項清冊, so that 沒有工作被遺漏或誤刪
3. As a Hither 維護者, I want to 每個清冊項目都有整合、排除或移轉的明確處置, so that 最終工作樹不存在無主 WIP
4. As a Hither 維護者, I want to 兩個本地 review-fix commit 在最新 master 上逐一重播與驗證, so that 不需要整批 merge 舊分支
5. As a Hither 使用者, I want to 啟動後 0、15、30、60、120 秒有能耗觀測, so that 前兩分鐘的成本有可比較證據
6. As a Hither 維護者, I want to 穩定期採樣降頻並在背景或 unmount 取消, so that 觀測本身不成為固定耗能來源
7. As a Hither 維護者, I want to CPU、memory、FPS、thermal、location、route、Realtime、snapshot、render 與 network counters 有清楚邊界, so that owner 能被分開歸因
8. As a Hither 維護者, I want to 使用 MetricKit 與隱私安全的 signpost, so that 長期與短期原生證據可以對齊產品事件
9. As a Hither 使用者, I want to 60 秒 recovery 只讀取一個具版本的群組 snapshot, so that 保底同步不會產生多 endpoint storm
10. As a Hither 使用者, I want to 舊 snapshot 不覆蓋新的 Realtime 或 optimistic mutation, so that UI 不會回跳舊狀態
11. As a Hither 使用者, I want to coordination deadline 由伺服器可靠結算, so that 關閉 App 不會阻止協調結果
12. As a Hither 維護者, I want to deadline scheduler 使用 row locking、bounded batch 與冪等處理, so that 多 worker 與重試不會重複結算
13. As a Hither 使用者, I want to Client 不再週期性寫入 deadline resolver, so that 空閒前景不產生固定寫入與讀取
14. As a 訂閱者, I want to 月訂閱、年訂閱、本地化價格與試用資格由 StoreKit 正確呈現, so that 顯示條件與 Apple 帳號一致
15. As a 已付款使用者, I want to 伺服器 durable grant 後才 finish transaction, so that 暫時網路失敗不會造成付款成功但沒有 Premium
16. As a Hither 維護者, I want to Apple JWS、bundle、environment、product、transaction、account token、expiry 與 revocation 均 fail closed 驗證, so that 偽造資料無法授權
17. As a 訂閱者, I want to unfinished purchase、restore、renewal、expiration、refund 與 revocation 可重播且冪等, so that 權益最終與 Apple ledger 一致
18. As a 團隊成員, I want to 個人 Premium 與團隊 Premium projection 分離, so that 團隊能力隨現役有效成員正確開關
19. As a 地圖使用者, I want to 完整道路 geometry 保留在 native map boundary, so that 近距離路線不會截斷圓環或 U-turn
20. As a 地圖使用者, I want to route LOD 依 screen-space 容差隨縮放連續變化, so that 遠近視圖都保有合適細節
21. As a 地圖使用者, I want to Apple Maps Logo 固定且羅盤完整可見, so that sheet detent 不會造成地圖 chrome 跳動或遮擋
22. As a 集合點管理者, I want to Emoji 與 marker color 先樂觀更新並可精確 rollback, so that 操作即時且失敗狀態可信
23. As a 邀請成員的使用者, I want to Share／Copy 按鈕兼顧 icon inset、幾何置中、動態字級與 iPad layout, so that 不同尺寸下仍可讀可按
24. As a Hither 發布者, I want to migration、Edge Function、SQL tests、Deno tests 與 client contract 以正確部署順序交付, so that Client 不會先依賴尚未部署的 server contract
25. As a Hither 發布者, I want to legacy trip-pass disable 只在新 Premium flow 可運行後才進入發布序列, so that 舊路徑不會過早失效
26. As a Hither 維護者, I want to `support-site` 有獨立處置與交付紀錄, so that 網站資產不會暗中混入 Mobile commit
27. As a Hither 維護者, I want to 每個驗證結果標成 Passed、Failed、Implemented locally、Unverified 或 Blocked, so that 本機成功不會被誤報為平台成功
28. As a Hither 發布者, I want to 明確 stage 每一批檔案且不使用 `git add -A`, so that commit 範圍可審查
29. As a Hither 發布者, I want to merge 前確認 master 仍包含最新主線設定與既有功能, so that 整合不會造成回退
30. As a Hither 發布者, I want to push 遠端 master 並比對 local／remote SHA, so that 交付不是只存在私有分支
31. As a Hither 維護者, I want to 最終工作樹沒有未提交、未追蹤或未分類項目, so that 任務真正收斂
32. As a Hither 維護者, I want to 未授權或缺少 credentials 的 deploy、build 與 submit 保持 Blocked 或 Unverified, so that 報告不偽造外部結果

## Implementation Decisions

### 基準、清冊與歷史保護

- 執行者必須先 fetch，再以 fetch 後的 `origin/master` SHA 建立整合基準；規劃時的 `da459bf` 只作為快照證據。
- 開始任何重播、刪除、移轉或 merge 前，建立逐項 WIP manifest。數量摘要不能取代逐項清冊。
- 每個項目至少記錄來源、分類、產品 owner、目標 ticket、處置、驗證狀態與落點 commit；未知項目保持 Blocked，不自行猜測刪除。
- 兩個本地 commit 逐一重播並檢查衝突，不直接 merge 整個舊分支。
- 保留最新 master 的 Expo Dev Client、preview、package lock、Expo dependencies、runtimeVersion 0.1.5 與 App Store 設定；任何差異需有明確理由與驗證。

### 功能切片

- Energy observability 的應用程式內 seam 是有限 burst sampler、穩定期低頻 sampler、背景／unmount cancellation 與 privacy-safe counters；GPU、radio 與 MapKit compositor 交由 Instruments／MetricKit，不製造假數據。
- Group recovery 使用單一 server snapshot boundary，帶 revision／generation fence；pending optimistic mutation 與較新 Realtime state 優先於舊 snapshot。
- Coordination deadline 由 service-role scheduler 擁有；使用 row locking、bounded batch、冪等結算與錯誤觀測。Client 只接收結果與保底恢復，不再固定寫入 resolver。
- Premium entitlement authority 在伺服器。交易驗證、durable grant、finish transaction、notification ledger 與 reconciliation 必須遵守 fail-closed、idempotent 與 order-safe 邊界。
- 個人 Premium ownership 與團隊 Premium projection 分開；membership 或 entitlement 變動會重算團隊能力，legacy Pro／trip pass 不得偷偷成為新訂閱來源。
- 路線原始 geometry 不可被 display LOD 破壞。screen-space LOD 只派生顯示 projection，保護 U-turn、roundabout 與 maneuver anchors。
- Marker optimistic overlay 必須由 mutation identity 控制 commit／rollback，避免較舊 request 回應覆蓋較新選擇。

### Supabase 與發布排序

- 所有 migration、Edge Function、SQL／Deno tests 與 Client contract 必須成套整理並進 Git。
- 部署順序先 server contract，再 Client；legacy trip-pass disable 最後，且只在新 Premium flow 可運行後進入發布序列。
- production migration、Edge deploy、native build、OTA、TestFlight 或 App Store submit 均需要明確授權；缺少授權或 credentials 時記為 Blocked，不以模擬結果替代。
- Native dependency 或原生設定變更需要新 binary；OTA 不得被當成替代方案。

### Git 與獨立資產

- `support-site` 先判定 delivery owner。若不屬於 Mobile，保持獨立 commit／repo／部署紀錄，不混入 Mobile commit。
- `.env`、secrets、dependency directories、native generated directories、Expo cache 與 build artifacts 不得提交。
- 只用明確 pathspec stage；每個 commit 對應一個可審查切片，不使用 `git add -A`。
- merge 與 push 是驗證後的獨立 gate。不得在驗證尚有不明 Failed 時推進，也不得把私有分支 push 當成遠端 master 完成。

## Testing Decisions

- **WIP manifest seam：** 比對執行前後的 local-only commits、tracked／untracked 列表與最終 disposition ledger；任何項目沒有落點即失敗。
- **基準保護 seam：** 在重播每個 commit 與最終 merge 後，檢查 master-only 設定與相鄰 regression，不只檢查是否無 conflict。
- **Energy seam：** 用可控制時間與 App lifecycle 的測試驗證 0／15／30／60／120 秒、降頻、背景與 unmount cancellation、counter delta 與隱私排除；原生 owner 另走 Instruments／MetricKit。
- **Snapshot seam：** 以可控制 Promise／revision 順序的狀態層 harness 驗證單一 RPC、group generation、Realtime race 與 optimistic mutation 不回退；server contract 以 SQL runtime 測試。
- **Deadline seam：** 以資料庫 runtime 驗證 concurrent workers、row locks、bounded batch、retry、idempotency 與 failure visibility；Client contract 驗證不再週期性寫入。
- **Premium seam：** 使用 Apple sandbox fixtures 與合法／非法 JWS cases 驗證 fail-closed、durable grant before finish、duplicate／out-of-order notification、restore 與 projection matrix；正式扣款與 App Store Connect 狀態另列外部 gate。
- **Map／UX seam：** 純函式測試 route LOD 與 maneuver anchors；state harness 測 marker commit／rollback；layout／snapshot 測 Logo、compass、按鈕幾何、動態字級與 iPad；release-like 裝置驗證 MapKit 畫面與 callback。
- **整合 gate：** 執行 focused Jest、完整 Jest、typecheck、diff check、Deno、pgTAP／Supabase runtime，並把既有 lint baseline 與本次新增問題分開。
- **狀態語彙：** `Passed` 只用於已執行且結果成功；`Failed` 用於已執行失敗；`Implemented locally` 用於已有來源但 runtime 未證明；`Unverified` 用於尚未執行；`Blocked` 用於缺少授權、credentials、裝置或外部狀態。
- **真實平台 gate：** StoreKit、MapKit、MetricKit、Instruments、thermal、Supabase deploy、EAS、TestFlight 與 App Store Connect 不得由 Jest／typecheck 代替。
- **交付 gate：** commit 前檢查 staged diff；merge 後在 master 重跑必要驗證；push 後比對 local master、remote-tracking master 與遠端查詢 SHA，最後確認工作樹乾淨。

## Out of Scope

- 本文件產出階段不修改產品程式、不刪除 WIP、不建立 commit、不 merge、不 push，也不執行任何部署或發布。
- 未經明確授權，不執行 production migration、Edge deploy、EAS build、OTA、TestFlight 或 App Store submit。
- 不把既有 iOS Energy／Premium／Map UX Spec 改寫成歷史相反結論；本 Spec 只定義其 WIP 如何整合與交付。
- 不因目前工作樹看似有對應來源，就宣稱功能完整、發熱原因已定位或外部 gate 已通過。
- 不重寫無關產品功能，也不藉 WIP 整理大範圍更新依賴、runtimeVersion 或 App Store 設定。
- 不自行決定未知資產應刪除；owner 或用途無法確認時保持 Blocked 並要求明確決策。

## Further Notes

- 規劃快照中的 SHA、分歧數與工作樹數量可能在執行前變動；Ticket 01 必須重建執行時清冊與基準。
- 兩個 local commits 只代表已提交，不代表已適用最新 master，也不代表其 Deno、SQL、native 或 release gate 已通過。
- 現有 implementation summary 與 Code Review 是證據來源，不是自動接受證明；整合者仍需核對實際 diff、測試與 unresolved gates。
- 最終報告至少需列出：整合內容、排除／移轉內容、各 gate 狀態、task-scoped commit SHA、merge commit SHA、remote master SHA、clean-tree 證據與仍存在的外部限制。
