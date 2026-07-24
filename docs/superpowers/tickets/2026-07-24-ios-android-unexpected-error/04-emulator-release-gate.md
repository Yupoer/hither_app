# iOS / Android emulator release-like error gate

**Ticket:** 04 — release-like scripted acceptance gate  
**Scope:** App-level JS telemetry, classification, finite recovery  
**Not in scope for pass criteria:** physical-device native crash / ANR / GPU (document as residual risk only)

## Shared scripted flow (iOS + Android emulator)

Run the same steps on both platforms. Prefer a release-like build (`release` / preview channel OTA) when available; debug is acceptable for wiring checks only.

| Step | Action | Expected user surface | Expected telemetry (consent ON) |
|------|--------|----------------------|--------------------------------|
| 1 | Cold launch → session restore | Lands on RoleSelect or Map without blank screen | `launchPhase` progresses; `routeName` set |
| 2 | Map entry | Single Map route; map chrome usable | `routeName=Map`, `lastScreen=Map` |
| 3 | Map leave → re-entry | Still single current Map route (no stacked Maps) | Route breadcrumb updates; one focused Map |
| 4 | Leader-only RPC as non-leader / stale role | Soft-fail; map stays; no root “Something went wrong” | `subsystem=authorization`, `errorCode=leader_role_required`, `supabaseOperation` set |
| 5 | Search / directions with Maps proxy 503 (or offline) | Search empty / directions null; map UI remains | `subsystem=maps`, `httpStatus=503` (or network `0`) |
| 6 | Live Activity token conflict (if platform supports) | Map/session UI not replaced | `subsystem=registration`, `httpStatus=409`, `error.live_activity.token_conflict` |
| 7 | Trigger UI action error (e.g. forced network fail on a button) | Recovery banner; screen data kept | `ui_action_error` + `actionId` + `screen` + `parentTraceId` |
| 8 | Action timeout (slow network) | Busy clears; banner; no permanent spinner | `ui_action_timeout`, `outcome=timeout` |
| 9 | Banner Retry | Re-runs same actionId; no session/group clear | `ui_action_retry` then success or new failure |
| 10 | Banner Cancel | Banner dismisses; no re-run | `ui_action_cancel`, `outcome=cancelled` |
| 11 | Double-tap action | One side effect only | `ui_action_ignored` reason `in_flight` |
| 12 | Force a React render throw in a **test-only** path (dev) | Root fallback → one Retry → terminal if still failing | `error.react_render` with `componentStack`, `routeName`, `errorMessage`, `sourceLocation` |
| 13 | Map subtree failure (if injectable) | Map-only fallback; rest of app chrome available | `error.map_surface_failure`, `scope=map_subtree` |
| 14 | Background → foreground | No permanent spinner; no duplicate navigation | App state samples only if full tracing |
| 15 | Consent OFF | No new performance outbox rows | `getDiagnosticConsentEnabled` false path |

## Capture checklist (each failure)

Record in the results template (local docs only):

- time (UTC)
- platform (`ios` / `android`) + emulator image
- buildNumber / appVersion / updateId / runtimeVersion
- routeName / lastScreen / actionId (if any)
- operation / subsystem / errorCode / httpStatus / supabaseCode
- stack/component breadcrumb (`errorFrames` / `componentStack` / `sourceLocation`) — **no tokens, user IDs, coordinates, raw responses**

## Automated checks (no device)

From `hither_app/apps/mobile`:

```bash
npm test -- --testPathPattern="errorContextContract|apiErrorClassificationContract|recoveryContract|appErrorBoundary|instrumentedSupabase|uiActionContract|performanceTracingContract|performanceFlush"
```

These prove allow-list retention, redaction, resolved `{ error }` classification, finite recovery contracts, and consent-gated outbox behavior.

## Pass / fail for this phase

**Pass (app-level tickets 01–04 complete):**

- Automated contract suite green
- Emulator scripted flow shows classified errors (not contextless generic only)
- Map failure does not escalate to root fallback
- Retry/Cancel/timeout repeatedly verifiable
- Consent off → no outbox writes

**Does not pass native risk:**

- SIGSEGV / EXC_BAD_ACCESS / ANR / frozen frames / Activity destroy without JS event  
→ document under residual risks; open native follow-up only with evidence (local docs, not external tracker unless humans choose)

## Residual risks

- Emulator pass ≠ physical GPU / Play Services / APNs Live Activity hardware behavior
- Non-cancellable Promises can still complete after UI timeout (token guards UI, not network cancel)
- Root Error Boundary cannot catch event-handler throws, native crashes, or ANR
- Exact historical `stackHash=37a18da1` root component still unknown until next live event with new diagnostics
