Verdict: PASS

# OTA-01 second review — repair round 2

The P1 race is fixed: the network-error branch in `useJourneyNavigation.ts` now leaves the gathering outbox pending and does not flush before `navigation_sessions` exists. The regression test asserts no flush on the rejected session start, while the success path still flushes once.

Verification: `journeyNavigation.test.tsx` and `coreDataLocalFirst.test.ts` passed (27 tests); `npm.cmd run typecheck` passed.

