# WIP-org 整合狀態

日期：2026-08-04  
指令：整合驗證後**不要** merge / push 遠端 master。

## 結果摘要

| 項目 | 狀態 |
|------|------|
| 基準 | 最新 `origin/master` (`da459bf`) 上整合 WIP |
| 本地 master HEAD | 見 git（含 review-fix cherry-pick + follow-up commit） |
| `version` / `runtimeVersion` | **0.1.5** 保留 |
| Full Jest | **Passed** 155 / 1303 |
| Typecheck | **Passed** |
| Remote push | **未執行**（使用者要求） |
| `support-site` | **排除**：`C:\Users\alexs\Desktop\BZ\hither\support-site-separate-20260804` |

## 已整合（需進 Git）

- Energy observability + MetricKit 接縫 + 啟動採樣
- Group recovery snapshot RPC / client fence
- Server-owned coordination deadline scheduler
- Premium catalog / purchase flow / recovery / projection
- StoreKit shared verifier + apple-server-notifications + verify-and-apply-purchase (JWS)
- Map native boundary、route LOD、mutation overlay
- Migrations `20260804000000`–`20260804040000` + SQL tests
- Task Spec / Ticket / Code Review / Report

## 明確排除

- `support-site`（獨立專案；不進 Mobile commit）
- 未授權的 production Supabase deploy / TestFlight / OTA

## 外部 blocker（不得宣稱完成）

- Deno runtime、pgTAP、StoreKit sandbox、Instruments、EAS/TestFlight

## 下一步（需使用者明確授權）

1. 審閱本地 commit / diff
2. 授權後再 `push origin master`（或 feature branch）
3. 另授權再 deploy migration / edge / TestFlight
