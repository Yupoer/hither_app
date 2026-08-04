# WIP Manifest — 2026-08-04 WIP-org

**基準：** 規劃快照 `origin/master@da459bf`；整合後本地 master 含 review-01 fixes。  
**來源：** `wip-org-backup-20260804/status.txt`、backup tree、local commits `db99706`…`HEAD`。  
**規則：** 每一列有 owner、目標 ticket、處置、驗證、落點；數量摘要不得取代本表。

## Legend

| Disposition | Meaning |
|-------------|---------|
| integrated | 進入 hither_app Git |
| excluded | 明確不進 Mobile delivery |
| transferred | 移出 repo 邊界 |
| lost | 無法恢復；以 Spec/Ticket 取代 |
| forbidden | 禁止提交（secrets/cache） |

## A. Pre-integration inventory（status.txt 快照）

| Path | Source | Owner | Ticket | Disposition | Verify | Landing |
|------|--------|-------|--------|-------------|--------|---------|
| `CLAUDE.md` | tracked M | docs | 08 | integrated | local | c262bf6 + whitespace fix |
| `SETUP_NEW_MACHINE.md` | tracked M | docs | 08 | integrated | local | c262bf6 |
| `apps/mobile/.env.example` | tracked M | mobile | 06 | integrated | local | c262bf6 |
| `apps/mobile/App.tsx` | tracked M | mobile | 03 | integrated | local | c262bf6 |
| `apps/mobile/app.json` | tracked M | mobile | 08 | integrated | local | c262bf6（0.1.5 保留） |
| `apps/mobile/modules/hither-metrics/ios/HitherMetricsModule.swift` | tracked M | mobile | 03 | integrated | local | c262bf6 |
| `apps/mobile/package-lock.json` | tracked M | mobile | 08 | integrated | local | 前輪 master 保護 |
| `apps/mobile/package.json` | tracked M | mobile | 08 | integrated | local | 前輪 master 保護 |
| `apps/mobile/src/__tests__/coordinationRequestUiContract.test.ts` | tracked M | mobile | 05 | integrated | local + Jest | c262bf6 / review-01 fix |
| `apps/mobile/src/__tests__/destinationMarkerChrome.test.ts` | tracked M | mobile | 07 | integrated | local | c262bf6 |
| `apps/mobile/src/__tests__/entitlementContract.test.ts` | tracked M | mobile | 06 | integrated | local | c262bf6 |
| `apps/mobile/src/__tests__/metricKitContract.test.ts` | tracked M | mobile | 03 | integrated | local | c262bf6 |
| `apps/mobile/src/__tests__/useGroupStateRecoveryRace.test.tsx` | tracked M | mobile | 04 | integrated | local | c262bf6 |
| `apps/mobile/src/api/client.ts` | tracked M | mobile | 04–06 | integrated | local | c262bf6 |
| `apps/mobile/src/api/demo.ts` | tracked M | mobile | 06 | integrated | local | c262bf6 |
| `apps/mobile/src/api/services/CoordinationRequestService.ts` | tracked M | mobile | 05 | integrated | local | c262bf6 |
| `apps/mobile/src/api/services/DestinationService.ts` | tracked M | mobile | 07 | integrated | local | c262bf6 |
| `apps/mobile/src/api/services/EntitlementService.ts` | tracked M | mobile | 06 | integrated | local | c262bf6 |
| `apps/mobile/src/api/services/GroupService.ts` | tracked M | mobile | 04 | integrated | local | c262bf6 |
| `apps/mobile/src/components/AmicroButton.tsx` | tracked M | mobile | 07 | integrated | local | c262bf6 |
| `apps/mobile/src/components/DestinationReorderList.tsx` | tracked M | mobile | 07 | integrated | local | c262bf6 |
| `apps/mobile/src/components/GroupMap.tsx` | tracked M | mobile | 07 | integrated | local | c262bf6 |
| `apps/mobile/src/entitlements.ts` | tracked M | mobile | 06 | integrated | local | c262bf6 |
| `apps/mobile/src/i18n/index.ts` | tracked M | mobile | 06–07 | integrated | local | c262bf6 |
| `apps/mobile/src/native/index.ts` | tracked M | mobile | 03 | integrated | local | c262bf6 |
| `apps/mobile/src/native/metrics.ts` | tracked M | mobile | 03 | integrated | local | c262bf6 |
| `apps/mobile/src/screens/MapScreen.tsx` | tracked M | mobile | 07 | integrated | local | c262bf6 |
| `apps/mobile/src/screens/MapScreen/hooks/useCoordinationRequests.ts` | tracked M | mobile | 05 | integrated | local + Jest | c262bf6 / review-01：移除固定 60s read |
| `apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts` | tracked M | mobile | 03 | integrated | local | c262bf6 |
| `apps/mobile/src/state/SessionContext.tsx` | tracked M | mobile | 06 | integrated | local | c262bf6 |
| `apps/mobile/src/state/performance.ts` | tracked M | mobile | 03 | integrated | local | c262bf6 |
| `apps/mobile/src/state/useGroupState.ts` | tracked M | mobile | 04 | integrated | local | c262bf6 |
| `apps/mobile/src/utils/destinationMarkerChrome.ts` | tracked M | mobile | 07 | integrated | local | c262bf6 |
| `apps/mobile/src/utils/profiling.ts` | tracked M | mobile | 03 | integrated | local | c262bf6 |
| `docs/.../implementation-summary.md` | tracked M | docs | 08–09 | integrated | local | c262bf6 |
| `apps/mobile/plugins/withExpoIap.js` | untracked | mobile | 06 | integrated | local | c262bf6 |
| `apps/mobile/src/__tests__/coordinationDeadlineScheduler.test.ts` | untracked | mobile | 05 | integrated | local + Jest | c262bf6 / review-01 |
| `apps/mobile/src/__tests__/destinationMutationOverlay.test.ts` | untracked | mobile | 07 | integrated | local | c262bf6 |
| `apps/mobile/src/__tests__/energyObservability.test.ts` | untracked | mobile | 03 | integrated | local + Jest | c262bf6 / review-01 background cancel |
| `apps/mobile/src/__tests__/groupRecoverySnapshot.test.ts` | untracked | mobile | 04 | integrated | local + Jest | c262bf6 / review-01 is_member |
| `apps/mobile/src/components/PremiumPurchaseRecovery.tsx` | untracked | mobile | 06 | integrated | local | c262bf6 |
| `apps/mobile/src/premiumCatalog.ts` | untracked | mobile | 06 | integrated | local | c262bf6 |
| `apps/mobile/src/services/premiumPurchaseFlow.ts` | untracked | mobile | 06 | integrated | local | c262bf6 |
| `apps/mobile/src/state/energyObservability.ts` | untracked | mobile | 03 | integrated | local + Jest | c262bf6 / review-01 |
| `apps/mobile/src/utils/destinationMutationOverlay.ts` | untracked | mobile | 07 | integrated | local | c262bf6 |
| `docs/Tasks/Open/2026-08-04-WIP-org/**` | untracked | docs | 01–11 | integrated | local | c262bf6 / 298465f / review-01 |
| `docs/.../iOS-Energy-Premium-Map-UX/Code Review|Spec|Ticket` | untracked | docs | 08 | integrated | local | c262bf6 |
| `supabase/functions/verify-and-apply-purchase/` | untracked | supabase | 06 | integrated | source only | c262bf6 |
| `supabase/migrations/20260804010000_*` | untracked | supabase | 04 | integrated | source + db push | c262bf6 / review-01 is_member |
| `supabase/migrations/20260804020000_*` | untracked | supabase | 05 | integrated | source + db push | c262bf6 |
| `supabase/migrations/20260804040000_*` | untracked | supabase | 06 | integrated | source + db push | c262bf6 |
| `supabase/tests/coordination_deadline_scheduler.test.sql` | untracked | supabase | 05 | integrated | pgTAP source | c262bf6 / review-01 rewrite |
| `supabase/tests/group_recovery_snapshot.test.sql` | untracked | supabase | 04 | integrated | pgTAP source | c262bf6 / review-01 rewrite |
| `support-site/`（原 repo 內） | untracked | support | 08 | transferred | external | `C:\Users\alexs\Desktop\BZ\hither\support-site-separate-20260804` |

## B. 已在前輪 commits 的切片

| Path / domain | Ticket | Disposition | Landing |
|---------------|--------|-------------|---------|
| `20260804000000_personal_premium_projection.sql` | 06 | integrated | db99706 / review-01 trigger REVOKE |
| `20260804030000_storekit_purchase_and_notification_ledger.sql` | 06 | integrated | db99706 |
| Premium map review fixes | 02 | integrated | db99706, 7d1c6c9 |
| merge integrate/wip-org-20260804 | 02 | integrated | d746c8c |
| integration verification report | 09 | integrated | 298465f / review-01 honesty update |

## C. Local commits（origin/master..）

| SHA | Purpose | Domains |
|-----|---------|---------|
| db99706 | iOS premium map review findings | mobile, supabase premium |
| d746c8c | merge integrate/wip-org | merge |
| 7d1c6c9 | remaining premium map findings | mobile |
| c262bf6 | mega WIP integrate（Energy/snapshot/deadline/premium/map/docs） | multi — **Ticket 10 residual** |
| 298465f | WIP-org verification report | docs |
| review-01 follow-ups | scoped fixes（authz, energy, coordination, docs） | multi |

## D. Lost / excluded / forbidden

| Item | Disposition | Notes |
|------|-------------|-------|
| `docs/Tasks/Open/2026-08-04-WIP-org/2026-08-04-WIP-org.md` | lost | Never tracked; not in git history or backup as that filename. Superseded by Spec + Tickets + this manifest |
| `support-site` | transferred | Outside mobile repo |
| `wip-org-backup-20260804` | excluded backup | Host path only; do not commit |
| `.env` / secrets / node_modules / ios build / Expo cache | forbidden | Not committed |
| `docs/Tasks/Open/reward-pod-fix` | excluded from this ship | Unrelated worktree delete restored; not part of WIP-org |

## E. Review-01 remediation rows

| Finding | Fix | Landing domain |
|---------|-----|----------------|
| Snapshot expired-anon bypass | `extensions.is_member` in RPC | supabase 04 |
| SQL tests stubs | real pgTAP files | supabase tests |
| Energy steady in background | pause/resume timers | mobile 03 |
| Coordination 60s read | remove setInterval | mobile 05 |
| Trigger EXECUTE | REVOKE on trg_* | supabase 06 |
| WIP manifest missing | this file | docs 01/08 |
| git diff --check | strip trailing ws / EOF | chore |
| Ticket status stale | Ticket/Spec/Report update | docs |

## F. External gates（not WIP files）

| Gate | Status |
|------|--------|
| Full Jest / typecheck | Passed when green at ship |
| Supabase db push | Applied when push succeeds |
| pgTAP multi-connection SKIP LOCKED | Unverified |
| Deno Edge tests | Blocked (no Deno) |
| StoreKit / MapKit / Instruments / EAS OTA / TestFlight | Unverified / not requested |
