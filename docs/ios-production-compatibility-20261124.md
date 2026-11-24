# Production iOS compatibility review, 2026-11-24

The `reviewed_compatibility` record admits the current master against the
production binary built from `f11507b8f50ce8ee852e5e21b064cba299119f0a`
(runtime `0.1.17`, version `0.1.17`, build `88`, `IN_BETA_TESTING`), recorded in
[ios-production-build-88](ios-production-build-88.md). The record uses that
source as `comparisonBaselineSha` and keeps `binarySourceSha` null.

## Review

The compatibility gate stops at `apps/mobile/App.tsx` because the entrypoint is
not on its JavaScript allowlist. Every other mobile change since the baseline is
under `apps/mobile/src`, `test` or `scripts`, and `package.json`, `app.json`,
`ios`, `modules`, plugins and lockfiles are unchanged.

The only `App.tsx` change (`1d16ea4a`) adapts the MetricKit upload loop to
`uploadMetricPayloadBatch` returning `{ acceptedIds, expiredIds }` and removes
both sets from local storage. It adds no import and calls no native module, so
the binary's native surface and runtime are unaffected.

## Limits

This is a source review, not an observation of an installed App. The record
names the exact baseline and reviewed blobs of `apps/mobile/App.tsx`; any other
change to that file, or any new non-allowlisted mobile path, stops OTA again.
Production backend changes that this App version depends on
(`20261118030000` telemetry ingestion) were applied and recorded before this
review.
