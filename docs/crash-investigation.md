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

The app records consented `app_foreground` events with `source` set to `launch` or `resume`, plus the executing `updateId` and `runtimeVersion`. These records use the existing SQLite queue and survive restart until upload. Join their diagnostic session to `diagnostic_sessions` for the native build and installation identity.

Correlate the incident timestamp with events from the same installation and native build. Keep timestamp timezone information from the report. The crash report's upload time and the current OTA at upload are not the original crash's execution identity. If no preceding release record exists, report that attribution as unknown.

## Native observer regression

`HitherLiveActivityObserversTests.swift` exercises the production observer owner under concurrent adoption, token access and module destruction. The existing `jsi-ui-runtime` CI job compiles it with Thread Sanitizer. JavaScript error boundaries and Jest cannot establish that a native Dictionary race is fixed.

The observer fix ships in runtime `0.1.14` and requires a new binary. A successful OTA for an older runtime does not repair its compiled Swift implementation. Keep the matching archive and dSYMs for each delivered binary so later incidents can be symbolicated.
