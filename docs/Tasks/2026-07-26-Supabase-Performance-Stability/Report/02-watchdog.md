# Ticket 02 — Watchdog / native crash evidence notes

## Shipped (client)

1. **Background operation timeline** on each `hither-background-journey-location` callback that performs work:
   - Stages: `config_load`, `async_storage_write`, `live_activity_update`, `diagnostics_write`, `outbox_enqueue`, `outbox_flush` (incl. purge), `session_ack`, `clear_live_activities`
   - Events: `background_op_timeline` (normal) / `background_op_near_watchdog` when total ≥ 8s
   - Wall-clock `totalMs` after callback work; timeline diagnostics **fire-and-forget** (not on critical path)
   - Completed callbacks keep `success: true`; budget uses event + `errorCode=watchdog_budget`
   - Payload: `durationMs`, `count`, `reason` (compact stages), `source=background_task`

2. **Crash class** wired to production paths:
   - `classifyCrashClass` / `classifyMetricPayload`
   - `App.tsx` previous_launch → `errorCode` = class
   - MetricKit drain → `metric_payload_classified` with allow-listed class only

## Not done (device / operator)

| Item | Why open |
|------|----------|
| MetricKit build/device/time correlation of the 2026-07-17 watchdog payload | Requires device/MetricKit spool access |
| Symbolicated SIG11 (2026-07-25) / SIG10 (2026-07-18) | No dSYM/symbolicate run in this implementer pass |
| iPhone13,3 / iOS 26.x release-like reproduce | Device-only |
| Android background location path profiling | Device-only |
| Merging storage/telemetry writes out of critical path | Spec: only after timeline proves necessity — no proof yet |

## Controller restart check (code review)

`createBackgroundJourneyController.start` only restarts native location updates when:

- not already started, or
- `powerProfileKey(previous) !== powerProfileKey(config)`

MapScreen deps use stable `navigationSessionId` / `hasNavigationSession` (ticket 01) so session **version** object churn should not restart the controller. Confirm on device with timeline + energy monitor samples.

## Acceptance residual

- [ ] No background callback stage total ≥ watchdog budget on target devices
- [ ] No new duplicate energy `end` from session version updates
- [ ] Crash reports include operation stage + build + device + symbolicated frame
