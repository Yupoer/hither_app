# Diagnostic consent + batch upload acceptance

Repeatable Expo development checks for opt-in diagnostics / performance / MetricKit batching.

## Gates (automated)

Run from `apps/mobile`:

```bash
npm test -- --runInBand src/__tests__/diagnosticConsent.test.ts src/__tests__/logBatchScheduler.test.ts src/__tests__/diagnostics.test.ts src/__tests__/diagnosticsUiContract.test.ts src/__tests__/performanceFlush.test.ts src/__tests__/performanceTracingContract.test.ts src/__tests__/metricKitContract.test.ts src/__tests__/uploadLocalLogs.test.ts src/__tests__/debugLocation.test.ts src/__tests__/debugLocationDeviceFeed.test.ts src/__tests__/locationPolicy.test.ts src/__tests__/locationOutbox.test.ts src/__tests__/navigationSessionState.test.tsx src/__tests__/journeyNavigation.test.tsx src/__tests__/navigationArrival.test.ts src/__tests__/mapUiContracts.test.ts src/__tests__/gatheringWorkflowContract.test.ts src/__tests__/performanceRegression.test.ts
npm run typecheck
```

## Switch-off (manual Expo, 30 min)

- No new local diagnostic/performance rows after switch-off.
- No `/ingest_diagnostic_batch`, `/performance_events`, or `/metric_payloads` network calls.
- Debug route UI stays 250 ms smooth with zero intermediate `location_upload_events`.
- Business ops (nav start/cancel/complete, arrival) still work.

## Switch-on (manual)

- 99 combined Log writes do not network; 100th flushes once.
- <100 writes flush after 15 minutes.
- One flush ≤100 diagnostics + ≤100 performance + ≤5 MetricKit payloads.
- Offline flush uses 1/5/15/30 min backoff; switch-off purges pending local Log rows.

Native MetricKit enable/disable requires a development build with `hither-metrics` (Expo Go cannot load custom native modules).
