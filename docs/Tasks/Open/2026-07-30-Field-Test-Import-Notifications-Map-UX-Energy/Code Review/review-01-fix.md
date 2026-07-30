# Code Review 01 — Fix report

**Date:** 2026-07-30  
**Source:** `Code Review/review-01.md`  
**Status:** Software findings addressed. Device/thermal gates remain open as documented.

## Findings disposition

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| S1 | P2 | KML native I/O in UI component | **Fixed** — `native/kmlIo.ts` + sheet uses `kmlIo.createDefaultKmlLoadIo()` only |
| S2 | P2 | No phase commits | **Open (process)** — code changes uncommitted; phase commits remain owner action |
| S3 | P2 | Duplicated notification identity | **Fixed** — production `send-push/eventId.ts`; shared `eventId.vectors.json`; Deno `eventId_test.ts` + Jest mobile parity (no copied Deno algorithm in Jest) |
| S4 | P3 | Redundant `20260730020000` migration | **Fixed** — file deleted; logic complete in `20260730010000` |
| Spec1 | P1 | Low-accuracy OR-bypass on auto-arrive | **Fixed** — `arrivedNow = next.status === 'arrived'` only |
| Spec2 | P1 | No Realtime arrival local notif | **Fixed** — `destination_arrivals` INSERT → leader `member_arrival` |
| Spec3 | P1 | Emoji accepts ordinary non-ASCII text | **Fixed** — app `Extended_Pictographic` validator + SQL `itinerary_items_emoji_shape` rejects pure letter/CJK runs (full emoji property remains app trust boundary) |
| Spec4 | P1 | KMZ uncompressed oversize | **Fixed** — `utf8ByteLength` check after unzip before parse |
| Spec5 | P1 | Thermal / release-like gates open | **Documented open** — still Unverified; no false claim |
| Spec6 | P2 | Search anim resets on rAF×2 | **Fixed** — Amicro waits `OverlaySheet` `onOpenComplete` |
| Spec7 | P2 | LA ignores destinationEmoji | **Fixed (software / source contract)** — JS state, both Swift `ContentState` decode, widget `displayTitle` prefixes emoji; device native build still Unverified |

## Key code touchpoints

- `apps/mobile/src/native/kmlIo.ts` (new)
- `apps/mobile/src/components/KmlImportSheet.tsx`
- `apps/mobile/src/utils/kmlLoad.ts`
- `apps/mobile/src/utils/destinationEmojiColor.ts`
- `apps/mobile/src/screens/MapScreen.tsx` (arrival + search open + LA destinationEmoji)
- `apps/mobile/src/components/DestinationSearch.tsx`
- `apps/mobile/src/state/useGroupNotifications.ts`
- `apps/mobile/src/native/liveActivity.ts`
- `apps/mobile/modules/hither-live-activity/ios/HitherGroupAttributes.swift`
- `apps/mobile/targets/live-activity/HitherGroupAttributes.swift`
- `apps/mobile/targets/live-activity/HitherLiveActivity.swift`
- `supabase/functions/send-push/eventId.ts` (new)
- `supabase/functions/send-push/eventId.vectors.json` (new)
- `supabase/functions/send-push/eventId_test.ts` (new)
- `supabase/functions/send-push/index.ts` (imports production eventId)
- `supabase/migrations/20260730000000_destination_emoji_color_arrival_notify.sql` (emoji shape CHECK)
- Deleted: `supabase/migrations/20260730020000_restore_custom_command_and_straggler_entity.sql`

## Verification

### Mobile (Jest)

```
npx jest --runInBand --config jest.config.js \
  src/__tests__/notificationEventIdParity.test.ts \
  src/__tests__/destinationEmojiColor.test.ts \
  src/__tests__/destinationEmojiMigrationContract.test.ts \
  src/__tests__/liveActivityContract.test.ts \
  src/__tests__/kmlLoad.test.ts \
  src/__tests__/arrivalFeedbackContract.test.ts \
  src/__tests__/amicroUiContracts.test.ts \
  src/__tests__/groupNotificationsLeaderFallback.test.ts \
  src/__tests__/coordinateDestination.test.ts \
  src/__tests__/pushEntityIdDualPathMigration.test.ts
```

### Edge (Deno)

```
cd hither_app/supabase/functions/send-push
deno test eventId_test.ts
```

> **Note:** This workstation may not have `deno` on PATH. The production module
> and `eventId_test.ts` are in tree; run Deno tests in CI or a machine with Deno.
> Mobile Jest still asserts the module is imported by `index.ts` and that the
> Deno test file targets `./eventId.ts` + shared vectors (no inlined copy).

### Typecheck

```
npx tsc --noEmit
```

## Still open (not code)

1. **Phase commits** (CLAUDE.md) — commit after phases before merge.  
2. **Ticket 08/12 device gates** — picker, APNs/FCM, thermal, map camera visual, outbox p95, **native Live Activity smoke on device**.  
3. **Migrations not applied** to a live database in this run.

## Explicit non-claims

- Heating is not declared “solved.”  
- Dual-path APNs presentation is unit-contracted only until device matrix.  
- Live Activity emoji is source-contracted; needs a native build smoke check.  
- SQL emoji CHECK is best-effort letter/CJK rejection, not full Unicode emoji property.
