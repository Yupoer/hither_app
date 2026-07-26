# Report: OTA-04 Code Review Fix

> Date: 2026-07-26  
> Status: **Code review P1s addressed** (pending re-review / migration deploy)  
> Source: `Code Review/2026-07-26-ota-04-code-review.md`  
> Prior implementation: `2026-07-25-ota-04-local-first-core-data-implementation.md`

## 1. Summary

Fixed the two P1 findings that blocked OTA-04 local-first convergence:

1. **Outbox ↔ legacy navigation session consistency** — gathering Start no longer flushes optimistically before `startSession` outcome is known; business failures mark conflict and restore server-aligned local state.
2. **Unvalidated itinerary entities on replay** — remote `apply_core_operation` validates itinerary ownership, order, closed status, and transition legality under lock so offline replay cannot pollute shared state.

Shared with OTA-01 (same RPC + client paths).

## 2. Findings → delivery

| Finding | Severity | Fix |
|---|---|---|
| Local-first outbox and legacy navigation session not one consistent operation | P1 | Defer flush until session success; abort on non-transient errors |
| Server core operation accepted unverified itinerary entities | P1 | New migration hardens Start/End validation inside transaction |

## 3. Behavior

### Convergence path (Leader Start)

```
SQLite optimistic gathering + outbox (no flush)
        ↓
legacy startSession
        ↓
  success → flush outbox → apply_core_operation (validated)
  network → keep outbox for retry
  business → conflict outbox + restore pre-Start gathering
```

This prevents the previous failure mode where core outbox succeeded and bridged `groups.journey_status = going` without a matching `navigation_sessions` row after a business rejection.

### Server remote authority

- Start: next open pending itinerary item only for `p_group_id`.
- End: server active point only; legal next only — no inventing pending from client IDs.
- Idempotent op id / version conflict semantics unchanged; validation runs before state mutation and legacy group bridge.
- Membership via expiry-aware `extensions.is_member` (OTA-05).

## 4. Files

| Path | Change |
|---|---|
| `supabase/migrations/20260726000100_apply_core_operation_gathering_validation.sql` | **New** — itinerary-validated RPC |
| `supabase/tests/core_operation_gathering_validation.test.sql` | **New** — pgTAP |
| `apps/mobile/src/state/coreOperationOutbox.ts` | Conflict + restore helpers |
| `apps/mobile/src/state/coreDataSync.ts` | `flushImmediately`; abort path |
| `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts` | Error classification + ordering |
| `apps/mobile/src/__tests__/coreDataLocalFirst.test.ts` | Extended unit/contract tests |

## 5. Verification

| Command | Result |
|---|---|
| `npm run typecheck` (apps/mobile) | Pass |
| `jest --testPathPattern=coreDataLocalFirst` | Pass |
| pgTAP SQL harness | In-repo; not run against live DB here |

## 6. Residual risks

1. Offline Start without any session still possible until session + gathering share one server transaction or automatic session creation after outbox apply.
2. Remote-authoritative convergence for non-gathering entity types was out of this review scope.
3. Deploy `20260726000100` with OTA-05 `20260726000000` (timestamp order matters: expiry `is_member` first, then RPC replace that uses it).

## 7. Re-review checklist

- [ ] Business rejection on `startSession` → outbox status `conflict`, local gathering not left en_route
- [ ] Replay of illegal `activeDestinationId` / `nextDestinationId` → `invalid_transition`
- [ ] Successful online Start → session exists before core outbox flush
- [ ] Contract tests still declare hardened migration + abort helpers
