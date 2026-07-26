Verdict: PASS

# OTA-04 second review — repair round 2

The P1 local-first ordering race is fixed: a network failure during `startSession()` keeps the `start_gathering` outbox pending instead of replaying it without a navigation session. The success and non-retryable failure branches remain distinct and are covered by the navigation tests.

Verification: `journeyNavigation.test.tsx` and `coreDataLocalFirst.test.ts` passed (27 tests); `npm.cmd run typecheck` passed.

