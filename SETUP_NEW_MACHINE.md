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

## 3. Git hooks 與發布

不安裝 pre-push 全套測試或 post-commit／Stop 自動發布 hook。
舊安裝的 `.git/hooks/pre-push`、`post-commit` 先檢查內容，再移除本專案的舊版本；保留其他自訂保障。
`install-git-hooks.sh` 與舊 auto-ship 入口只提示，不修改 Git 或發布 OTA。
驗證按 AGENTS.md 與 CI；OTA／build／submit 由明確授權的 release 流程執行。

## 4. 開發與發布流程

依 [README](README.md#development-and-release-workflow) 在本地實作、審查與驗證，再交付 `master` 並確認 CI。
完整 iOS 產品發布使用現有 `hither-release` 入口，先判斷 OTA 相容性；需要新 binary 時經 `mac-codex` 執行 EAS local build 和 TestFlight 上傳。
新電腦須另行設定 SSH、EAS 與 Apple 登入；不複製既有電腦的私密金鑰。

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
