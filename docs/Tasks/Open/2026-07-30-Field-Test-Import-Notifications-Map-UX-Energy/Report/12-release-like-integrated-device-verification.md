# Ticket 12 — Release-like integrated verification report

**Date:** 2026-07-30  
**Build / environment:** implementer workstation (Windows); no physical iOS/Android device in this run  
**Code pack:** Field Test — Import, Notifications, Map UX & Energy  
**Process:** `/implement` effort 1; **4** review→fix rounds; final **0** open issues  

## Scope

Software acceptance criteria for tickets 01–11 + focused Jest suites.  
**Not** OTA, store submit, or production migration deploy.

## Matrix

| Area | Software / unit | Device gate |
|---|---|---|
| 01 KML/KMZ import pipeline | **Pass** — `kmlLoad.test.ts`, sheet stages | iOS/Android picker **Unverified** |
| 02 Notification policy | **Pass** — policy matrix + dual-path `eventId` + Realtime fallback kept | Dual-account APNs/FCM **Unverified** |
| 03 Arrival notify | **Pass** — first-insert trigger migration; client radius unchanged (no 30m override) | Field arrival **Unverified** |
| 04 Standalone reorder card | **Pass** — MapScreen framed card + contract | UI on device **Unverified** |
| 05 Share/search animation | **Pass** — Amicro Promise settle + contracts | System share sheet **Unverified** |
| 06 Long-press camera | **Pass** — `mapCameraFlow.test.ts` + MapScreen wiring | MapKit / Google Maps visual **Unverified** |
| 07 Emoji/color | **Pass** — validator + migration + reorder picker + **map markers** | Cross-device sync **Unverified** (migration not deployed) |
| 08 Thermal baseline | **Pass** — baseline doc + entry conditions | Physical thermal **Unverified** |
| 09 Token idempotency | **Pass** — gate + durable permanent stop + throw recording | Token re-register field retest **Unverified** |
| 10 Outbox flush | **Pass** — single-flight tests + production helper wired | p95 remeasure **Unverified** |
| 11 FG energy | **No-op** (documented) | n/a |

## Focused tests (implementer)

Run under `hither_app/apps/mobile`:

```
npx jest --config jest.config.js \
  src/__tests__/kmlLoad.test.ts \
  src/__tests__/notificationDeliveryPolicy.test.ts \
  src/__tests__/destinationEmojiColor.test.ts \
  src/__tests__/destinationMarkerChrome.test.ts \
  src/__tests__/mapCameraFlow.test.ts \
  src/__tests__/liveActivityTokenGate.test.ts \
  src/__tests__/locationOutboxFlush.test.ts \
  src/__tests__/pushEntityIdDualPathMigration.test.ts \
  src/__tests__/amicroUiContracts.test.ts \
  src/__tests__/coordinateDestination.test.ts \
  src/__tests__/locationOutbox.test.ts \
  src/__tests__/activityTokenService.test.ts \
  src/__tests__/kml.test.ts --no-coverage
```

Results:

- Initial implement pass: **11 suites / 98 tests passed**  
- After review fix rounds: focused suites reported **130+** tests green (includes dual-path migration + marker chrome contracts)  
- `npx tsc --noEmit`: **exit 0**

Re-run before release if the tree has drifted.

## Review residual closed before approve

| ID | Topic | Closed by |
|----|--------|-----------|
| BUG-1 | Map markers ignore emoji/color | `destinationMarkerChrome` + GroupMap |
| BUG-2/3 | Dual-path / policy wiring | aligned eventId + process-seen |
| BUG-4 | Token throws skip gate | catch → `recordResult` |
| BUG-5 | Leader role on memberships fail | `isLeaderRef` fallback |
| BUG-6 | Custom command category dropped | restore SQL role lookup |
| BUG-7 | Straggler `reporter_id` | use `sender_id` |
| SUG/NIT | LA chrome, durable conflict, single-flight helper | fixed |

## Explicit non-claims

- Simulator / unit / development build results are **not** production APNs/FCM proof.  
- Unit tests are **not** thermal or native map camera visual proof.  
- Migrations are authored only — **not** applied to production.  
- Ticket 11 no-op is **not** a claim that phones no longer get warm.

## Ticket 11

**No-op** — see `11-evidence-led-foreground-energy-no-op.md`.

## Next for device owners

1. Apply migrations in non-prod / prod per release queue.  
2. Walk this matrix on release-like iOS + Android builds.  
3. Attach thermal / diagnostic bundles and mark Unverified rows Pass/Fail with SHA.  
