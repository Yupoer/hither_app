# Implementation Summary — Field Test: Import / Notifications / Map UX / Energy

**Date:** 2026-07-30  
**Task pack:** `docs/Tasks/Open/2026-07-30-Field-Test-Import-Notifications-Map-UX-Energy`  
**Spec:** `Spec/field-test-import-notifications-map-ux-energy-spec-2026-07-30.md`  
**Code baseline (spec):** `ebeeb5487faf179ff752bb76226fa22a55b35d4d`  
**Process:** `/implement` (effort 1) — implement → review → fix until 0 open issues  
**Review rounds:** 4  
**Review issues fixed:** 12 total (7 bug · 4 suggestion · 1 nit)  
**IMPL_ID:** `47b05bd0`

## Status

| Layer | Status |
|-------|--------|
| Software AC (tickets 01–10 + 12 unit matrix) | **Complete** |
| Ticket 11 FG energy | **No-op** (evidence-gated; see sibling report) |
| Device / APNs / thermal / store | **Unverified** (not invented) |
| OTA / production migration / store submit | **Out of scope** this pack |

Sibling reports in this folder:

- `08-stationary-thermal-performance-baseline.md`
- `11-evidence-led-foreground-energy-no-op.md`
- `12-release-like-integrated-device-verification.md`

---

## Scope

Five field-test problem areas, 12 tickets:

1. Cross-provider KML/KMZ import  
2. Unified notification delivery policy (+ dual-path event identity)  
3. Distance-driven arrival notifications (first save only)  
4. Standalone reorder action card  
5. Share / search animation lifecycle  
6. Long-press gathering-point camera flow  
7. Per-destination emoji + color (sync + map projection)  
8. Stationary thermal baseline (docs + entry conditions)  
9. Live Activity token idempotency  
10. Location outbox single-flight flush  
11. Evidence-led FG energy (no-op)  
12. Release-like integrated verification report  

---

## Files changed / created

### New pure modules (`apps/mobile/src/utils/`)

| File | Purpose |
|------|---------|
| `kmlLoad.ts` | Stage-aware KML/KMZ load: materialize → unzip → parse → preview |
| `notificationDeliveryPolicy.ts` | Recipient matrix, dual-path `shouldDeliverOnce`, aligned `eventId` builders, process-seen mark |
| `destinationEmojiColor.ts` | 26 presets + single-grapheme emoji / palette color validators |
| `destinationMarkerChrome.ts` | Map marker color/emoji resolution + fallbacks |
| `mapCameraFlow.ts` | Long-press neighborhood zoom + success self+dest fit helpers |
| `liveActivityTokenGate.ts` | Idempotent register + permanent conflict stop + durable TTL + backoff |
| `locationOutboxFlush.ts` | Pure single-flight flush helper |

### New migrations (`supabase/migrations/`)

| File | Purpose |
|------|---------|
| `20260730000000_destination_emoji_color_arrival_notify.sql` | Nullable `emoji` / `marker_color` on itinerary items; arrival INSERT → leader notify |
| `20260730010000_push_entity_id_dual_path.sql` | Push `entity_id` dual-path + custom command category + straggler entity_id |

> Note: redundant follow-up migration `20260730020000_*` was removed per Code Review 01 (P3); logic lives only in `20260730010000`.

### New / focused tests (`apps/mobile/src/__tests__/`)

- `kmlLoad.test.ts`
- `notificationDeliveryPolicy.test.ts`
- `destinationEmojiColor.test.ts`
- `destinationMarkerChrome.test.ts`
- `mapCameraFlow.test.ts`
- `liveActivityTokenGate.test.ts`
- `locationOutboxFlush.test.ts`
- `pushEntityIdDualPathMigration.test.ts`
- Updated: `amicroUiContracts.test.ts`, `coordinateDestination.test.ts`, `locationOutbox.test.ts`, `activityTokenService.test.ts`

### Modified (wiring)

| Path | Purpose |
|------|---------|
| `components/KmlImportSheet.tsx` | Pipeline + staged errors + i18n |
| `components/AmicroButton.tsx` | Await external Promise before reset |
| `components/DestinationReorderList.tsx` | Per-stop emoji/color picker (26 + custom) |
| `components/GroupMap.tsx` | Destination emoji/color markers |
| `screens/MapScreen.tsx` | Reorder card, share/search lifecycle, long-press camera, start confirm, emoji handler, LA chrome |
| `screens/MapScreen/hooks/useJourneyNavigation.ts` | Operator start confirm callback |
| `state/locationOutbox.ts` | Single-flight via pure helper |
| `state/useLiveActivity.ts` | Token gate + destination emoji/color on LA state |
| `state/useGroupNotifications.ts` | Policy matrix, aligned event IDs, leader fallback, FG push mark, straggler `sender_id` |
| `api/services/DestinationService.ts` | map + update emoji/color |
| `api/services/GroupService.ts` | Select emoji/marker_color |
| `api/client.ts` | Export update API |
| `types/index.ts` | Destination emoji/markerColor fields |
| `i18n/index.ts` | KML errors, emoji UI, operator notif strings |
| `supabase/functions/send-push/recipients.ts` | Leader-only arrival + request_start |
| `supabase/functions/send-push/index.ts` | `eventId` on alert data; special recipient path |

### Docs (this pack)

- `Report/implementation-summary.md` (this file)
- `Report/08-stationary-thermal-performance-baseline.md`
- `Report/11-evidence-led-foreground-energy-no-op.md`
- `Report/12-release-like-integrated-device-verification.md`

---

## Per-ticket outcomes

### 01 — Cross-provider KML/KMZ import — **Done (software)**

- `loadKmlKmzFromAsset` stages: pick → materializeReadable → unzipKmz → parseKml → preview.  
- Provider/content URIs copied to cache before read (no bare `fetch` of provider URI as sole path).  
- Cancel ≠ error; empty / bad zip / no KML / no points / invalid coords / oversize differentiated.  
- Diagnostics: stage/code/size only (no path/body).  
- Device picker (iCloud / Drive / Files): **Unverified**.

### 02 — Unified notification policy — **Done (software)**

- Pure `resolveNotificationRecipients` + delivery kinds (operator local / sync / leader-only).  
- Operator start: client local confirm after successful session start (does not relax Realtime sender exclusion).  
- Realtime fallback **kept** even when push token exists.  
- Dual-path: shared `buildAlignedNotificationEventId` / send-push `eventIdFromPayload`; FG push marks process-seen so first channel wins.  
- Dual-account APNs/FCM matrix: **Unverified**.

### 03 — Distance-driven arrival notifications — **Done (software)**

- Client keeps user arrival radius + accuracy-aware machine (no fixed 30 m override).  
- SQL: `AFTER INSERT` on `destination_arrivals` notifies leaders; re-insert / `ON CONFLICT DO NOTHING` stays silent.  
- Member local confirm still first-save only on client.  
- Field arrival dual-account: **Unverified**.

### 04 — Standalone reorder action card — **Done**

- 「調整集合點順序」pulled out of general `listGroup` into framed `reorderActionCard` (≥44 hit target, glass/spacing).  
- Other list rows (arrival manage, ops, import, history) order/behavior unchanged.

### 05 — Share / search animation lifecycle — **Done**

- Amicro: if `onAnimationComplete` returns a Promise, stay on complete frame until settle.  
- Share: await `Share.share` (complete/cancel/throw all clear busy).  
- Search: open sheet then rAF×2 then reset.  
- Reduced-motion keeps same sequencing.  
- System share visual: **Unverified**.

### 06 — Long-press camera flow — **Done (software)**

- Long-press: one neighborhood zoom (`PLACE_ZOOM` / `PLACE_ALTITUDE`).  
- Success + self: one fit self+dest; no self: single-point fallback.  
- Fail/cancel: no success fit. Search-pick path unchanged.  
- MapKit / Google Maps visual: **Unverified**.

### 07 — Destination emoji + color — **Done (software)**

- Nullable schema; trust-boundary validators; 26 presets + custom single grapheme.  
- Wired through DestinationService / GroupService / reorder UI.  
- Map markers use `destinationMarkerChrome` (not day-color-only).  
- Live Activity gets destination emoji + palette accent when set.  
- Cross-device with production migration applied: **Unverified**.

### 08 — Thermal baseline — **Done (docs)**

- Protocol, Spec diagnostic import, hotspot ranking, entry conditions for 09–11.  
- Physical thermal: **Unverified**.  
- See `08-stationary-thermal-performance-baseline.md`.

### 09 — Live Activity token idempotency — **Done (software)**

- Same `(user, device, token, enabled)` skips re-upsert.  
- Permanent stop on unique/foreign conflict; durable key (AsyncStorage, 24h TTL).  
- Throws → `recordResult(..., 'unknown_error')` bounded backoff on both register paths.  
- Field re-measure of `token_unique_unresolved`: **Unverified**.

### 10 — Location outbox flush — **Done (software)**

- Production flush uses `createSingleFlightFlush`.  
- Serial queue, capped backoff, permanent reject discard retained.  
- Passive cadence / force immediate paths in `useDeviceLocation` unchanged.  
- Outbox p95 remeasure on device: **Unverified**.

### 11 — FG energy — **No-op**

- 08 ranks token + outbox, not FG UI/location/render.  
- See `11-evidence-led-foreground-energy-no-op.md`.

### 12 — Integrated verification — **Report**

- See `12-release-like-integrated-device-verification.md`.

---

## Design decisions

1. Prefer pure testable helpers over growing `MapScreen` further.  
2. Operator start confirm is **client-only** after successful start — do not relax all sender-exclusion rules.  
3. Arrival remote notify attaches to **INSERT only** so retries/replays stay silent.  
4. Dual-path identity uses shared field tuples (`type|status|group|entity|destination|sender`) on client and Edge Function.  
5. Token permanent conflicts gated on client (process + durable); server reclaim path unchanged.  
6. Ticket 11 strictly evidence-gated → no speculative memoization.  
7. Migrations authored only — **not** deployed by this implement run.

---

## Review loop (summary)

| Round | Open issues | Highlights |
|-------|-------------|------------|
| 1 | 7 (4 bug · 2 sug · 1 nit) | Map markers missing emoji/color; dual-path dedup wrong; policy not wired; token throws skip gate |
| 2 | 2 | Leader role fallback on memberships error; push `eventId` alignment |
| 3 | 2 | Migration dropped `custom` command category; straggler entity_id |
| 4 | 1 | Straggler Realtime used non-existent `reporter_id` → `sender_id` |
| Final | **0** | Approved |

### Notable fixes after first implementation

- `GroupMap` + `destinationMarkerChrome` for Ticket 07 map AC  
- `shouldDeliverOnce` first-channel-wins across local/realtime/push  
- Realtime `fire()` uses policy + aligned event IDs; FG push marks seen  
- Token gate records throws; durable permanent conflict  
- Memberships select failure falls back to `isLeaderRef` for leader_only  
- Restored `custom` role-based push category in SQL  
- Straggler identity: `entity_id = alert.id`, client `sender_id`

---

## Verification

### Automated (implementer workstation)

```text
# under hither_app/apps/mobile
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

npx tsc --noEmit
```

- Initial implement pass: **98** tests / 11 suites pass; `tsc` exit 0  
- After review fixes: **130+** focused tests reported green; `tsc` exit 0  
- Re-run before ship if tree drifts

### Explicitly **Unverified** (do not claim)

- iOS/Android real document picker (local + cloud) for KML/KMZ  
- Dual-account notification matrix on real APNs/FCM (FG/BG/killed)  
- System share sheet settle visual  
- MapKit + Google Maps long-press camera visual  
- Cross-device emoji/color after production migration apply  
- Thermal / CPU / frame before-after under Ticket 08 protocol  
- Field re-measure of `token_unique_unresolved` and outbox p95  

### Out of scope (respected)

- KML parser rewrite / GIS expansion  
- Emoji glyph parity across OS  
- Full route overlay / notification settings redesign  
- End Navigation = Complete Gathering Point semantic change  
- Removing Realtime fallback  
- Blanket disable location / LA / Realtime for heat  
- OTA, store submit, production migration deploy  

---

## Follow-ups

1. Apply migrations in the appropriate environment when ready (release queue).  
2. Device matrix for Ticket 12 Unverified gates; attach traces under `docs/qa/` if collected.  
3. Re-open Ticket 11 only if a device baseline ranks a concrete FG owner.  
4. Commit / OTA / store only via normal release process — not this report.

---

## Checklist (Tasks README)

- [x] Report written with verification  
- [ ] Folder moved to `Completed/` (when owner accepts)  
- [ ] `RELEASE-QUEUE.md` row if users need OTA/build  
- [ ] OTA/build done → update RELEASE-QUEUE  
