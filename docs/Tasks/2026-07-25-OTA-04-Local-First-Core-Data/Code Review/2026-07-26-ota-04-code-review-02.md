Verdict: FAIL

# OTA-04 second code review

## Finding

- **P1 — local-first replay can bypass navigation-session creation.** `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts:198-202` flushes `core_operation_outbox` in the `startSession()` network-error branch. The local-first `start_gathering` operation can then mutate authoritative gathering state while the navigation session insert failed. This violates the OTA-04 consistency invariant and duplicates the unresolved OTA-01 race.

## Verification

Focused relevant Jest suites: 11 suites / 201 tests passed. Typecheck passed. The failure path is not covered by a regression test, so the result is FAIL.

## Required fix

Keep the outbox pending on session-start network failure; retry through the existing reconnect/foreground drain after session creation succeeds. Add one regression assertion and rerun focused suites plus typecheck.

