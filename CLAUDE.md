# CLAUDE.md — Hither

任何 AI 助手（不限 Claude）在此 repo 工作時都適用。

## 現況（2026-07-02）

- **App**：React Native（Expo SDK 54）+ TypeScript，位於 `apps/mobile/`。
- **後端**：Supabase（project `htqrucnjafhhvxdqslbv`），全表開 RLS，匿名登入。無自建 API server（Vapor 已退役）。
- **原生層**：`ios_native/` 已退役僅剩參考文件。原生能力唯一入口是 `apps/mobile/src/native/`（location / maps / notifications / liveActivity / liquidGlass），用 `requireOptionalNativeModule` 偵測，Expo Go 下必須優雅降級走 JS fallback。UI 元件禁止直接判斷 `Platform.OS`。
- **文件**：`docs/MVP.md` 是 2026-06-16 初版 PRD，多處已被實作取代；現況以 `docs/dev-status.md` 為準（注意該報告錨定的 commit，之後的變更不在其中）。

## 工作規則

1. **每完成一個 phase 就 commit 一次**，只 stage 該 phase 的檔案。
2. **單人開發**：驗證通過後直接 merge 回 master 並**立即 push**，不留分支、不必問。不要讓 master 領先 origin 累積超過一個工作階段。
3. **「完成」的定義**：`npm test` + `npm run typecheck` 通過，**且該 flow 在 Expo Go 實機跑過**。跑不了的部分（需 Dev Build，如 Live Activity / 原生模組）要明說「未實機驗證」，不可寫「已完成」。「tsc 通過」不等於功能可用。
4. **Expo Go 相容性先行**：動地圖 / 定位 / 通知 / Live Activity 前，先確認 Expo Go 的 JS fallback 路徑存在且不會把原生 UI 元素（如動態島鏡射）漏渲染到 App 畫面上。
5. **使用者要指令時直接給指令**，不要先做一輪環境檢查。
6. **工具或 MCP 呼叫卡住/失敗一次就換替代路徑**（例如 fallback 到 Grep/Read），不要停在原地等人工 retry。
7. **UI baseline**：以「Hither MVP v1 design」為準，未經使用者同意不可大改畫面結構。
8. 架構決策已定（RN 核心、Supabase 後端、匿名登入、Firebase 切斷），**不要重問**。

## Debug 與求解策略

1. **先查 log 再猜**：app 每個操作＋結果都寫進自架的 activity log（Supabase 表，見 `21e64ab feat: self-hosted activity logs`）。debug 時直接去資料庫查 log，比重跑複現快。
2. **回溯 commit 是合法捷徑**：要達到某個目的時，`git log`／`git diff`／checkout 舊版本對照或直接還原，往往比從頭重推更快，別只想著往前改。
3. **與其修正不如打掉重作——但要先算帳**：某段程式碼愈修愈亂時，重寫是選項；但動手前必須衡量重寫是否**真的**更省 token、更省時、更穩定，確認划算才做，不要為重寫而重寫。

## 程式碼探索：何時用 codebase-memory MCP

滿足**任一**條件才優先用 cbm（`search_graph` / `trace_path` / `get_code_snippet`）：

- 預計動 **≥3 個檔案**，或說不出會動到哪些檔案
- 改**共用層**（`src/api/client.ts`、`src/state/`、`src/native/`、共用 hooks）——有多個 caller，需要 `trace_path` 確認影響面
- **重構 / 搬移 / 刪除**既有函式（需要知道誰在呼叫）

反之（單檔 UI 調整、樣式、文案、設定值、找某段文字）直接 Grep/Glob/Read，比較省 token。

**Token 效率判準**：真正的變數不是改動大小，而是「查詢型態」與「grep→Read 迭代輪數」。grep 爆 token 的點不是 grep 本身，是它逼出的多輪 Read（grep 定義→Read body→再 grep callee→再 Read，每輪拉進大段無關檔案）。

- **文字/定位型**（找字串、設定值、單一定義、單檔改）→ grep 省，1-2 次就完。
- **關係型**（誰呼叫、呼叫鏈、依賴、改簽名影響面）→ cbm 省，一次 `trace_path` 取代多輪迭代。改動再小，只要要「全部 caller」就屬此類。
- **常見函式名高命中需逐檔消歧** → cbm 省，圖用 node type/qualified name 消歧。
- **經驗法則**：預期 grep→Read→再 grep **≥2~3 輪**，或高命中需逐檔 Read 消歧 → 用 cbm；否則 grep。

## 多模型調度（主控 Fable 5 + 子 agent）

主模型固定為 Fable 5（推理 medium）(或是子模型不得高於主模型等級)，扮演 tech lead：自己只做決策、拆解任務、驗收結果，不做機械執行。派工給下列子 agent（定義在 `.claude/agents/`，該目錄未進版控，每台機器需各自建立）：

- **deep-reasoner（Opus）**：架構決策、疑難 bug 根因分析、tradeoff 判斷、非平凡邏輯的 code review。
- **fast-worker（Sonnet）**：規格已定案的機械執行——依指示改多檔案、跑指令、格式化、單純套用既有 pattern。

規則：
1. 先判斷任務屬於「深度推理」還是「機械執行」，各自只派給對應 agent，兩者互不看對方輸出，各自獨立回報給主控整合。
2. 判斷不出屬於哪一類、或任務很小（單檔小改）時，主控直接處理，不必硬拆兩個 agent。
3. 這套調度規則只影響「怎麼分工」，不改變本檔案其他章節既有的工作規則（每 phase commit、單人直接 merge push 等）。

## 驗證指令

```bash
cd apps/mobile && npm test && npm run typecheck
```

pre-push hook 會自動跑上面兩項（`.git/hooks/pre-push`，clone 後需重建，見根目錄 SETUP_NEW_MACHINE.md）。
