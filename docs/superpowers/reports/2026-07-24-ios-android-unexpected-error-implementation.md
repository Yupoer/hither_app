# Code Review Report — iOS / Android Unexpected Error (Tickets 01–04)

**For:** external / other-agent code review  
**Date:** 2026-07-24  
**Repo:** `hither_app` (git root)  
**Branch:** `master` (uncommitted local changes at report time)  
**Primary package:** `apps/mobile` (Expo / React Native)  
**Tickets:** `docs/superpowers/tickets/2026-07-24-ios-android-unexpected-error/`  
**Spec (if present):** `docs/superpowers/specs/2026-07-24-ios-android-unexpected-error.md`

---

## 1. How to use this report

1. Read tickets `01`–`04` for acceptance criteria.
2. Diff only the **in-scope files** listed in §3 (ignore unrelated dirty tree noise: deleted brainstorm artifacts, MVP/PRODUCT doc churn, dist/ apk folders, etc.).
3. Run the automated suite in §7.
4. File findings with: severity (`bug` / `suggestion` / `nit`), `file:line`, description, suggestion.
5. Treat §8 residual risks as known — only re-open if you have a better fix or production evidence.

### Suggested review command (from `hither_app`)

```bash
# Core production diffs
git diff -- apps/mobile/App.tsx \
  apps/mobile/src/state/performance.ts \
  apps/mobile/src/utils/errorFingerprint.ts \
  apps/mobile/src/utils/uiAction.ts \
  apps/mobile/src/api/instrumentedSupabase.ts \
  apps/mobile/src/api/services/LiveActivityService.ts \
  apps/mobile/src/components/AppErrorBoundary.tsx \
  apps/mobile/src/components/GroupMap.tsx \
  apps/mobile/src/native/googleMapsProxy.ts \
  apps/mobile/src/screens/MapScreen.tsx

# New + extended tests
git status --short -- apps/mobile/src/__tests__/
```

### How to run tests (from `hither_app/apps/mobile`)

```bash
npm test -- --testPathPattern="errorContextContract|apiErrorClassificationContract|recoveryContract|appErrorBoundary|instrumentedSupabase|uiActionContract|performanceTracingContract|performanceFlush|emulatorReleaseGateContract|activityTokenService" --no-coverage
```

**Last known result (implementer + re-review):** suites green (≈10 suites / 87 tests on full pattern; 6 suites / 64 on re-review subset).

---

## 2. Problem statement

Production events showed `error.react_render` + `stackHash` with `lastScreen=unknown`, no component stack, no action/request correlation, and little readable message. Concurrent investigation window also had:

| Signal | Desired classification |
|--------|------------------------|
| PostgreSQL `leader role required` | authorization / soft-fail, not root render |
| Google Maps Edge Function 503/429/401 | maps subsystem + fallback |
| Live Activity token duplicate-key 409 | registration idempotency, not UI blocker |

**Goal:** one shared telemetry contract + correct classification + finite recovery — still one pipeline (SQLite performance outbox + consent + batch upload). No second crash SDK.

---

## 3. In-scope change set

### 3.1 Production (modified)

| File | Role in change |
|------|----------------|
| `apps/mobile/src/state/performance.ts` | Allow-list, sanitize, route/action context, `recordErrorEvent`, `traceApi` always-on errors, platform, payload budget |
| `apps/mobile/src/utils/errorFingerprint.ts` | Redaction, bounded diagnostics, `classifyUpstreamError` |
| `apps/mobile/src/api/instrumentedSupabase.ts` | Capture resolved `{ data, error }` for PostgREST |
| `apps/mobile/App.tsx` | Navigation `onReady`/`onStateChange` → `setLastRoute`; `setPerformancePlatform(Platform.OS)` |
| `apps/mobile/src/components/AppErrorBoundary.tsx` | componentStack + route; finite Retry / terminal episode |
| `apps/mobile/src/components/GroupMap.tsx` | Map-local boundary componentStack / subsystem |
| `apps/mobile/src/utils/uiAction.ts` | Bind/clear action context; retry/cancel audit events |
| `apps/mobile/src/native/googleMapsProxy.ts` | Classified maps proxy failures then rethrow |
| `apps/mobile/src/api/services/LiveActivityService.ts` | Soft-handle true duplicate-key only |
| `apps/mobile/src/screens/MapScreen.tsx` | Straggler soft-fail without second outbox write |

### 3.2 Tests (created)

| File | Ticket |
|------|--------|
| `apps/mobile/src/__tests__/errorContextContract.test.ts` | 01 |
| `apps/mobile/src/__tests__/apiErrorClassificationContract.test.ts` | 02 |
| `apps/mobile/src/__tests__/recoveryContract.test.ts` | 03 |
| `apps/mobile/src/__tests__/emulatorReleaseGateContract.test.ts` | 04 |

### 3.3 Tests (extended)

- `appErrorBoundary.test.ts`
- `performanceTracingContract.test.ts`
- (and related flush / activity token suites if present)

### 3.4 Docs (created / ticket)

| File | Purpose |
|------|---------|
| `docs/superpowers/tickets/2026-07-24-ios-android-unexpected-error/01-*.md` … `04-*.md` | Ticket AC |
| `.../04-emulator-release-gate.md` | Scripted iOS + Android emulator runbook |
| `.../04-results-template.md` | Local results capture (no GitHub issues) |
| `docs/superpowers/reports/2026-07-24-ios-android-unexpected-error-implementation.md` | This file |

### 3.5 Out of scope for this review

Do **not** treat as part of this feature unless they are accidental couplings:

- Deleted brainstorm / handoff docs, `docs/MVP.md` / `PRODUCT.md` / `bug-fixes-plan.md` bulk edits
- `scripts/ota-auto-ship.sh`, dist/apk artifacts, `.qa-runtime/`
- Physical-device native crash / ANR / GPU (documented residual only)

---

## 4. Design decisions (review against these)

| # | Decision | Rationale | Where |
|---|----------|-----------|--------|
| D1 | Single telemetry pipeline | Reuse outbox + consent + RLS; no crash SDK | `performance.ts` |
| D2 | Allow-list only (drop objects/arrays) | Prevents coords/raw response leakage | `PERFORMANCE_SAFE_FIELDS`, `sanitizePerformancePayload` |
| D3 | Correlation IDs length-bound only | UUID-shaped `requestId`/`parentTraceId` must not hit JWT/token redaction | `CORRELATION_ID_FIELDS` |
| D4 | Free-text still fully redacted | JWT, Bearer, long tokens, UUIDs in messages, query, coords | `redactSensitiveText` |
| D5 | Error events always-on (consent only) | Independent of `EXPO_PUBLIC_PERFORMANCE_TRACING=full` / 2h TTL | `recordErrorEvent` |
| D6 | Success traces still full-tracing gated | Avoid outbox spam | `traceApi` success branch |
| D7 | `traceApi` is canonical Supabase error owner | Soft-fail call sites must not double-write outbox | `LiveActivityService`, MapScreen straggler |
| D8 | Preserve service throw/fallback semantics | Maps still rethrows; LA conflict soft-returns; no blind retry | proxy / LA / straggler |
| D9 | Finite root Retry via `pendingRetryEpisode` | One Retry per failure episode; success remount ends episode | `AppErrorBoundary` |
| D10 | Map boundary stays map-local | Never promote map failure to root generic screen | `GroupMap` |
| D11 | Lazy `require` of performance from some modules | Keep Jest node suites free of RN native modules | uiAction / maps / LA |
| D12 | Host-injected `platform` | `performance.ts` must not import `react-native` | `setPerformancePlatform` in `App.tsx` |

---

## 5. Behavior contract by ticket

### Ticket 01 — Error context & correlation

**Must hold:**

- Root render error payload includes (after sanitize): update/runtime/build context, `routeName`/`routeKey`/`lastScreen`/`screen`, exception kind, stack hash, bounded `errorMessage` / frames / `componentStack`.
- UI action errors correlatable via `actionId` + `screen` + `parentTraceId`.
- `requestId` / `parentTraceId` **survive** sanitize even when RFC-4122 UUID.
- Sensitive values (group/user ids as free-form, coords, tokens) never in payload.
- Consent off → no outbox write.
- Recovery UX unchanged beyond telemetry enrichment.

**Key entry points:**

- `sanitizePerformancePayload` / `sanitizeStringValue` / `CORRELATION_ID_FIELDS`
- `setLastRoute` via NavigationContainer
- `setActiveActionContext` / `clearActiveActionContext` (generation-owned clear)
- `buildErrorDiagnostics` + root/map `componentStack`

### Ticket 02 — API / RPC / upstream classification

**Must hold:**

- Resolved Supabase `{ error }` → error event (not only rejected promises).
- Rejected network → same shape; no full-tracing requirement.
- Classifiable by operation/code/status:
  - `leader_role_required` → `subsystem=authorization`, ~403
  - Maps 503/429/401/network → `subsystem=maps`
  - PG `23505` / unique token conflict → `subsystem=registration`, `duplicate_key`, ~409
- Success `{ error: null }` → **no** error event.
- Soft-fail / throw / fallback behavior preserved.

**Key entry points:**

- `instrumentedSupabase` result capture
- `traceApi` + `isSupabaseErrorResult` + `buildApiErrorPayload`
- `classifyUpstreamError` in `errorFingerprint.ts`
- Maps proxy record-then-rethrow
- LA conflict matcher (only `23505` or unique/duplicate + constraint/table token — **not** bare table name alone for soft-return without unique wording)

### Ticket 03 — Finite React / map recovery

**Must hold:**

- Root: visible fallback → one user Retry remounts children only → second fail in episode → terminal (“Still not working”); **no** session/group clear.
- Successful remount clears `pendingRetryEpisode` so a later unrelated error still gets Retry.
- Map-only failure does not become root fallback; one user remount + terminal at map scope.
- Action timeout / reject / Retry / Cancel auditable; no permanent spinner; no session clear.
- Classified upstream errors stay off the root-render path unless actual render throws.

**Key entry points:**

- `AppErrorBoundary` (`pendingRetryEpisode`, terminal UI)
- `GroupMap` map boundary
- `uiAction` events: `ui_action_error` / `timeout` / `retry` / `cancel`

### Ticket 04 — Emulator release gate

**Must hold:**

- Shared field set for iOS + Android aggregation (`platform`, route, operation, subsystem, codes, …).
- Runbook + results template exist under local `docs` only.
- Automated gate contract tests prove shared fields / classification / recovery invariants / docs presence.
- Manual emulator execution is human follow-up; physical device not required for app-level pass.

---

## 6. Prior review (already fixed — re-verify, don’t re-litigate unless regressed)

These were open in round 1 and marked fixed in re-review (0 open). **Confirm still true:**

| # | Severity | Issue | Fix to verify |
|---|----------|--------|----------------|
| 1 | bug | UUID `requestId`/`parentTraceId` redacted to `[redacted_token]` | `CORRELATION_ID_FIELDS` length-only path |
| 2 | bug | Successful Retry left episode armed → next error went terminal | `pendingRetryEpisode` + clear in `componentDidUpdate` when `hasError` false |
| 3 | bug | LA soft-fail on any message containing table name (swallowed RLS) | Soft-return only `23505` or (unique/duplicate ∧ constraint/table token) |
| 4 | suggestion | Concurrent actions race on global context | Generation-owned clear; `traceApi` snapshots at start |
| 5 | suggestion | Double outbox (traceApi + call-site logError) | Call sites soft-fail without second outbox write |
| 6 | nit | Payload size not re-checked; char vs bytes | `utf8ByteLength` + re-check + essentials fallback |
| 7 | nit | `platform` allow-listed but never set | `setPerformancePlatform` in App + `releaseContext` |
| 8 | suggestion | Tests used non-UUID IDs | Contract tests with real RFC-4122 shapes |

**Known residual (not treated as open bug):** concurrent different `actionId`s still share one “current” global slot for *new* API starts after a later action overwrites it; per-call snapshots protect mid-flight only. Full ALS/stack is future work if production needs it.

---

## 7. Test map

| Suite | Intent |
|-------|--------|
| `errorContextContract` | Allow-list keep, redaction, UUID correlation survival, wiring markers |
| `apiErrorClassificationContract` | Resolved/rejected, 403/503/409, success no false error, always-on errors |
| `recoveryContract` | Finite recovery invariants; classified errors ≠ root render branch |
| `appErrorBoundary` | Episode / terminal / platform injection markers |
| `instrumentedSupabase` | Resolved `{ error }` capture |
| `uiActionContract` | Single-flight, timeout, retry, cancel |
| `performanceTracingContract` / `performanceFlush` | Outbox + consent + flush |
| `emulatorReleaseGateContract` | Shared fields, docs presence, gate invariants |

Reviewers should preferentially add failing tests for any new finding rather than only prose.

---

## 8. Residual risks / non-goals

1. **Manual emulator gate** not executed in implement environment — use `04-emulator-release-gate.md` + fill `04-results-template.md`.
2. **Physical device** only if native crash/ANR/GPU/APNs evidence — not a JS-fix prerequisite.
3. Historical `stackHash=37a18da1` root component remains unknown until a live event with new diagnostics.
4. Non-cancellable network promises may complete after UI timeout (token blocks apply; does not abort network).
5. Root Error Boundary cannot catch event-handler throws, native crashes, or ANR (React design limit).
6. LA 409 soft-return is intentional; re-evaluate only with caller evidence needing rethrow-on-conflict.

---

## 9. Review checklist (copy/paste for reviewers)

### Correctness

- [ ] `traceApi` records resolved `{ error }` and rejected promises; success does not emit error
- [ ] Errors do not require full-tracing TTL; still respect diagnostic consent
- [ ] UUID correlation IDs not redacted; free-text still redacts secrets/coords
- [ ] Payload stays under ~32 KB DB contract after sanitize escalations
- [ ] Classification maps leader / maps / registration distinctly
- [ ] LA soft-fail does not swallow RLS/permission errors
- [ ] Maps still rethrows after telemetry (fallback intact)
- [ ] Root Retry episode ends on successful remount
- [ ] Terminal path does not clear session/group
- [ ] Map boundary does not escalate to root
- [ ] `clearActiveActionContext(generation)` cannot clear a newer action’s slot
- [ ] No second outbox write for instrumented Supabase failures that soft-fail at call site

### Security / privacy

- [ ] No JWT, Bearer, long tokens, raw user/group IDs, coordinates, raw response blobs in outbox
- [ ] Objects/arrays dropped by sanitize
- [ ] Consent off → no insert / no flush of private diagnostics

### Tests

- [ ] Contract suite green
- [ ] UUID-shaped correlation covered end-to-end (sanitize + outbox)
- [ ] 403 / 503 / 409 / success cases covered
- [ ] Recovery finite-retry / terminal covered

### Scope / product

- [ ] No second telemetry/crash pipeline
- [ ] No blind retry loops on maps or leader-role
- [ ] Ticket 04 docs only local (no GitHub issue creation required by code)

---

## 10. Suggested high-risk code anchors

Prefer reading these first (line numbers approximate; re-anchor after edits):

| Area | File | Symbols / anchors |
|------|------|-------------------|
| Sanitize + correlation exemption | `performance.ts` | `CORRELATION_ID_FIELDS`, `sanitizeStringValue`, `sanitizePerformancePayload`, `utf8ByteLength` |
| Always-on errors | `performance.ts` | `recordErrorEvent`, `traceApi`, `buildApiErrorPayload` |
| Classification | `errorFingerprint.ts` | `redactSensitiveText`, `buildErrorDiagnostics`, `classifyUpstreamError` |
| PostgREST capture | `instrumentedSupabase.ts` | resolved result inspection |
| Root recovery | `AppErrorBoundary.tsx` | `pendingRetryEpisode`, `componentDidCatch`, `handleRetry` |
| Action correlation | `uiAction.ts` + `performance.ts` | `setActiveActionContext`, generation clear |
| Maps | `googleMapsProxy.ts` | classified record + rethrow |
| LA conflict | `LiveActivityService.ts` | `isConflict` matcher |
| Platform | `App.tsx` | `setPerformancePlatform(Platform.OS)`, route state handlers |

---

## 11. Implementer / review history (for context only)

| Phase | Result |
|-------|--------|
| Implement 01–04 | Code + tests + gate docs landed |
| Review round 1 | 8 open (3 bug, 3 suggestion, 2 nit) |
| Fix round 1 | All 8 addressed |
| Re-review | **0 open** — approve pending external review |

External reviewers are **not** bound by that approve; re-open anything with evidence.

---

## 12. Deliverable for the reviewing agent

Please produce:

1. **Verdict:** Approve / Request changes / Block  
2. **Issues list** using:

```markdown
### Issue N — Severity: bug|suggestion|nit
- **File**: path:line
- **Description**: …
- **Suggestion**: …
- **Status**: open
```

3. **Verification:** which tests you ran + pass/fail  
4. **Optional:** risk notes that are not code defects (emulator residual, etc.)

Write findings to a new file if helpful:

`docs/superpowers/reports/2026-07-24-ios-android-unexpected-error-findings.md`

Do **not** create GitHub issues unless a human explicitly asks.

---

## 13. One-line summary for the reviewing agent

> Review a privacy-safe performance outbox enrichment: correlation IDs + componentStack + always-on classified Supabase/maps/registration errors + finite React/map recovery; verify UUID correlation is not redacted, soft-fail is not over-broad, and service throw/fallback semantics are unchanged.
