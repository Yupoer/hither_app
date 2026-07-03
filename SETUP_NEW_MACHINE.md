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

## 3. 重建 pre-push hook

寫入 `.git/hooks/pre-push`（記得 `chmod +x`）：

```sh
#!/bin/sh
cd "$(git rev-parse --show-toplevel)/apps/mobile" || exit 1
npm test -- --silent || exit 1
npm run typecheck || exit 1
```

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
