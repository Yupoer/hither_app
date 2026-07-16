# SETUP_NEW_MACHINE — 重 clone / 換機後的重建步驟

`.claude/`、`.env`、`.git/hooks` 都不進版控，fresh clone 後要手動重建。照順序做：

## 1. 安裝依賴

```bash
cd apps/mobile
npm install
```

## 2. 重建 `apps/mobile/.env`

從 `.env.example` 複製，填入 Supabase 憑證（project ref：`htqrucnjafhhvxdqslbv`）：

```bash
supabase projects api-keys --project-ref htqrucnjafhhvxdqslbv
```

或到 Supabase Dashboard → Settings → API Keys 複製 publishable key。

```
EXPO_PUBLIC_SUPABASE_URL=https://htqrucnjafhhvxdqslbv.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
```

## 3. 重建 git hooks

```bash
cd hither_app
bash scripts/install-git-hooks.sh
```

會安裝：

| Hook | 行為 |
|------|------|
| **pre-push** | `apps/mobile` 跑 jest + tsc，失敗擋 push |
| **post-commit** | 若 **HEAD 僅含 OTA 可推送變更**（`apps/mobile/src/**`、assets 等；**不含** ios/android/modules/targets、package.json、app.json…），則：feature branch → merge 進 `master` 並 push；已在 `master` → 直接 push；接著 `eas update` 到 `production` + `preview` |

腳本本體：`scripts/ota-auto-ship.sh`（可手動 `bash scripts/ota-auto-ship.sh` 或 `--force`）。

暫時關閉自動 OTA：

```bash
OTA_AUTO_SHIP=0 git commit ...
```

**注意：** post-commit 會真的 push + 發 OTA；純文件／supabase／native 變更會自動 skip。

## 3b. Grok 任務結束 hook（Stop → commit / merge / push / OTA）

掛在**系統全域** `~/.grok/hooks/`（Windows：`%USERPROFILE%\.grok\hooks\`），Grok CLI 的 `/hooks-add` 只接受這個目錄。

| 步驟 | 行為 |
|------|------|
| 1 | 有安全可提交變更 → auto-commit（略過 `.env` / `*.p8` / `node_modules` / `dist`） |
| 2 | 僅 OTA 安全變更（`apps/mobile/src/**` 等）才繼續；含 native 則 skip OTA |
| 3 | patch-bump `apps/mobile/app.json` 的 `expo.version`（**不改** `runtimeVersion`，既有 binary 仍能收 OTA） |
| 4 | feature branch / worktree → **worktree-safe** merge 進 `master` 並 push；已在 `master` → 直接 push |
| 5 | `eas update` → `production` + `preview`（timeout 900s） |

檔案（全域，Always trusted）：

- `~/.grok/hooks/task-end-ship.json`
- `~/.grok/hooks/run-hook.cmd` + `task-end-ship`（進入點）
- 本體仍在 repo：`hither_app/scripts/task-end-ship.sh`（hook 會依 workspace 自動找到）

換機時把上述三個檔複製到新機器的 `~/.grok/hooks/`，或在 Grok 執行：

```text
/hooks-add %USERPROFILE%\.grok\hooks
```

然後 `/hooks` 確認 Stop → task-end-ship 已載入；改完檔可按 `r` reload。全域 hook 不需 `/hooks-trust`。

手動試跑（不寫入）：

```bash
cd hither_app
bash scripts/task-end-ship.sh --dry-run
```

暫時關閉：

```bash
# 整段 pipeline
set TASK_END_SHIP=0          # PowerShell: $env:TASK_END_SHIP=0
# 或只關 OTA / 版號 / commit
TASK_END_SHIP_OTA=0
TASK_END_SHIP_BUMP=0
TASK_END_SHIP_COMMIT=0
```

與 post-commit 的關係：`task-end-ship` 執行期間固定 `OTA_AUTO_SHIP=0`，避免 commit 時再觸發 `ota-auto-ship` 雙重發佈。

## 4. 重建 `.claude/agents/`（多模型調度）

見 CLAUDE.md「多模型調度」章節。兩個 agent 定義檔：

- `deep-reasoner.md`（model: opus）— 架構決策、根因分析、tradeoff、非平凡 code review。
- `fast-worker.md`（model: sonnet）— 規格定案後的機械執行。

## 5. Supabase CLI 重新 link（要跑 migration 時才需要）

```bash
cd hither_app   # link 綁在 repo 目錄
supabase link --project-ref htqrucnjafhhvxdqslbv
```

## 6. 編輯器

VS Code 開啟後若舊檔案顯示紅字（例如 `src/native/liquidGlass.tsx`），是 TS server 快取沒跟上新裝的 node_modules：Ctrl+Shift+P → 「TypeScript: Restart TS Server」。

## 7. 驗證

```bash
cd apps/mobile && npm test && npm run typecheck
```
