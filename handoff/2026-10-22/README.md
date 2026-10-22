# Hither：Claude 跨裝置交接（2026-10-22）

這是額度中斷時的工作快照，**不是已驗收的 release**。原任務是對 `Yupoer/hither_app` 做 code review，之後使用者授權全部修正、按區塊並行，交由 Codex CLI review，再加入禁止並替換 useEffect 的要求。主 Claude session 為 `1e3ea500-3e0f-4d0f-a49f-278225bcc051`，Herdr job 為 `0e588e88`；主會話與 B3～B6 agents 在 2026-10-22 16:34～16:35（台北）碰到額度上限。

本備份保留 B0～B6 的本地提交歷史、各自完整程式碼狀態、未提交內容、五個未追蹤 hooks、review 報告、agent 任務指示、B7 規劃、codemod 與本地 SQL helper。原電腦的工作目錄沒有被修改、stash、reset 或清理；master、既有 PR 分支也沒有被覆寫。

## 在另一台電腦接續

需要 Git、Python 3.9+，以及該電腦自己的 Claude Code 登入。先 clone 此交接分支，再執行還原（Windows 可用 `py -3` 代替 `python3`）：

```bash
git clone --branch handoff/claude-20261022 --single-branch https://github.com/Yupoer/hither_app.git hither-handoff
cd hither-handoff
python3 handoff/2026-10-22/restore.py --destination ../hither-resumed
```

`restore.py` 會核對 ZIP 與 bundle SHA-256、clone upstream master、匯入 bundle 的原始分支及 recovery 分支、建立七個獨立 worktree、驗證 tree SHA 和 WIP 檔案。目的目錄若已存在就停止，不覆寫既有工作。`progress.bundle` 是增量 Git bundle，依賴基底 `29da03064ffdd6c0431ae63beafe6b15bda2d9a5`；因此不能直接拿這個 bundle 當完整 repository clone，腳本會先取得 upstream 歷史。

還原後：

- `hither-resumed/repo/`：主 repo，含原始 `claude/b*` 分支與 `recovery/20261022/b*` 快照分支。
- `hither-resumed/wt-b0-expo-align` 至 `wt-b6-mapscreen`：七個可獨立接續的 worktree，checkout 在 recovery 分支。
- `hither-resumed/handoff/context/`：任務摘要素材、完整 review、指示及本地 helper。
- `hither-resumed/handoff/manifest.json`：原始 HEAD、checkpoint HEAD、tree、原始檔案雜湊及 WIP 明細。
- `hither-resumed/restore-verification.json`：該次還原的實際驗證結果。

原本未提交的修改被存成額外的 `checkpoint:` commit，方便跨機還原，不表示已測試通過。請在 recovery 分支上接續；之後要更新既有 PR 時，先確認其遠端 head，再明確選擇將已審查的修改送回對應 `claude/b*` 分支。不要盲目 force-push。

讓新 Claude 讀這份 README 和 `hither-resumed/handoff/context`，即可用新對話接續。這不是 Claude 原 session 的 `--resume` 備份；不需搬移原電腦的登入權杖或私人 session 資料。

## 區塊狀態與下一步

| 區塊 | 原始分支／HEAD | 已有 PR | 中斷狀態與下一步 |
| --- | --- | --- | --- |
| B0 Expo patch 對齊 | `claude/b0-expo-align` / `adad3ff96e82` | [#312](https://github.com/Yupoer/hither_app/pull/312)，base master | 最後 Codex review 是 **CHANGES REQUESTED**。修正發布說明：只推出新 binary、但維持相同 runtime，不能隔離舊裝置。新 build 必須同步不同 runtime，或持續阻擋 OTA 直到另有驗證過的隔離方案。檢查即時 CI。 |
| B1 repo／CI 整理 | `claude/b1-hygiene-v2` / `d61afc99755c` | [#314](https://github.com/Yupoer/hither_app/pull/314)，base B0；取代 #310 | review round 4 APPROVE。快照另保留 `package-lock.json` 的 CRLF 工作目錄 bytes；獨立檢查確認 index 為 LF、worktree 為 CRLF，這不是功能修改。不要把整份行尾差異當成新的 PR 改動。 |
| B2 效能 | `claude/b2-perf` / `a4b4c28a8a2d` | [#313](https://github.com/Yupoer/hither_app/pull/313)，base B0 | review round 3 APPROVE。保留前景 location 即時上傳，先前 batching 嘗試已撤回。尚無真機／真實 realtime 驗證。 |
| B3 後端正確性 | `claude/b3-backend-correctness` / `c7344c8cb363` | 中斷時未開 | round 2 **CHANGES REQUESTED**：被另一個 pass 阻擋的 REFUND_REVERSED 會被永久接受卻無恢復路徑；group／entitlement lock 順序與 promo redemption 可 deadlock。round 3 agent 額度中斷，未留下工作目錄改動。先讀最新 report 與 agent brief，重現後修。 |
| B4 測試 gates | `claude/b4-sql-test-gate` / `f7907ebf1f38` | 中斷時未開 | round 2 **CHANGES REQUESTED**：非 value references 仍可逃過 source-only gate；手寫 lexer 對 JSX／statement-position regex 誤判。round 3 agent 額度中斷，未留下修改。既定修正方向是使用既有 TypeScript compiler API，補上 reviewer reproduction。 |
| B5 sync v3 source | `claude/b5-sync-v3-source` / `3232f8fa1d15` | 中斷時未開 | round 3 **CHANGES REQUESTED**：PostgreSQL nested block comments。兩個 script 檔案有未完成修正；最後 agent 回報 Python 字串跳脫造成壞引號，須先檢查 syntax，再修完並跑測試／mutation check。 |
| B6 MapScreen | `claude/b6-mapscreen` / `35719bd714e1` | 中斷時未開 | 已有 12 個拆分 commits，MapScreen 約 11,540 → 5,763 行。另有未完成 MapScreen 修改及五個新 hooks，全部已保存。先完成或修正這一段、跑 tsc/Jest，再繼續其餘拆分；不要直接宣告 green。 |
| B7 禁用 useEffect | 尚未建立分支 | 無 | 等 B2 與 B6 整合穩定後才做。完整 brief 在 `context/blocks/b7-no-useeffect.md`。不得把動態依賴一律改成 mount-only 而改變行為。 |

PR #312、#313、#314 在本次備份查詢時皆為 open draft；是否可 merge 仍須查最新 CI 和 review。本次沒有合併、部署、發送 OTA 或改 runtimeVersion。

## 接續順序與驗證邊界

1. 還原並讀 `context/blocks/findings.md`、`context/agent-briefs.json`、各區塊最後 review。`context/task-conversation.json` 保留本任務的對話文字、來源區分及使用者追加指示，未包含原始 API payload／推理內容／登入檔案。
2. B3、B4 可獨立修 reviewer findings；B5、B6 先處理中斷 WIP，再開新工作。reviewer 指示要先核對，不可把歷史報告當成現行 green。
3. B0 發布說明先修正；B1／B2 的 review 已完成但仍要看即時 CI。後續整合 B0 時保留 B3～B6 各區塊邊界、處理真實衝突。
4. B6 最後保存的 `context/scratch/b6-report.json`（16:29 左右）是 **4 suites / 8 tests failed；334 suites / 2819 tests passed**。這份報告早於最後 WIP，不能代表快照最新結果。失敗位於 mapUiContracts、gatheringWorkflowContract、routeEditorKmlContract、buttonInventoryContract；具體 assertions 在報告內。恢復後以目前程式重新驗證。
5. 基底歷史結果為 Jest 333 suites / 2787 tests、tsc clean；B0/B1/B2 的已報告測試見各 PR 草稿和 review。這些是原工作紀錄，本次備份沒有重跑產品測試，也沒有真機驗收。
6. B3 SQL 有原機 PGlite helper，並記錄六個 master 已有失敗：coordination_deadline_scheduler、coordination_requests、daily_accommodations_expiry_leader、group_recovery_snapshot、location_refresh_pending、security_group_command_import_arrival。PGlite 結果不能取代真正 Supabase／pgTAP CI。helper 在 `context/scratch/b4-scratch`，原絕對路徑需調整。
7. 各 worktree 的 `apps/mobile` 自己安裝依賴（以其 lockfile `npm ci`）。原機共享 node_modules junction 的限制只適用原機；備份沒有 junction、node_modules、coverage cache。新機不要重建跨版本共享依賴。依 repo `SETUP_NEW_MACHINE.md` 補環境，憑證使用新機安全來源。

## 模型與工作方式的最後指示

這一輪原使用者最後要求：Sonnet 5.5 負責主會話及程式碼；Haiku 5.5 做並行探索；Opus 5.5 僅重大決策顧問；Codex CLI review 用 astra high，並啟用 fast，且只限這輪工作。這些是使用者的執行偏好，不是文字能保證的 runtime 設定。新機請檢查可用模型及實際工具設定；不可默默替換或假稱生效。主 Claude 曾說主對話模型需由使用者 `/model` 切換。

使用者另表示會重新 build 並提高 runtimeVersion；這是待辦意圖，**未完成發布**。不得僅改 app.json 後就視為完成：必須依 `verify-runtime-alignment.mjs` 同步 native Expo.plist、App／Widget 等版本，並完成 native 驗證。

`context/blocks/common-rules.md` 和 delegate scripts 是原 agents 的歷史 brief，包含原機路徑、舊模型及當時 no-push 邊界；先讀目前 repo AGENTS.md，並以本輪使用者較新的要求判斷，不要盲目執行歷史腳本。共用 pstack／workflow skills 沒有連同全域設定搬移；新機依現有安裝讀取，缺少時明示。

## 保存範圍

已保存：8 個工作樹的狀態清單（master + 7 個區塊）、7 個區塊的完整 Git 提交鏈、WIP、任務 review 與可重建素材。完整檔案及雜湊見 ZIP 中 manifest。

刻意未上傳：登入憑證、`.env`／私人金鑰、全域 Claude/Codex 設定、原始 session JSONL、API request blobs、node_modules、coverage 產物及無關 AI_knowledge_system 檔案。GitHub repository 是公開的。Herdr 的 live process／agent ID 不會在新機恢復；請啟動新的 Claude 會話，依本交接接續。

若要單獨取回某分支，可在已 clone 且有基底 commit 的 repo 執行 `git fetch <解壓路徑>/progress.bundle 'refs/heads/*:refs/heads/*'`，再 checkout `recovery/20261022/b5-sync-v3-source` 等。原 `claude/*` branch 指向中斷前最後正式 commit；`recovery/*` 含額外 WIP checkpoint。

