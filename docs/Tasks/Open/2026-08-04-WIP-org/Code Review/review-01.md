# WIP-org Integration Verification Report — Code Review 01

**日期：** 2026-08-05

**結果：** Changes requested

**固定點：** `origin/master@da459bf222e6feaf011760deec48eaf8ed0d0931...HEAD@298465f5c993a71e261794426ddf39219028d0de`

**Spec 來源：** `Spec/wip-integration-spec-2026-08-04.md`、`Ticket/01`–`11`

**被審文件：** `Report/integration-verification-report.md`

## Standards

### [P1] Recovery Snapshot 讓過期匿名帳號繞過既有存取期限

**位置：** `supabase/migrations/20260804010000_group_recovery_snapshot.sql:28-34`

`get_group_recovery_snapshot` 是 `SECURITY DEFINER`，會繞過資料表 RLS；它目前只確認 `memberships` row 存在。專案既有的 `extensions.is_member` 另會呼叫 `anonymous_access_is_active`，拒絕已超過匿名使用期限的帳號，但新 RPC 沒有使用這個 predicate。

若過期匿名帳號的 membership 尚未由清理工作移除，該帳號仍能透過 snapshot 讀取整個群組、profiles、itinerary 與 member locations。Report 在第 137–141 行只把 server runtime 標成 Unverified，沒有揭露這個可由 source 確認的授權缺陷。

### [P2] 新增的兩個 SQL test 並沒有測試 SQL 行為

**位置：** `supabase/tests/group_recovery_snapshot.test.sql:1-9`、`supabase/tests/coordination_deadline_scheduler.test.sql:1-10`、`apps/mobile/src/__tests__/groupRecoverySnapshot.test.ts:12-27`

兩個 `.test.sql` 只保留註解並執行 `select '... contract documented'`；Jest 也只讀 migration source，確認某些字串存在。它們沒有切換 `anon`／`authenticated`／`service_role`、沒有過期匿名案例、沒有實際呼叫 RPC，也沒有驗證 concurrent claim、retry、partial failure 或 idempotency。

Report 第 177 行把這些列為「對應 SQL 測試」，第 210 行只說 runtime 未執行；更精確的狀態應是「有效 runtime tests 尚未實作」，因為即使現在執行這兩個 SQL 檔也不會驗證 Ticket 04／05 的 acceptance criteria。

### [P2] `git diff --check` 的 Passed 狀態無法由交付 commit 重現

**位置：** `docs/Tasks/Open/2026-08-04-WIP-org/Report/integration-verification-report.md:88-90,207`

Report 宣稱 task-scoped `git diff --check` 已通過；但對實際整合 commit 執行 `git diff c262bf6^ c262bf6 --check` 會回報 `PremiumPurchaseRecovery.tsx`、`premiumCatalog.ts`、多個 Spec／Ticket／Review 文件的 EOF 或 trailing-whitespace errors。Report 自身的 commit 也增加多處 trailing whitespace。

因此這個 gate 不能標成 Passed；至少要記錄當時實際使用的 pathspec，並對最終 commit 範圍重新執行。

### [P3] 兩個 public `SECURITY DEFINER` trigger function 沒有明確撤銷 EXECUTE

**位置：** `supabase/migrations/20260804000000_personal_premium_projection.sql:165-188,190-219`

`trg_recompute_premium_for_membership` 與 `trg_recompute_premium_for_entitlement` 使用安全的空 `search_path`，但不像同 migration 內其他 privileged functions，沒有對 `PUBLIC`、`anon`、`authenticated` 明確 `REVOKE EXECUTE`。Postgres function 預設可由 PUBLIC 執行；trigger function 雖不能像一般 RPC 正常呼叫，仍應依專案既有 hardening 慣例撤銷不必要權限。

## Spec

### [P1] 沒有逐項 WIP Manifest，且原始任務文件已遺失

**需求：** `Ticket/01-freeze-latest-master-and-wip-inventory.md:9-14`、`Ticket/08-resolve-docs-config-support-site-and-orphans.md:10-14`、`Ticket/09-run-integrated-verification-and-gate-matrix.md:17`

Ticket 要求原始 35 個 tracked、21 個 untracked entries 每一項都有 owner、目標 ticket、disposition、驗證與落點 commit；數量摘要不得取代逐項清冊。目前任務資料夾沒有 manifest／inventory／disposition ledger，Report 只有功能類別與少數排除項目，無法證明所有 WIP 都有落點。

更直接的反例是 Report 第 257 行引用的原始 `2026-08-04-WIP-org.md`：該檔目前不在 HEAD、不在任何 Git history，也不在 `wip-org-backup-20260804`。它原本是 untracked 任務來源，現在沒有整合、移轉或排除紀錄。Report 第 268 行因此不能宣稱所有 WIP 已完成收斂。

### [P2] App 進背景後沒有取消 steady Energy timer

**需求：** `Ticket/03-integrate-energy-observability.md:10,13`

`apps/mobile/src/state/energyObservability.ts:241-246` 建立 steady `setInterval`；`setAppState` 的背景路徑在第 264–266 行只取消 startup timers，沒有清除 steady interval。`energyObservability.test.ts:47-61` 甚至固定了背景後原 steady timer 繼續產生 sample 的行為。

這與 Report 第 132 行「背景／unmount 取消」不符。Unmount 的 controller stop 有處理，但 background acceptance criterion 尚未完成。

### [P2] Coordination Request 仍保留固定 60 秒 read cadence

**需求：** `Ticket/05-integrate-server-owned-deadlines.md:12`

`apps/mobile/src/screens/MapScreen/hooks/useCoordinationRequests.ts:199-207` 在存在 open request 時建立固定 interval，每 60 秒呼叫 `load('silent')`。`coordinationDeadlineScheduler.test.ts:29-34` 也要求這個 polling 存在。

Report 第 146 行只聲明移除週期性 resolver write，沒有說明固定 read 仍保留；但 Ticket 要求移除固定 resolver write／read cadence，透過 Realtime 與既有 group recovery snapshot 恢復。因此這個切片是 Partial，不是完整 Implemented locally。

### [P2] 交付沒有依 Ticket 10 建立 task-scoped commit 序列

**需求：** `Ticket/10-create-scoped-commits-and-merge-master.md:9-14`

`c262bf6` 單一 commit 同時包含 Energy、snapshot、deadline、Premium Client、Supabase migration／Edge、legacy disable、Map UX、專案設定與任務文件，共 78 files。這不符合每個 commit 對應一個切片，也無法由 commit 歷史表達 server-before-client 與 legacy-disable-last。

Report 第 94–100 行忠實記錄了這個綜合 commit，但沒有指出它違反已核准的交付條件。後續不能只直接 push；應先決定是否重整成本地 feature branch／可審查 commit 序列。

### [P3] Spec／Ticket 狀態沒有依實際證據更新

**需求：** `Ticket/08-resolve-docs-config-support-site-and-orphans.md:10`

11 張 WIP-org tickets 目前仍全部是 `ready-for-agent`，所有 acceptance checkboxes 也未更新。Report 一方面宣稱本地整合完成，一方面沒有把已完成、Partial、Unverified、Blocked 對回 tickets，審閱者無法從任務文件判斷哪些 gate 真正結束。

## Verification

### 已重新執行

- Full Jest：155 suites／1303 tests Passed。
- TypeScript typecheck：Passed。
- `git diff c262bf6^ c262bf6 --check`：Failed，與 Report 的 Passed 狀態不一致。
- `git diff origin/master...HEAD --check`：Failed；另包含 Report commit 自己新增的 trailing whitespace。
- Git：目前 `master@298465f`，相對 `origin/master@da459bf` ahead 5；Report 的 ahead 4 是報告 commit 建立前的「驗證截止」快照，本身可解釋，不列為 finding。
- Report commit 建立後的起始檢查為 clean；審查期間工作區另出現與本 review 無關的 `docs/Tasks/Open/reward-pod-fix` 刪除，加上本 review 新檔，因此目前工作樹不是 clean。本輪未復原或修改該無關刪除。
- 備份與分離資產：`wip-org-backup-20260804`、`support-site-separate-20260804` 均存在。
- Deno 與 Supabase CLI：目前環境不可用，未執行 Edge／SQL runtime tests。

### 仍未完成或未驗證

- 修正 recovery snapshot 的過期匿名授權並建立真實 authorization test。
- 建立 scheduler 的 concurrent claim、retry、partial failure、idempotency 與 privilege runtime tests。
- 取消 background steady Energy timer，或明確修改 Spec 並取得核准。
- 移除 coordination request 固定 read cadence，或明確修改 Spec 並取得核准。
- 補齊逐項 WIP manifest，對原始任務檔提供恢復或有記錄的 disposition。
- 重整或正式接受非 task-scoped commit 歷史；目前不符合 Ticket 10。
- 更新 Spec／Ticket／Report 狀態與 `git diff --check` 結果。
- Deno Edge tests、pgTAP／migration apply、StoreKit sandbox／Apple certificate chain、App Store Server Notifications replay、MapKit native visual、Instruments／MetricKit A/B、EAS／OTA／TestFlight、remote master push／SHA 對齊仍是 Unverified 或 Blocked。

## Summary

- **Standards：** 4 findings；最嚴重為 P1 recovery snapshot 授權繞過。
- **Spec：** 5 findings；最嚴重為 P1 缺少 WIP manifest 且原始任務來源遺失。

Report 對外部 native／server／release gates 的 Unverified／Blocked 分類大致正確，但「本地 WIP 已完成整合」的結論不成立；需修正上述 source 與文件缺口後再做最終驗收。
