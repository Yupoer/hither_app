# Implementation Report: OTA-04 Local-First Core Data

> Date: 2026-07-25  
> Status: **Code + unit/contract tests shipped**; review issues 1–13 fixed (exclusive txn, version-0 seed, product wiring, server locks/validation, conflict UI). Supabase migration needs deploy.  
> Audience: code reviewers

## 1. Summary

First-batch core journey data is now local-first in SQLite:

- **group snapshot + itinerary** with freshness metadata (`syncedAt`, `source`, `entityVersion`)
- **active gathering state** with OTA-01 `staying` / `en_route` and point `pending` → `en_route` → `completed`
- **personal navigation announcement responses** (user-scoped; never merged into team phase)
- **operation outbox** with stable operation id, entity version, retry backoff, and displayable conflict results

Offline cold start restores group + itinerary from SQLite; empty / stale snapshots surface distinct UI copy. Offline mutations write local optimistic state and outbox in one transaction path; reconnect flush is idempotent.

## 2. Acceptance mapping

### Ticket 01

| Criterion | Delivery |
|---|---|
| Core data in SQLite + freshness | `core_snapshots`, `core_active_gathering`, `core_navigation_responses` |
| Offline cold start restore | `useGroupState` paints local snapshot then reconciles remote |
| OTA-01 gathering semantics | `utils/activeGatheringState.ts` + projected into snapshot |
| Personal nav response isolation | Separate table/entity; tests assert team phase unchanged |
| Offline / empty / stale UI | `coreData.*` i18n + MapScreen banner / empty screen |

### Ticket 02

| Criterion | Delivery |
|---|---|
| Same-transaction local + outbox | `enqueueGatheringTransition` / `enqueueNavigationResponse` via `withTransaction` |
| id / version / retry / conflict | `CoreOperation` fields + SQLite columns |
| Idempotent replay | `apply_core_operation` + local applicator `duplicate` on same op id |
| Stale version conflict | Structured `CoreConflictResult`; server state written back for UI |
| reconnect / crash / replay tests | `coreDataLocalFirst.test.ts` |

## 3. Files

### Created

| Path | Role |
|---|---|
| `apps/mobile/src/types/coreData.ts` | Domain types |
| `apps/mobile/src/utils/activeGatheringState.ts` | OTA-01 pure state machine |
| `apps/mobile/src/utils/coreSnapshotFreshness.ts` | Fresh / aging / stale / missing |
| `apps/mobile/src/state/coreDataStore.ts` | Snapshot store (memory + SQLite) |
| `apps/mobile/src/state/coreOperationOutbox.ts` | Outbox + local applicator |
| `apps/mobile/src/state/coreDataSync.ts` | Production wiring |
| `apps/mobile/src/api/services/CoreDataService.ts` | Supabase `apply_core_operation` client |
| `apps/mobile/src/__tests__/coreDataLocalFirst.test.ts` | 19 unit/contract tests |
| `supabase/migrations/20260725000200_core_operation_sync.sql` | Server ledger + RPC |

### Modified

| Path | Change |
|---|---|
| `apps/mobile/src/state/hitherDatabase.ts` | Core tables + indexes |
| `apps/mobile/src/state/useGroupState.ts` | Local-first load / cache / freshness |
| `apps/mobile/src/screens/MapScreen.tsx` | Offline / stale / empty outcomes |
| `apps/mobile/src/i18n/index.ts` | `coreData.*` zh/en strings |
| `apps/mobile/src/api/client.ts` | Export `applyCoreOperation` |
| Ticket markdowns | Checkboxes completed |

## 4. Design decisions

1. **Transport-neutral operations** — `CoreOperation` + submitter interface; Supabase RPC now, Nearby later without rewriting domain rules.
2. **Snapshot embeds itinerary** — first batch keeps one JSON payload per group for cold-start simplicity; not a full table mirror of every remote row.
3. **Legacy bridge on server** — `start_gathering` / `end_gathering` also update `groups.journey_status` so existing realtime clients still observe journey changes.
4. **Conflict is visible** — stale version marks outbox `conflict` and replaces local entity with server state; no silent LWW of user intent.
5. **Nav response entity id** — `sessionId:userId`; server rejects applying another user's response.

## 5. Tests run

```
npx jest src/__tests__/coreDataLocalFirst.test.ts
npx jest src/__tests__/locationOutbox.test.ts src/__tests__/groupSyncContract.test.ts
npx tsc --noEmit
```

Results: **19/19** core local-first tests pass; related outbox/group contracts pass; typecheck clean.

## 6. Not in this release

- Nearby Connections transport
- Offline delivery of other members' live GPS
- Automatic conflict resolution that chooses a response
- Migrating every existing table to local-first
