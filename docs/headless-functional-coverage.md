# Headless functional scenarios and disconnection tolerance

Coverage means execution of a finite set of observable JavaScript behavior families. It is not a probability that arbitrary user scenarios work, a product function percentage, a registry entry count, or native/device coverage. The fixed requirements below were selected from actual App, screen, provider and service behavior before the combined verification run. Every cited scenario in a family must pass on its listed platforms. A mixed-platform trip is counted once, not as separate iOS and Android executions.

The denominator is 58 families, including 47 critical identity, ownership, delivery, financial and disconnection families. Acceptance requires at least 95% of these families and all critical families. Unexecuted, pending, failed and missing evidence never counts as passed. The machine-readable requirements are [functional-scenarios.json](../apps/mobile/test/headless/functional-scenarios.json).

## Reproduce evidence

Run from apps/mobile on Node >=22.16.0. Use a fresh explicit directory to retain detailed trip evidence. Existing directories are rejected before any file is written. Without the environment variable, the Jest trip executes the same assertions without saving detailed records.

```powershell
$env:HITHER_HEADLESS_TOKYO_OUTPUT='C:/path/to/new-trip-evidence-directory'
node test/headless/run.cjs --json --outputFile=C:/path/to/headless-results.json
node test/headless/scenario-coverage.cjs C:/path/to/headless-results.json C:/path/to/scenario-report.md
node test/headless/scenario-coverage.test.cjs
```

Evaluate the JSON produced by a complete run on the same source under review. Filtered execution is useful for diagnosis and leaves other families unexecuted. Do not combine historical results from different product or harness revisions. The report lists every matched test and platform. A complete registry or a catalog-only Jest run cannot pass this report.

## Disconnection tolerances

| Boundary | Configured value and meaning | Source and evidence |
| --- | --- | --- |
| GPS durability | Retain each captured event for 24 hours. Expire at capturedAt + 24h, including while powered off. This is bounded data retention, not guaranteed eventual delivery. | locationOutbox.ts; headlessToleranceScenario exercises actual SQLite at expiry minus 1 ms and exact expiry across process restarts. |
| GPS retry | Backoff starts at 2s, doubles through 4/8/16/32s and caps at 60s. A batch contains at most 50 events. Active foreground schedules retries; the OS may suspend background JS. | locationOutbox.ts; locationOutbox.test.ts checks the cap. Existing headless offline/restart and held-delivery cases verify real durable replay. |
| Failure classification | retryable and request_timeout remain queued. Other explicit server rejects are discarded. Stable accepted event IDs make lost ACK replay idempotent. | locationOutbox.ts; headlessScenario same-tick stale rejection, lost-ACK restart and transport-failure cases. |
| Network requests | Default request deadline is 10s, with abort; particular callers may override. A timeout does not prove the server failed to apply a request. | utils/requestDeadline.ts; held-response and lost-ACK cases preserve that distinction. |
| Realtime recovery | Full recovery polls every 120s when the channel says SUBSCRIBED and every 30s otherwise. This bounds the next attempt under the JS clock, not successful real-network completion. | useGroupState.ts; subscribed 120-second poll test and full App Tokyo dropped-Realtime case. |
| Realtime coalescing | General reload debounce is 300ms; member-location patches are coalesced for 250ms. | useGroupState.ts; held old recovery and newer peer fix case. |
| Location freshness | Ordinary samples are fresh for less than 120s. Passive background-task samples without a navigation session use less than 180s. Exactly reaching the limit is stale. Future samples beyond 120s are rejected. | utils/locationFreshness.ts and useDeviceLocation.ts; existing locationFreshness.test.ts boundary tests plus actual Tokyo FlockRow clocks and capturedAt evidence. |
| Privacy and accounts | Revocation and identity replacement fence pending and retired callbacks. A queue disappearing alone does not prove upload. | headlessScenario account/privacy cases; Tokyo checks receiver coordinates and exact capturedAt separately from queue drain. |

The harness advances time in chunks of at most 5s and settles real IPC between chunks. Each external request is stamped with the actor clock and the synchronous backend contract executes at that timestamp. This prevents a 120-second fake timer jump from manufacturing network deadlines or future server offsets. Held execution and held delivery keep their existing distinct semantics. The clock regression and full trip test both observe the real production clock consumers.

## Known limits and baseline gaps

The original Tokyo baseline produced 105 passed and 22 failed checks with no harness failure. After the bounded clock repair, 106 passed and 21 failed. Missed-Realtime fallback changed to pass. Exact offline location recovery still failed for both receivers. Pause content, repeated/new-leg receiver notices, solo/leave notices and next-day names also failed before the corresponding product fixes were integrated. These are diagnostic checks, not the family coverage numerator. Final family evidence must come from the combined source run.

The newly executed TTL boundary scenarios passed on both platforms. Actual group and add-place tour completion/restart also passed on both platforms, but those tests concern tours and do not substitute for disconnection tolerance. The user clarified that tolerance, rather than a toast or tour feature, was the requested focus.

Existing coordinate-form tests mount the real form, but the current Map parent coordinate opener is unreachable. This is recorded in operations-map.cjs and must not be claimed as an exercised Map parent workflow. Existing NativeObservers receipts establish notice emission, not a rendered toast. Neither is used to close a full App trip requirement.

No headless percentage establishes APNs/FCM delivery, SQL/RLS execution, production backend deployment, genuine Swift/Kotlin execution, native map drawing, hardware GPS accuracy, Android Doze, iOS suspension, battery endurance, or physical-device acceptance. Powered-off clock gaps establish durable restart behavior under the fixture, not overnight OS endurance. Those remain separate validation boundaries.

## Required observable families

All rows below are requirements with source-backed scenarios. This static table makes no PASS claim. Use the execution report for status.

| ID | Required outcome | Critical | Scenario source |
| --- | --- | --- | --- |
| AUTH-01 | Email credentials, registration and reset validate, preserve drafts and retry | yes | headlessAuthScenario.test.ts |
| AUTH-02 | Google and Apple cancellation, incomplete credentials and stage failures preserve identity | yes | headlessAuthScenario.test.ts |
| AUTH-03 | Recovery callback validates origin, expiry and one-time consumption | yes | headlessAuthScenario.test.ts |
| AUTH-04 | Guest creation and group join validate input without eager account creation | yes | headlessAuthScenario.test.ts |
| AUTH-05 | Cold identity and foreground transient refresh recover without losing sessions | yes | headlessAuthScenario.test.ts |
| AUTH-06 | Signout and account deletion require confirmation and successful server work | yes | headlessAuthScenario.test.ts |
| AUTH-07 | Anonymous upgrade and social linking retain UID, membership and authoritative expiry | yes | headlessAccountScenario.test.ts |
| ACCOUNT-01 | Profile edits cancel, trim, retain failed drafts and reject duplicate saves | no | headlessAccountScenario.test.ts |
| GROUP-01 | Home team list retries and entry adopts only one selected membership | yes | headlessAccountScenario.test.ts |
| GROUP-02 | Split, merge and invitations keep role and subgroup scope | yes | headlessAccountScenario.test.ts |
| GROUP-03 | Map leave and kick cancel safely and remove only the selected member | yes | headlessMapControlsScenario.test.ts |
| PRIVACY-01 | Teammates receive only public profile fields and denied reads never fall back to private data | yes | headlessPublicProfiles.test.ts |
| PRIVACY-02 | Notification names use public fields with safe missing-read fallbacks | yes | headlessPublicProfileNotifications.test.ts |
| DEST-01 | Search debounce and stale responses preserve current provider selection | no | headlessMapComponentsScenario.test.ts |
| DEST-02 | Coordinate form validates and resets its draft | no | headlessMapScenario.test.ts |
| DEST-03 | Map add stages without writes, commits durably before ACK and preserves provider identity | yes | headlessMapScenario.test.ts |
| DEST-04 | Favorites normalize owner identity, delete exactly and restore failed optimistic deletion | yes | headlessMapServiceScenario.test.ts |
| DEST-05 | KML cancellation, malformed files and quotas never import unintended points | no | headlessMapComponentsScenario.test.ts |
| DEST-06 | Actual Map KML import and follower suggestion approval persist the selected batch | yes | headlessMapScenario.test.ts |
| ROUTE-01 | Route day moves preserve closed history and flush stay selection only on Done | yes | headlessMapScenario.test.ts |
| ROUTE-02 | Subgroup edits cannot reorder the main itinerary | yes | headlessMapScenario.test.ts |
| ROUTE-03 | Route marker, trip and bulk-delete controls preserve cancellation | no | headlessMapScenario.test.ts |
| STAY-01 | Daily stay updates retain identity, clear safely and keep independent hotel cards | yes | headlessMapServiceScenario.test.ts |
| NAV-01 | Actual Start and End preserve terminal intent through held ACK and restart | yes | headlessMapScenario.test.ts |
| NAV-02 | Switch cancellation retains the old session and confirmed switch promotes the right day | yes | headlessMapScenario.test.ts |
| ARRIVAL-01 | Poor GPS cannot arrive and repeated valid GPS retains one durable automatic arrival | yes | headlessMapScenario.test.ts |
| ARRIVAL-02 | All-arrived completion closes the original session and keeps the audit trail | yes | headlessMapScenario.test.ts |
| ARRIVAL-03 | Force completion requires confirmation and cannot close a replacement or other scope session | yes | headlessForceCompletionScenario.test.ts |
| HISTORY-01 | History deletion confirms and personal arrival corrections keep session ownership | yes | headlessMapScenario.test.ts |
| COORD-01 | Coordination create, respond and override preserve the resolved result | yes | headlessMapScenario.test.ts |
| COORD-02 | Coordination reads remain pure and role-denied deadline mutation cannot resolve requests | yes | headlessMapServiceScenario.test.ts |
| LOC-01 | A fresh fix reaches another device through durable storage and platform wrappers | yes | headlessScenario.test.ts |
| SYNC-01 | Missed Realtime repairs by poll and late old recovery cannot overwrite a newer fix | yes | headlessScenario.test.ts |
| SYNC-02 | Offline GPS and lost-ACK replay retain original IDs and publish only once after restart | yes | headlessScenario.test.ts |
| SYNC-03 | Offline Start and End retain original FIFO intent across restart | yes | headlessScenario.test.ts |
| PRIVACY-03 | Revoked consent, retired callbacks and account replacement fence pending GPS and refreshes | yes | headlessScenario.test.ts |
| LOC-02 | Manual refresh confirms the accepted latest fix without allowing a watcher race to regress it | yes | headlessScenario.test.ts |
| LOC-03 | Permission denial, background owner handoff and stop failure obey actual wrapper contracts | yes | headlessNativeLocationScenario.test.ts |
| PRESENCE-01 | Actual solo, stealth and follow controls preserve consent and role scope | yes | headlessMapControlsScenario.test.ts |
| NOTICE-01 | Receiver preferences, role guards, push/realtime dedupe and stale-account awaits remain effective | yes | headlessStoreScenario.test.ts |
| NOTICE-02 | Local notification permission, scheduling and retryable durable delivery are explicit | yes | headlessStoreNativeScenario.test.ts |
| NOTICE-03 | Quick command role controls retain exact offline notification intent | yes | headlessStoreScenario.test.ts |
| MAP-01 | Camera, directions and provider choice use actual fixes and selected travel mode | no | headlessMapScenario.test.ts |
| LIVE-01 | Live Activity adopts only owned scope and throttles native display without granting access | yes | headlessStoreScenario.test.ts |
| STORE-01 | Ad rewards wait for SSV and lost-response redemption charges once | yes | headlessStoreScenario.test.ts |
| STORE-02 | Native ad cancellation, consent and no-fill never grant client-only credit | yes | headlessStoreNativeScenario.test.ts |
| PURCHASE-01 | Subscription and trip purchase finish only after verification for the selected owner/group | yes | headlessStoreScenario.test.ts |
| PURCHASE-02 | Restore and unfinished purchases respect authoritative revocation and personal/team separation | yes | headlessStoreScenario.test.ts |
| SETTINGS-01 | Preferences normalize and rehydrate while settings children and reset preserve ownership | no | headlessAccountScenario.test.ts |
| ONBOARD-01 | Leader, follower and browser onboarding preserve branch answers and denied permission progress | no | headlessAccountScenario.test.ts |
| TOUR-01 | Group and add-place tours complete independently and suppress replay after restart | no | headlessTourScenario.test.ts |
| TOUR-02 | Route tour previous, next, completion and replay state use actual controls | no | headlessMapControlsScenario.test.ts |
| SUPPORT-01 | Feedback failure keeps its draft and diagnostics respect consent and sanitization | yes | headlessAccountScenario.test.ts |
| RUNTIME-01 | OTA apply shares one flight and error boundaries offer only effective retries | no | headlessAccountScenario.test.ts |
| TRIP-01 | Full App two-day trip preserves exact receiver notices, live fixes, hotel, abrupt restart and traveler names | yes | headlessTokyoTripScenario.test.ts |
| TOLERANCE-01 | Offline GPS survives powered-off restart until exactly 24 hours, then expires without later upload | yes | headlessToleranceScenario.test.ts |
| TOLERANCE-02 | A connection flap during held delivery retains the same durable GPS identity for retry | yes | headlessScenario.test.ts |
| TOLERANCE-03 | Retryable transport failure retains GPS while permanent stale-sample rejection discards the rejected event | yes | headlessScenario.test.ts |
