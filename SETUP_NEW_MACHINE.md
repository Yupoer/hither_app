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

## 4. 共用技能

使用使用者共用技能目錄 `~/.agents/skills`。Claude 的技能入口指向同一來源，不維護另一份內容。
`workflow-controller` 自動接續規劃、實作、審查修復、合併與清理。
只有 Release skill 為 `gpt-6-astra`／`low`；其餘 workflow phase 使用 `gpt-5.6-luna`／`max`。宿主不可用時明示能力限制。
主工作樹不用安裝只為模擬模型的 nested launcher。

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
