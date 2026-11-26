# Production iOS compatibility review, 2026-11-26

The `reviewed_compatibility` record admits the current master against the
production binary built from `f11507b8f50ce8ee852e5e21b064cba299119f0a`
(runtime `0.1.17`, version `0.1.17`, build `88`, `IN_BETA_TESTING`), recorded in
[ios-production-build-88](ios-production-build-88.md). The record uses that
source as `comparisonBaselineSha` and keeps `binarySourceSha` null. It extends
the [2026-11-24 review](ios-production-compatibility-20261124.md), whose
`apps/mobile/App.tsx` blobs are unchanged.

## Review

Since the baseline, the only mobile change outside the JavaScript allowlist besides
`App.tsx` is `apps/mobile/modules/hither-metrics/ios/HitherPaneView.swift`
(`d43adf42`). It stops committing a `CATransaction` inside `applyLayout` and only
toggles `disableActions`, restoring the previous value afterwards. The view's
props, events and commands (`setPanelHeight`, `contentDidLayout`) are unchanged,
so JavaScript built from the current master drives build 88's pane view through
the same interface. Build 88 keeps its older transaction handling until a new
binary ships; the JavaScript does not depend on the new behavior.

`package.json`, `app.json`, `ios`, plugins and lockfiles are unchanged since the
baseline, and no production backend change is required.

## Limits

This is a source review, not an observation of an installed App. The record
names the exact baseline and reviewed blobs of both paths; any other change to
them, or any new non-allowlisted mobile path, stops OTA again.
