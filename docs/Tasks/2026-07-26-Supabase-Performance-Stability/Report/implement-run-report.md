# /implement Run Report — Supabase Performance & Stability

**Date:** 2026-07-26  
**IMPL_ID:** `135e903a`  
**Effort:** 1 (single general reviewer)  
**Task root:** `hither_app/docs/Tasks/2026-07-26-Supabase-Performance-Stability`

## Summary of what was implemented

Low-risk lifecycle/performance slices for tickets **01–05**, with device-only and migration work left open where evidence is required.

| Ticket | Outcome |
|--------|---------|
| **01** Realtime + session lifecycle | **Done (re-verified)** — unique `gathering-workflow` topic per effect; stable `navigationSessionId` / `hasNavigationSession`. Device remount checks still open. |
| **02** Watchdog + crash evidence | **Partial** — background stage timing + near-watchdog flag; crash class wired into previous_launch + MetricKit drain. Symbolication / release-device profiling not claimed. |
| **03** Maps 503 | **Code complete** — Edge + client error codes; per-key + global cool-down for quota/missing_config; haversine fallback retained. Staging controlled-503 still open. |
| **04** DB advisor | **Evidence only** — inventory + plan in `04-database-advisor-inventory.md`; **no migrations**. |
| **05** Live Activity tokens | **Code complete** — reclaim own token, refuse foreign, `token_unique_unresolved`, soft-fail; call-site allow-listed telemetry. |

### Key design decisions

1. Evidence-first for watchdog (instrument, don’t rewrite ack/outbox/LA semantics).
2. Maps: never auto-retry quota; global cool-down for quota / missing_config; in-flight share + success TTL kept.
3. DB: no batch indexes; reviewed exceptions documented.
4. Tokens: never steal under RLS; no token strings in diagnostics.

## Effort & review loop

| Item | Value |
|------|--------|
| Effort | 1 — specializations: `general` only |
| Review rounds | **2** (1 review + 1 re-review after fix) |
| Round 1 open issues | 10 (0 bug, 7 suggestion, 3 nit) |
| Round 2 open issues | **0** (pass) |
| Cumulative issues addressed | 10 (7 suggestion, 3 nit) |

### Issues by reviewer

| Source | Round 1 | Round 2 |
|--------|---------|---------|
| General | 10 | 0 |

### Round-1 themes (all fixed)

1. Token register results discarded at call sites → allow-listed `live_activity_token_register`
2. Timeline undercount → wall-clock after work; fire-and-forget write
3. Per-key-only quota cool-down → process-global for quota/missing_config
4. Weak maps cache tests → runtime fetch-mocked suite
5. Crash class dead code → wired in `App.tsx`
6. Empty select after 23505 → `token_unique_unresolved`
7. Clear-update errors ignored → `unknown_error`
8–10. Nits: dropped field, comment, success vs budget semantics

## Files changed

### Added

- `apps/mobile/src/utils/backgroundOpTiming.ts`
- `apps/mobile/src/utils/crashClass.ts`
- `apps/mobile/src/__tests__/backgroundOpTiming.test.ts`
- This `Report/` tree

### Modified (primary)

- `apps/mobile/src/state/backgroundJourney.ts`
- `apps/mobile/src/native/googleMapsProxy.ts`
- `apps/mobile/src/state/useLiveActivity.ts`
- `apps/mobile/src/api/services/LiveActivityService.ts`
- `apps/mobile/App.tsx` (crash class wiring)
- `supabase/functions/google-maps/index.ts`, `types.ts`
- Tests: `googleMapsProxyCache`, `activityTokenService`, `apiErrorClassificationContract`
- Ticket status markdown under `Ticket/`

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` (apps/mobile) | **passed** |
| Targeted Jest (post-fix) | googleMapsProxyCache 10, activityTokenService 8, backgroundOpTiming 9, apiErrorClassificationContract 11 — **passed** |
| Lint | Not gate (pre-existing ~114 errors baseline per spec) |

## Report artifacts in this folder

| File | Purpose |
|------|---------|
| `implementation-summary.md` | Full implementer summary |
| `implement-run-report.md` | This /implement loop report |
| `02-watchdog.md` | Ticket 02 notes |
| `03-maps-503.md` | Ticket 03 notes |
| `04-database-advisor-inventory.md` | Advisor inventory + plan (no migrations) |
| `05-live-activity-token.md` | Token idempotency notes |

## Still open (not claimed done)

1. Device: Realtime remount / group switch / BG return (01)
2. Device: release-like background timeline + MetricKit symbolication (02)
3. Staging: controlled Maps 503 acceptance (03)
4. DB: EXPLAIN-backed migrations one-at-a-time (04)
5. Production observation of new token/register + crash-class events

## Memory update

**Skipped** — `memory.py` requires `fcntl` (Unix); unavailable on this Windows host (`ModuleNotFoundError: fcntl`). Patterns from this run (for manual/future use):

- Call-site discard of classified service results (observability gap)
- Instrumentation measuring before final critical-path I/O
- Per-key cooldown insufficient for global quota limits
- Source-string “tests” without runtime fetch mocks
- Helper shipped but not wired into production ingest

## Notable

- Implementer correctly kept ticket 04 as evidence-only (no speculative migrations).
- No wontfix disputes; all 10 review items fixed.
- Privacy: timeline/token/crash-class paths use allow-listed fields only (no tokens/coords in new reason strings).
