Verdict: FAIL

# OTA-01 second code review

## Finding

- **P1 — session/gathering ordering is still unsafe.** In `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts:198-202`, a network failure from `startSession()` is documented as “keep outbox”, but immediately calls `flushCoreOperationOutbox()`. The pending `start_gathering` operation can therefore be submitted before `navigation_sessions` exists; `supabase/migrations/20260726000100_apply_core_operation_gathering_validation.sql` does not establish that session row. This is the same authoritative-state race identified by the first review.

## Verification

Focused relevant Jest suites: 11 suites / 201 tests passed. Typecheck passed. No test currently exercises the network-error branch and asserts the outbox remains pending, so this review cannot pass.

## Required fix

Remove the network-error flush; reconnect/foreground outbox draining must retry only after the session-start path is available. Add one regression assertion for this branch, then rerun the focused suites and typecheck.

