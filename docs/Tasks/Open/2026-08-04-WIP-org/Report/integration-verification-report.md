# WIP-org 整合驗證報告

**日期：** 2026-08-04（整合）／2026-08-05（review-01 修復與交付）
**任務：** `docs/Tasks/Open/2026-08-04-WIP-org`
**執行環境限制：** `Agents.md` 指定 Sol / Luna 角色；本機僅有 `grok-4.5`，由同一模型完成盤點、整合、驗證與本報告。
**使用者指示（2026-08-05）：** 修復 review-01 → 清 WIP → push master；**不要 OTA**；需要則自行 db push。

---

## 1. 目標

1. 以最新 `origin/master` 為基準整合本地 WIP。
2. 完成 Energy、Premium／StoreKit、Supabase、Map UX 與同步相關功能。
3. 逐項清冊：整合／排除／移轉。
4. review-01 缺口修復後 push 遠端 master（無 OTA）。

---

## 2. 起始狀態（整合前）

| 項目 | 內容 |
|------|------|
| WIP 分支 | `codex/ios-energy-premium-map-ux-20260804` @ `9aa6660` |
| 當時 origin/master | `da459bf` |
| 工作樹 | 大量 modified + untracked |
| 風險 | 不得覆蓋 master **0.1.5** |

---

## 3. 整合執行摘要

- 備份：`wip-org-backup-20260804`
- support-site 移出：`support-site-separate-20260804`
- 本地 commits（origin 前）：`db99706`、`d746c8c`、`7d1c6c9`、`c262bf6`、`298465f` + review-01 scoped fixes
- **Ticket 10 residual：** `c262bf6` 為 78-file mega-commit，**未 rewrite**；後續 fixes 採 scoped commits

---

## 4. Review-01 修復（2026-08-05）

| Finding | 處置 | 狀態 |
|---------|------|------|
| P1 snapshot 過期匿名繞過 | `get_group_recovery_snapshot` 改 `extensions.is_member` | Fixed |
| P1 缺 WIP manifest | 新增 `wip-manifest.md`；lost task file disposition | Fixed |
| P2 SQL tests 僅 stub | 改寫為 pgTAP（authz / scheduler） | Fixed source；runtime 依 harness |
| P2 Energy 背景仍跑 steady | `pauseForBackground` 清 startup+steady；foreground resume | Fixed |
| P2 Coordination 60s read | 移除 `OPEN_REQUEST_RECOVERY_INTERVAL_MS` interval | Fixed |
| P2 git diff --check | 清理 trailing whitespace / EOF | Fixed at ship |
| P3 trigger 未 REVOKE | `trg_recompute_premium_*` REVOKE | Fixed |
| P3 Ticket 狀態未更新 | Tickets 01–11 + Spec 對齊證據 | Fixed |
| P2 Ticket 10 mega-commit | 記錄 residual；不 rewrite 歷史 | Accepted residual |

### Coordination recovery note

Client 不再固定 read cadence。Deadline 結算 server-owned；UI 更新靠 Realtime + mutation 後 explicit load。Group 60s snapshot **不含** coordination rows。

---

## 5. Gate matrix

| Gate | Status |
|------|--------|
| Full Jest | 以 ship 命令輸出為準 |
| Typecheck | 以 ship 命令輸出為準 |
| `git diff --check` | 以 ship 命令輸出為準 |
| WIP manifest | Present |
| Supabase db push | 以 ship 輸出為準 |
| pgTAP dual-session SKIP LOCKED | Unverified |
| Deno Edge tests | Blocked（無 Deno） |
| StoreKit sandbox / ASN | Unverified |
| MapKit visual / Instruments | Unverified |
| OTA / TestFlight | Not requested / Unverified |

---

## 6. 一句話結論

Review-01 source 缺口已修；manifest 與 ticket 狀態已對齊；mega-commit 歷史 residual 明示；push master 與 db push 依使用者授權執行；OTA 未發布。
