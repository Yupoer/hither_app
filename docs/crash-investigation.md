# Investigate a reported crash

Read the consented `metric_payloads` and `diagnostic_events` before attributing a crash to the latest OTA. Preserve raw device reports locally. MetricKit may deliver a report after a later launch, and iOS does not provide every termination as a crash diagnostic.

## Find the native incident

Read each entry in `payload.crashDiagnostics`. Its `diagnosticMetaData` contains the native version, build, signal and termination reason. `callStackTree.callStacks` marks the attributed thread with `threadAttributed: true`. Other threads are context, not proof that their code crashed.

```sql
select m.id, m.received_at,
       c->'diagnosticMetaData'->>'appVersion' as app_version,
       c->'diagnosticMetaData'->>'appBuildVersion' as build,
       c->'diagnosticMetaData'->>'signal' as signal,
       c->'diagnosticMetaData'->>'terminationReason' as termination_reason,
       s as attributed_stack
from public.metric_payloads m
cross join lateral jsonb_array_elements(m.payload->'crashDiagnostics') c
cross join lateral jsonb_array_elements(c->'callStackTree'->'callStacks') s
where m.kind = 'diagnostic'
  and m.received_at >= now() - interval '7 days'
  and (s->>'threadAttributed')::boolean
order by m.received_at desc;
```

For every frame, retain `binaryName`, `binaryUUID`, `address` and `offsetIntoBinaryTextSegment`. Match the dSYM UUID before symbolication. For that binary, its load address is `address - offsetIntoBinaryTextSegment`.

```sh
dwarfdump --uuid "$DSYM"
atos -arch arm64 -o "$DSYM" -l "$LOAD_ADDRESS" "$FRAME_ADDRESS"
```

A matching UUID and resolved function establish the fault site. Read its callers and ownership before choosing a fix. A nearby location, map or GPU signpost alone does not establish the cause.

## Identify the JavaScript release

The app records consented `app_foreground` events with `source` set to `launch` or `resume`, plus the executing `updateId` and `runtimeVersion`. Every diagnostic event captures its native build and app version when written to SQLite. Upload preserves that snapshot across restarts and binary upgrades. Older queued events without a snapshot use `unknown`, rather than the uploading binary's version.

Native build and app version come from `expo-application`'s `nativeBuildVersion` and `nativeApplicationVersion`, backed by the binary's platform metadata. The unsupported Expo Constants top-level `nativeBuildVersion` field and its empty Android platform map are not native build sources. Diagnostic uploads and MetricKit uploads use the same persisted installation ID. Join diagnostic sessions to `diagnostic_sessions` for that installation identity; a process session ID is not an installation ID.

Correlate the incident timestamp with events from the same installation and native build. Keep timestamp timezone information from the report. The crash report's upload time and the current OTA at upload are not the original crash's execution identity. If no preceding release record exists, report that attribution as unknown.

## Native observer regression

`HitherLiveActivityObserversTests.swift` exercises the production observer owner under concurrent adoption, token access and module destruction. The existing `jsi-ui-runtime` CI job compiles it with Thread Sanitizer. JavaScript error boundaries and Jest cannot establish that a native Dictionary race is fixed.

The observer fix ships in runtime `0.1.14` and requires a new binary. A successful OTA for an older runtime does not repair its compiled Swift implementation. Keep the matching archive and dSYMs for each delivered binary so later incidents can be symbolicated.

## Retain signed-build symbols

The TestFlight workflow sets `GYM_ARCHIVE_PATH` to `$RUNNER_TEMP/hither-signed-production.xcarchive` for its EAS local build. EAS CLI 21.0.2 uses local-build-plugin and build-tools 21.0.2. Its generated Gymfile sets IPA output and derived data directories, but does not set the archive path. Fastlane maps `GYM_ARCHIVE_PATH` to the archive used for IPA export. The archive sits outside the EAS working directory, so normal EAS cleanup remains enabled. See the [EAS launcher](https://github.com/expo/eas-cli/blob/v21.0.2/packages/eas-cli/src/build/local.ts), [local plugin dependencies](https://github.com/expo/eas-cli/blob/v21.0.2/packages/local-build-plugin/package.json), [Expo Gymfile template](https://github.com/expo/eas-cli/blob/v21.0.2/packages/build-tools/src/templates/GymfileArchive.ts), and [Fastlane archive option](https://github.com/fastlane/fastlane/blob/master/gym/lib/gym/options.rb).

After verifying the signed IPA, `scripts/retain-ios-debug-symbols.py` requires the app and widget version/build to agree and compares their executable UUIDs and architectures with the archive's dSYMs. Both must have exactly one matching bundle. The manifest records the source SHA, workflow run and attempt, native version/build, runtime/channel, IPA hash, and each binary's UUIDs and DWARF hash. Missing or mismatched symbols stop delivery before TestFlight upload. Version labels alone cannot establish a match; [Apple requires matching build UUIDs](https://developer.apple.com/documentation/xcode/locating-a-missing-debug-symbol-file).

dSYMs contain compilation paths and may include linked dependency symbols. A public repository's artifacts are downloadable by signed-in users with repository read access, so the workflow never uploads unencrypted symbols. It archives only `Hither.app.dSYM`, `HitherActivityWidget.appex.dSYM` and `manifest.json`, then encrypts that tar with OpenSSL CMS AES-256 and the public certificate in `scripts/hither-debug-symbols-recipient.pem`. Only `hither-ios-debug-symbols.encrypted.der` is uploaded. The IPA, archive, buildroot, tar, plaintext manifest, credentials and raw device reports stay outside that artifact. See [OpenSSL CMS encryption](https://docs.openssl.org/3.0/man1/openssl-cms/) and [GitHub artifact access](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).

Download the artifact named `hither-ios-symbols-RUN_ID-RUN_ATTEMPT` before its 90-day retention expires and keep the encrypted file locally for historical builds. The private key stays at `C:\Users\alexs\.codex\hither-debug-symbols\hither-symbols-20261105-private.pem`; it is never committed or uploaded. On a machine with that key, decrypt the downloaded DER before extracting its tar:

```sh
openssl cms -decrypt -binary -inform DER \
  -in hither-ios-debug-symbols.encrypted.der \
  -inkey "$LOCAL_KEY" -out hither-ios-debug-symbols.tar
tar -xf hither-ios-debug-symbols.tar
```

Compare the manifest's DWARF hashes after extraction and match the incident's binary UUID before symbolication. Artifact retention does not replace a local long-term copy or recover missing symbols from older builds.
