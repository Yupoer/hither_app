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
installed `0.1.13` binary. GitHub `master` is the code baseline for comparing
changes. A TestFlight build can predate both this workflow and the binary record;
neither supplies its runtime or channel retroactively. A historical IPA is not
required when other trustworthy evidence establishes the installed binary's
runtime, channel, and native compatibility with that GitHub baseline. Update the
record with the evidence actually checked, including a verifiable ancestor
source SHA required by the current compatibility gate. Do not invent a source
receipt when it is absent.

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
The OTA step maps the existing `HITHER_GITHUB_ACTIONS` GitHub secret to the
`EXPO_TOKEN` environment variable. It loads the EAS production environment
before evaluating the production app config,
which requires valid HTTPS privacy and terms URLs. It publishes iOS only, then reads
back the update ID, group, runtime, branch, and source. A failed readback
requires direct inspection before any retry. The workflow keeps a small
receipt for 14 days.

## Native build and TestFlight

`inspect-release` uses a Linux GitHub runner and the existing
`HITHER_GITHUB_ACTIONS` secret as `EXPO_TOKEN` to read production iOS EAS
build, channel, and update metadata. The job uploads only a sanitized receipt.
A finished EAS build is a candidate binary; the receipt leaves Apple processing
and installed-device status unknown. IPA files built locally on a GitHub Xcode
runner may not appear in EAS Build history.

`preflight` checks Xcode and dependencies without signing. `validate-release`
builds the complete Release simulator app and requires two 45-second cold
launches before returning a sanitized receipt. Both `build-only` and `submit`
run the same full App gate before signing; `build-only` then builds and
validates a signed IPA, while `submit` builds and uploads it to TestFlight.
These modes remain available when the binary record does not permit OTA.
The workflow uploads receipts, not the signed IPA, screenshots, or native logs,
as GitHub artifacts. The simulator gate applies the full cold-launch check in
[iOS startup validation](ios-release-startup-validation.md). It verifies real
App startup and records screenshot hashes. The simulator build injects the
production update-channel header in a temporary copy of `Expo.plist`, restores
the checked-in file, and verifies the compiled App. EAS uses a remote auto
incrementing build number for the signed device IPA, so the simulator receipt
proves a source-equivalent Release launch rather than launching that IPA. The
workflow compares source and app version with the IPA and separately verifies
its embedded update runtime and production channel. The signed IPA receipt records
the verified runtime and production channel alongside its source SHA, version,
build number, and IPA SHA-256. It is a build receipt, not proof that Apple
processed the upload or that a user installed the binary. Visual screenshot review remains
pending. Read back Apple processing and verify the installed build on a real
device before treating a native release as complete. The CI actor probes and
quick `preflight` do not perform these checks.

## Failure triage before another run

Record the run ID, attempt, pinned source SHA, selected mode, and first failing
step. A Node 20 deprecation warning printed during post-job cleanup does not
explain an earlier step's exit code. Check each failed gate against its own
artifact or log before dispatching another build.

| Historical failed run | First failed gate in retained job logs | Follow-up evidence |
| --- | --- | --- |
| [40431629922](https://github.com/Yupoer/hither_app/actions/runs/40431629922) | The Expo token input was empty before EAS queries. | PR #330 mapped the existing secret; later runs authenticated. |
| [40456813396](https://github.com/Yupoer/hither_app/actions/runs/40456813396), [40459732842](https://github.com/Yupoer/hither_app/actions/runs/40459732842) | Inventory rejected a verified iOS update with a noncanonical platform label. | The first parser change did not fix it. PR #335 passed inventory in [40469578841](https://github.com/Yupoer/hither_app/actions/runs/40469578841). |
| [40471132413](https://github.com/Yupoer/hither_app/actions/runs/40471132413) | Runner CocoaPods version disagreed with `Podfile.lock`. | PR #336 pinned the version; the next run passed this gate. |
| [40474400700](https://github.com/Yupoer/hither_app/actions/runs/40474400700) | Generated privacy categories had the same disclosures in a different order. | PR #337 compares the disclosures while still rejecting changed content; the next run passed this gate. |
| [40479104034](https://github.com/Yupoer/hither_app/actions/runs/40479104034), [40486179433](https://github.com/Yupoer/hither_app/actions/runs/40486179433), [40538498115](https://github.com/Yupoer/hither_app/actions/runs/40538498115) | The full Release simulator did not reach the startup breadcrumb. | The [last run's sanitized diagnostic](https://github.com/Yupoer/hither_app/actions/runs/40538498115/artifacts/12752148731) shows `ProcessLookupError`, no matching crash report, and no runtime log signal. The cause remains unproven. PRs #339 and #340 added diagnostics, not a root-cause fix. |
| [40696292714](https://github.com/Yupoer/hither_app/actions/runs/40696292714) | The full Release simulator did not reach the startup breadcrumb. | The sanitized diagnostic reports `appProcessState=absent`, `processAlive=false`, and `simulatorState=booted`. Bundle-only system log hints include `jetsam` and `watchdog`; the earlier probe could not attribute either signal to the launched App PID. The cause remains unknown. |

Latest-source review also found that App startup checks for a production OTA
and can call `Updates.reloadAsync`, which intentionally restarts the process.
That is an unproven possibility for this run, alongside OS termination or an
early native failure. The retained diagnostic does not distinguish them.

For a cold-launch failure, read the sanitized diagnostic artifact for that exact
attempt and compare the process, breadcrumb, crash, and runtime-log fields.
Do not call `ProcessLookupError` an App crash or a PID-check bug without evidence
that distinguishes them. The failure artifact also reports whether a process
whose executable path matches this simulator's installed App has the original
PID, a replacement PID, or no matching PID, plus simulator state and allowlisted
system termination signals. `systemTerminationSignals` contains bundle-only
contextual hints and does not attribute them to the launched App. The separate
`pidCorrelatedSystemSignals` list requires the exact bundle ID and launched App
PID in a recognized termination-target form such as `application<bundle>:PID`.
The signal must occur in the same Apple NDJSON record, with a timestamp inside
the launch interval or the following one-second log grace period.
`systemLogWindowSeconds` records that bounded interval. The logging daemon's
`processID` field is not the App PID. A correlated signal is still an observation,
not proof of why the App stopped. `unavailable` means the probe failed; an empty
signal list means no matching evidence was found in that window, not proof of a
clean exit. These are advisory observations and never turn
a failed launch into a pass. If a source-equivalent simulator `.app` remains on a
trusted macOS host, run `apps/mobile/scripts/verify-ios-release-launch.py` against
that App and simulator to repeat only the two cold starts. GitHub runners do not
retain that App, so the next cloud check requires `mode=validate-release` with
the reviewed current `master` SHA and `backend_verified=false`. It rebuilds the
full Release simulator App, then uploads only a sanitized receipt or failure
diagnostic; it does not sign an IPA, submit to TestFlight, or publish OTA. Review
the new evidence before any further native retry. `ota` does not run this
simulator gate. Select it only when the verified binary record and all changes
since that binary pass compatibility checks. A successful `submit` still needs
separate Apple processing and installed-build evidence.

The historical `scripts/ota-auto-ship.sh` and `scripts/task-end-ship.sh` are
retired compatibility stubs. A Git push alone does not publish an update.
