Next: read the code review + task Spec/Ticket docs, then fix findings root-cause.P1 root cause is clear: network-error path flushes gathering outbox before session exists. Finding tests and related outbox code next.Implementing the fix: remove the network-error flush, then add a regression test.Contract assertion was brittle — switching to a count-based check that only one flush call site remains.Main Jest config only matches `*.test.ts`, so the regression assertion needs to live in a `.test.ts` suite that actually runs.Default Jest only runs `*.test.ts`. Adding a pure unit test there and keeping the `.tsx` behavioral coverage.Extracting a pure classifier so default Jest (`*.test.ts`) can assert the network-error branch.Simplifying the success path — always flush there; classifier only for errors.Classifier was pulling in Supabase via `_helpers`. Decoupling it so unit tests stay pure.# Grok Implementation Report

## Summary

Fixed the **P1 session/gathering ordering race** from code review 02.

**Root cause:** On `startSession()` network failure, the leader path kept the optimistic `start_gathering` outbox (correct) but immediately called `flushCoreOperationOutbox()` (wrong). That could apply team `en_route` before any `navigation_sessions` row existed.

**Fix:** Network errors now resolve to `keep_pending` — outbox stays local, no flush. Flush only runs after `startSession` succeeds. Business rejections still abort/restore.

## Changed

| File | Change |
|---|---|
| `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts` | Removed network-error flush; classify via `resolveGatheringOutboxAfterSessionStart` |
| `apps/mobile/src/utils/gatheringSessionOutbox.ts` | **New** pure classifier: `flush` / `keep_pending` / `abort` |
| `apps/mobile/src/__tests__/gatheringSessionOutbox.test.ts` | **New** regression + wiring assertions |
| `apps/mobile/src/__tests__/coreDataLocalFirst.test.ts` | Contract expects classifier + single flush site |
| `apps/mobile/src/__tests__/journeyNavigation.test.tsx` | Hook-level offline case (components Jest; not default `npm test`) |

**Ordering now:**

1. Enqueue Start (`flushImmediately: false`)
2. `startSession`
3. **Success** → flush outbox  
4. **Network** → keep pending, **no flush**  
5. **Business reject** → abort + restore

## Verification

| Check | Result |
|---|---|
| `jest --testPathPattern="gatheringSessionOutbox\|coreDataLocalFirst"` | **Pass** (31 tests) |
| Broader OTA-related suites (13 suites / 150 tests) | **Pass** |
| `npm run typecheck` | **Pass** |

No commit / push / OTA / EAS (per workflow override).

## Remaining Risks

1. **Reconnect/foreground drain** (`useGroupState` still calls `flushCoreOperationOutbox`) can still submit a pending Start without a successful session retry. Full fix needs session+gathering correlation or drain gated on session-start availability.
2. True offline Start still leaves optimistic local `en_route` until reconnect succeeds or aborts.
3. Component Jest suite (`journeyNavigation.test.tsx`) is not in default `npm test` (`*.test.ts` only).

**Next:** re-run code review on this worktree; then Codex can own commit/ship.