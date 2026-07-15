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
