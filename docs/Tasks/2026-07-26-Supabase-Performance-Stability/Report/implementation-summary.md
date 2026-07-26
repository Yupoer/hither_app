# Implementation Summary — Supabase Performance & Stability (2026-07-26)

## Ticket status

| Ticket | Status | Notes |
|--------|--------|-------|
| 01 Realtime + session lifecycle | **done** (code verified) | Device acceptance still open |
| 02 Native watchdog + crash evidence | **partial** | Client timeline + crash class shipped; device profiling / symbolication remain |
| 03 Maps 503 fallback + observability | **code complete** | Needs controlled 503 device/staging verification |
| 04 Database advisor hot-path review | **evidence only** | Inventory + plan; no speculative migrations applied |
| 05 Live Activity token idempotency | **code complete** | Jest covers reclaim / foreign conflict / benign 409 |

## What changed

### Ticket 01 (verified, no rework)

Already present in `MapScreen.tsx`:

- Unique Realtime topic: `gathering-workflow:${groupId}:${++workflowChannelSeqRef.current}`
- Stable `navigationSessionId` / `hasNavigationSession` deps for background journey + energy monitor
- Single-flight + 2.5s `WORKFLOW_MIN_INTERVAL_MS` reload throttle retained

**Still open (device-only):** group enter/switch/background return remount subscription check; energy `end` event absence on session version updates.

### Ticket 02 — Background op timing + crash class

**Added**

- `apps/mobile/src/utils/backgroundOpTiming.ts` — stage timer, compact allow-listed reason string, 8s near-watchdog budget helper
- `apps/mobile/src/utils/crashClass.ts` — `classifyCrashClass` + `classifyMetricPayload`
- Instrumentation in `apps/mobile/src/state/backgroundJourney.ts` around config load, AsyncStorage, Live Activity update, diagnostics, outbox enqueue/flush, purge, session ack, clear activities
- **Wired** in `App.tsx`: previous_launch + MetricKit drain → allow-listed crash class diagnostics

**Design**

- Timeline fire-and-forget after wall-clock mark; completed callbacks keep `success: true`; near-budget uses event name + `errorCode: watchdog_budget`
- No change to arrival, outbox, Live Activity, or session-ack semantics
- Device MetricKit symbolication and release-like profiling **not** claimed done

### Ticket 03 — Maps 503 classification + bounded recovery

**Edge Function** (`supabase/functions/google-maps/`)

- Distinct error bodies: `quota_rpc_failed`, `missing_config`, `upstream_unavailable`, `quota_exceeded` (429)

**Client** (`apps/mobile/src/native/googleMapsProxy.ts`)

- Matching `MapsProxyErrorCode` values
- Success TTL 45s + in-flight sharing retained
- Per-key failure cooldown **plus** process-global cool-down for quota / missing_config
- Runtime Jest covers in-flight share, TTL, cooldown, global quota
- Caller `getDirections` still returns `null` → MapScreen/haversine degraded UI preserved

### Ticket 04 — DB advisor

See `Report/04-database-advisor-inventory.md`. **No production migrations shipped** without EXPLAIN evidence.

### Ticket 05 — Live Activity token idempotency

**Updated** `LiveActivityService.upsertDeviceActivityToken`:

- Conflict target remains `user_id,device_id`
- On token unique: reclaim own devices; refuse foreign; empty select → `token_unique_unresolved`; clear-update fail → `unknown_error`
- Call sites record non-quiet results as `live_activity_token_register` (enum only, no token)
- Soft-fail (never throws on known conflicts)

## Tests run (post review-fix)

| Suite | Result |
|-------|--------|
| `backgroundOpTiming` | 9 passed |
| `googleMapsProxyCache` | 10 passed |
| `activityTokenService` | 8 passed |
| `apiErrorClassificationContract` | 11 passed |
| `npm run typecheck` | **passed** |

Lint: not treated as gate (spec baseline ~114 pre-existing errors).

## Privacy

- Diagnostics allow-list unchanged; stage summary uses existing `reason` string field
- No coordinates, push tokens, or raw PII in new telemetry
- Maps failure class uses existing `errorCode` path

## Out of scope (explicit)

- New crash SDK
- Infinite Realtime/Maps retries
- Batch advisor index dump
- RLS relaxation / service-role on client
- Claiming watchdog/SIG resolution without symbolicated stacks
