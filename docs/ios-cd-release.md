# iOS CD release routes

Dispatch [.github/workflows/cd-ios-testflight.yml](../.github/workflows/cd-ios-testflight.yml)
on `master` with the reviewed 40-character `source_sha`. The workflow checks out that
commit and runs the native dependency alignment check before any release action.

## Production OTA

Use `mode=ota` only after the installed production binary is verified. The reviewed
[binary record](../release/ios-production-binary.json) names its source commit,
runtime, build, production channel, Apple state, and evidence. Update this record
only after checking the real build and its installability. The repository currently
records build 76, runtime `0.1.11`, from `164ca5c`. It does not establish an
installed `0.1.13` binary.

The OTA route requires the pinned source to still be the current `master` commit.
It compares every mobile change since the binary source with a conservative
allowlist for JavaScript, TypeScript, and tests. iOS code, modules, targets,
plugins, patches, app config, package changes, assets, and unrecognized mobile
paths stop the OTA route. It also checks the app and embedded iOS update runtime,
the EAS production build channel, and the active production update branch.
An incompatible or missing binary record stops before `eas update`; use the
native route after completing its release checks.

Set `backend_verified=true` for `ota` or `submit` only after checking that every
backend change required by the pinned source is applied in production. The input
records the release operator's verification; it does not deploy the backend.
The OTA step uses the existing `EXPO_TOKEN` GitHub secret and the EAS production
environment. It loads that environment before evaluating the production app config,
which requires valid HTTPS privacy and terms URLs. It publishes iOS only, then reads
back the update ID, group, runtime, branch, and source. A failed readback
requires direct inspection before any retry. The workflow keeps a small
receipt for 14 days.

## Native build and TestFlight

`preflight` checks Xcode and dependencies without signing. `build-only` builds
and validates a signed IPA; `submit` builds and uploads it to TestFlight.
These modes remain available when the binary record does not permit OTA.
The workflow uploads a build receipt, not the signed IPA, as a GitHub artifact.
Before treating a native release as complete, perform the full Release simulator
cold-launch check in [iOS startup validation](ios-release-startup-validation.md),
read back Apple processing, and verify the installed build on a real device.
The CI actor probes and `preflight` do not perform those checks.

The historical `scripts/ota-auto-ship.sh` and `scripts/task-end-ship.sh` are
retired compatibility stubs. A Git push alone does not publish an update.
