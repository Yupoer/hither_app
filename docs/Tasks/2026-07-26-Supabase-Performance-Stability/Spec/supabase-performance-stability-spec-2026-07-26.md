# Supabase 效能與穩定性第二輪 Spec

**狀態：** ready-for-agent  
**日期：** 2026-07-26  
**範圍：** Hither mobile Map/Navigation、背景定位、Google Maps proxy、Supabase performance/diagnostic logs

## Problem Statement

最近一輪 Supabase log 與 MetricKit evidence 顯示，這不是單一「地圖 retry」問題，而是三個互相干擾但根因不同的穩定性問題：

1. MapScreen 的 gathering workflow Realtime channel 使用固定 topic。元件生命週期重建或 group 切換後，可能在同一 channel 已 `subscribe()` 的情況下再次註冊 callback；最新 `error.react_render`（2026-07-25 08:29:42 UTC）明確記錄：`cannot add postgres_changes callbacks ... after subscribe()`，component stack 指向 `MapScreen`。
2. MetricKit 有一筆可確認的 native watchdog termination（2026-07-17 15:34:20 UTC，iPhone13,3，iOS 26.5.2，build 23）：背景 scene 10 秒 wall-clock allowance 用盡，thermal state serious，watchdog CPU statistics 顯示 67% total CPU。另有近期 SIG11（2026-07-25，build 39）與 SIG10（2026-07-18）資料，但目前缺少 symbolicated stack，不能把它們直接歸因於同一段 JS。
3. Google Maps proxy 在同一觀測窗有 6 筆 503。程式目前會保留 fallback route；Edge Function 的 503 可能來自 quota RPC、設定缺失或 Google upstream failure。因 quota 會在 upstream call 前記帳，不能用無上限 retry 掩蓋問題。

Supabase performance advisor 目前有 45 個 notices，主要是未索引 foreign key、unused index、以及 `live_activity_sessions` / `navigation_member_states` 的 multiple permissive policies。這些屬於需用 row count、`EXPLAIN` 與實際 query path 驗證的資料庫清理工作，不在本輪直接批次套用。

## Solution

先交付低風險、可立即驗證的 lifecycle/performance 修正，再把 native watchdog、maps 503 與 database advisor 分成可獨立完成的 vertical slices：

- Realtime workflow channel 每次 effect instance 使用唯一 topic，並維持 cleanup；保留既有 single-flight 與 2.5 秒 reload throttle。
- Background journey 與 foreground energy monitor 只依賴 navigation session 的 stable identity（session id / 是否存在），不因同一 session 的 version 或物件重建而重啟背景 controller、energy monitor。
- 不新增自動無限 retry；地圖失敗維持既有 fallback，另補上 503 分類、correlation/telemetry 與 bounded recovery acceptance。
- native crash 先以 release-like device profiling、MetricKit correlation、symbolication 找根因，再決定是否調整背景 callback、Live Activity 或定位 cadence。
- database advisor 先做 hot query inventory 與 EXPLAIN，再以小型 migration 逐項驗證；保留 RLS semantics。

## User Stories

1. As a member entering a group map, I want Realtime workflow updates to subscribe exactly once per mounted workflow effect, so that I do not hit the `postgres_changes callbacks after subscribe()` exception.
2. As a member switching groups or returning from background, I want the old workflow channel to be removed before the new one becomes authoritative, so that stale updates cannot mutate the new map state.
3. As a member receiving repeated arrival/request events, I want reloads to remain single-flight and throttled, so that a burst of Realtime events does not create a request storm or render storm.
4. As a member actively navigating, I want the energy monitor to continue across session row/version updates without restarting, so that telemetry does not add avoidable timers, flushes, or duplicate end samples.
5. As a member in background mode, I want session metadata refreshes to avoid restarting the background journey controller when the session identity has not changed, so that location and Live Activity work stay within the iOS watchdog budget.
6. As a member whose map route request receives a transient 503, I want the map to remain usable with the local fallback and a clearly classified diagnostic event, so that one upstream outage does not become a blank map or an infinite retry loop.
7. As a member retrying a failed map route, I want retry behavior to be bounded and deduplicated, so that the same route does not consume Google Maps quota multiple times concurrently.
8. As an operator reviewing a crash, I want the client to distinguish React render errors, watchdog termination, SIG10, and SIG11, so that remediation is based on evidence rather than a generic crash label.
9. As an operator investigating background stability, I want each background callback's expensive operations and elapsed time to be observable, so that a watchdog regression can be reproduced and attributed to a specific operation.
10. As an operator reviewing database performance, I want each missing FK index or permissive-policy notice tied to a real query plan and table growth signal, so that index writes and policy rewrites do not create new write or RLS regressions.
11. As a privacy-conscious member, I want diagnostics to remain user-scoped and payload allow-listed, so that performance debugging does not expose coordinates, tokens, or raw personal identifiers.
12. As a release owner, I want the acceptance gates to cover iOS and Android release-like builds, so that a passing Jest contract does not get mistaken for proof that native watchdog or SIG11 issues are resolved.

## Implementation Decisions

### Realtime lifecycle

- Use the existing Supabase client and channel cleanup mechanism.
- Use a per-hook/effect sequence suffix for the workflow channel name. This addresses the observed channel reuse error without introducing a new channel manager.
- Keep the existing `loadGatheringWorkflow` single-flight, pending rerun, and minimum interval behavior.
- Do not add a generic Realtime retry loop. Supabase Realtime already has reconnect/rejoin behavior; the application should only recover its own effect lifecycle and surface a bounded diagnostic when subscription status is abnormal.

### Session-driven work

- Derive `navigationSessionId` and `hasNavigationSession` once from the existing session state.
- Use those stable scalars in background journey and energy-monitor effect dependencies. Other session fields may continue to drive UI and acknowledgement logic where their values are semantically required.
- Do not change session acknowledgement semantics or the background task contract in this first patch.

### Watchdog/native crash

- Treat the confirmed 10-second watchdog termination as a separate native performance investigation, not as proof that the Realtime exception caused the crash.
- First measure background callback elapsed time, AsyncStorage/config writes, diagnostic writes, outbox flush, Live Activity update, and navigation-session acknowledgement on representative devices.
- Symbolicate SIG11/SIG10 before changing renderer, native map provider, Hermes, or navigation architecture.
- Preserve location, arrival, outbox, Live Activity, and session acknowledgement semantics while reducing duplicate or serial work.

### Maps 503

- Keep the existing local/haversine fallback for a failed directions request.
- Classify Edge Function 503 into quota RPC failure, missing configuration/API key, Google upstream non-2xx, and network/timeout.
- Share in-flight requests and use the existing success TTL. Add only a bounded recovery/cooldown if evidence shows repeated user-triggered calls; never retry blindly before classifying the failure.

### Supabase database

- Do not add all missing-FK indexes from the advisor in one migration.
- For each candidate, collect table cardinality, write rate, query path, and `EXPLAIN (ANALYZE, BUFFERS)` evidence; add only indexes with an identified hot read/delete/update path.
- Do not remove an unused index from a single snapshot. Re-check after a representative workload and consider rollback cost.
- Merge permissive policies only after proving equivalent RLS behavior for SELECT/UPDATE and authenticated users.

## Testing Decisions

### Completed in this change

- Jest: `performanceRegression.test.ts`, `recoveryContract.test.ts`, `googleMapsProxyCache.test.ts` — 3 suites, 22 tests passed.
- TypeScript: `npm.cmd run typecheck` passed.
- Supabase verification: `performance_events` query succeeded with 32,954 rows and latest event `2026-07-25 08:35:44.661+00`; performance advisor was re-read and still reports the same 45 notices. No remote schema was changed.

### Required before closing the tickets

- Re-run the Realtime contract on group enter, group switch, foreground/background return, and rapid effect remount; assert one active subscription and one cleanup per instance.
- Run iOS release-like build on a device with background journey enabled. Capture MetricKit payloads and an operation timeline; acceptance target is no callback/scene update exceeding the watchdog budget and no new duplicate energy `end` events from session version updates.
- Reproduce route 503 with controlled quota/upstream failure and verify fallback, bounded retry, deduplication, and telemetry classification.
- Run representative Supabase workload with EXPLAIN before/after each DB migration and verify RLS policy behavior with authenticated owner/non-owner cases.
- `npm.cmd run lint` currently fails on 114 pre-existing repository errors and reports 226 warnings across unrelated files; this is recorded as baseline, not treated as a regression from this patch.

## Out of Scope

- Guaranteeing zero crashes without a reproducible native stack and release-device evidence.
- Replacing MapKit/Google Maps, switching renderer/Hermes, or redesigning navigation architecture.
- Adding a new crash analytics SDK or a second diagnostic pipeline.
- Infinite Realtime or Google Maps retries, blanket channel recreation, or unbounded map remounts.
- Wholesale creation/removal of Supabase indexes based solely on advisor output.
- Relaxing RLS, exposing service-role credentials to the client, or storing raw coordinates/tokens in new telemetry.

## Further Notes

- Official Supabase Realtime guidance supports named channels with `postgres_changes`; the application-specific issue is channel lifecycle/reuse, not the existence of the subscription pattern itself: [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).
- Supabase's July 2026 Realtime updates include operational changes such as binary payload support and connection-log defaults; monitor release notes when interpreting new production telemetry: [July 2026 developer update](https://supabase.com/changelog/47796-developer-update-july-2026).
- The next highest-value evidence is a symbolicated SIG11 stack plus a background callback timeline on the same device class as the watchdog report.
- Future direction: add a release gate that compares watchdog/memory-pressure/SIG11 rates by build and keeps database advisor exceptions as reviewed, measurable debt.
