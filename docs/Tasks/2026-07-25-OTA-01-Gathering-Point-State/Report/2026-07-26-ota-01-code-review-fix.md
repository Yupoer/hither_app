# Report: OTA-01 Code Review Fix

> Date: 2026-07-26  
> Status: **Code review P1s addressed** (pending re-review / migration deploy)  
> Source: `Code Review/2026-07-26-ota-01-code-review.md`

## 1. Summary

Fixed the two P1 findings that blocked OTA-01:

1. **Server authority** — `apply_core_operation` Start/End now validate itinerary ownership, open order, and legal next point inside a locked transaction.
2. **Optimistic outbox vs legacy navigation** — Leader Start only flushes the gathering outbox after `startSession` succeeds; business rejections abort outbox and restore pre-Start local gathering state.

Shared with OTA-04 (same RPC + client paths).

## 2. Findings → delivery

| Finding | Severity | Fix |
|---|---|---|
| `apply_core_operation` did not verify gathering point exists / next pending | P1 | New migration replaces RPC body with itinerary locks + legality checks |
| Legacy `startSession` failure still kept optimistic gathering outbox | P1 | `flushImmediately: false` + network vs business error paths; conflict + rollback on non-transient errors |

## 3. Behavior

### Server (`apply_core_operation` gathering Start)

- Requires UUID `activeDestinationId`.
- Locks/verifies `itinerary_items` for `p_group_id`.
- Rejects closed points and non-`pending` point status.
- Allows Start only on the **next open** point (`day`, `position`, `id` within same `subgroup_id`).
- Returns `invalid_transition` on illegal payloads.

### Server (End)

- Completes only the **server** active destination id.
- Computes legal next from open itinerary.
- Client `nextDestinationId` must match legal next (or empty when none) — **never** invents pending for unknown IDs.
- Membership check uses expiry-aware `extensions.is_member` (OTA-05).

### Client (`useJourneyNavigation` / outbox)

1. Enqueue Start with `flushImmediately: false` (local optimistic only).
2. Call legacy `startSession`.
3. **Success** → flush outbox.
4. **Network** (`isNetworkRequestError`) → keep outbox for offline retry.
5. **Business rejection** → `abortLeaderGatheringStart`: mark outbox `conflict`, restore pre-Start gathering, clear optimistic UI.

## 4. Files

| Path | Change |
|---|---|
| `supabase/migrations/20260726000100_apply_core_operation_gathering_validation.sql` | **New** — hardened RPC |
| `supabase/tests/core_operation_gathering_validation.test.sql` | **New** — pgTAP integration tests |
| `apps/mobile/src/state/coreOperationOutbox.ts` | Return base from enqueue; `markGatheringConflictAndRestore` |
| `apps/mobile/src/state/coreDataSync.ts` | `flushImmediately`; `abortLeaderGatheringStart` |
| `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts` | Network vs business error handling |
| `apps/mobile/src/__tests__/coreDataLocalFirst.test.ts` | Unit + contract coverage |

## 5. Verification

| Command | Result |
|---|---|
| `npm run typecheck` (apps/mobile) | Pass |
| `jest --testPathPattern=coreDataLocalFirst` | Pass (incl. abort + migration contract asserts) |
| pgTAP `core_operation_gathering_validation.test.sql` | In-repo; not executed against live DB in this pass |

## 6. Residual risks

1. **True offline Start** still queues gathering without a `navigation_sessions` row; full fix needs a single server transaction (session + gathering) or post-apply session retry.
2. Only `isNetworkRequestError` patterns count as transient; unusual transport errors may abort Start.
3. Deploy migration `20260726000100` before relying on server validation in staging/production.

## 7. Re-review checklist

- [ ] Start with non-existent / completed / non-next itinerary id → `invalid_transition`
- [ ] End with unknown `nextDestinationId` → `invalid_transition` (no invented pending)
- [ ] Leader Start when session already active → outbox conflict + local rollback
- [ ] Offline Start retains outbox; reconnect flush still intentional until session correlation lands
