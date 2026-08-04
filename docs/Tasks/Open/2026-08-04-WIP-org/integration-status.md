# WIP-org 整合狀態

日期：2026-08-05
指令：review-01 修復後 push master；**不要** OTA。db push 另執行。

## 結果摘要

| 項目 | 狀態 |
|------|------|
| 基準 | 規劃快照 `origin/master@da459bf`；整合於本地 master |
| Review-01 | 修復中／ship 時更新 |
| `version` / `runtimeVersion` | **0.1.5** 保留 |
| Full Jest | 以 ship 當下結果為準 |
| Typecheck | 以 ship 當下結果為準 |
| `git diff --check` | 以 ship 當下結果為準 |
| Remote push | ship 時執行 |
| `support-site` | **排除**：`C:\Users\alexs\Desktop\BZ\hither\support-site-separate-20260804` |
| WIP manifest | `wip-manifest.md` |

## Review-01 修復

- Recovery snapshot：`extensions.is_member`（拒絕過期匿名）
- SQL tests：真實 pgTAP（authz / scheduler）
- Energy：background 取消 steady timer
- Coordination：移除固定 60s read cadence
- Trigger functions：REVOKE EXECUTE
- Manifest + Ticket/Report 狀態更新
- trailing whitespace / EOF 清理

## 明確排除

- `support-site`（獨立專案）
- OTA / TestFlight / App Store submit（未請求）
- Ticket 10 歷史 mega-commit rewrite

## 外部 blocker

- Deno runtime、Instruments、StoreKit sandbox、MapKit visual
- 雙連線 SKIP LOCKED concurrency
