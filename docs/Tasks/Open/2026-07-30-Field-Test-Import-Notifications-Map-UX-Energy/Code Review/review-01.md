# Field Test — Import, Notifications, Map UX & Energy — Code Review 01

**Date:** 2026-07-30  
**Fixed point:** `ebeeb5487faf179ff752bb76226fa22a55b35d4d`  
**Reviewed state:** current working tree; `HEAD` equals the fixed point and the implementation is uncommitted  
**Scope:** task-related changes under `apps/mobile/src`, `supabase/functions/send-push`, the three `20260730*` migrations, and this task folder. Unrelated documentation moves were excluded.

## Standards

### [P2] Hard violation — KML native I/O bypasses the native boundary

`apps/mobile/src/components/KmlImportSheet.tsx:1,26-61` directly imports `Platform` and `expo-file-system`, then performs cache materialization, file reads, and Base64 decoding inside a UI component. `CLAUDE.md:9` requires native capabilities to enter through `apps/mobile/src/native/` and forbids UI components from branching on `Platform.OS`.

Move `buildDefaultIo` behind a typed native facade; keep the sheet responsible only for picker state and rendering.

### [P2] Hard violation — completed phases have no phase commits

`HEAD` still equals the fixed point while the reviewed scope contains 22 modified tracked files plus new untracked implementation, test, and migration files. `CLAUDE.md:14` requires a commit after each completed phase.

This prevents commit-graph review of the claimed implementation/review phases and makes unrelated working-tree changes easier to mix into delivery.

### [P2] Judgement call — Duplicated Code / Shotgun Surgery / Repeated Switches in notification identity

The category mapping and event identity algorithm are manually duplicated in:

- `apps/mobile/src/utils/notificationDeliveryPolicy.ts:252-331`
- `supabase/functions/send-push/index.ts:103-148`
- `apps/mobile/src/state/useGroupNotifications.ts:42-57,147-158`

The “keep in lockstep” comments identify the maintenance hazard: a new category must be updated in three places or Realtime/push dedup silently diverges. Because mobile and Deno cannot trivially import one runtime module, the minimum fix is a parity contract that executes equivalent input vectors against both implementations.

### [P3] Judgement call — Duplicated Code / Speculative Generality in follow-up migration

`supabase/migrations/20260730020000_restore_custom_command_and_straggler_entity.sql:5-65` repeats the `on_command_insert` and `on_group_alert_insert` definitions already introduced by `20260730010000_push_entity_id_dual_path.sql:8-84`, without a behavioral difference.

Both migrations are currently untracked, so remove the redundant third migration before deployment. If it repairs a real ordering failure, document and test the exact differing prior state instead of applying the same definition twice.

## Spec

### [P1] Low-accuracy single fixes can still trigger automatic arrival

Ticket 03 line 11 requires low-accuracy or drifting samples to follow the existing consecutive-fix rules and not cause arrival from one untrusted sample.

`apps/mobile/src/screens/MapScreen.tsx:1277-1293` computes:

```ts
const insideRadius = hasArrived(straightM, localArrivalRadiusM);
const next = reduceArrival(...accuracyM...);
const arrivedNow = insideRadius || next.status === 'arrived';
```

The direct distance branch bypasses the accuracy-aware reducer. A first sample at 10 m with 500 m accuracy and a 30 m radius sets `arrivedNow` to true. Remove the direct OR path and let the reducer be authoritative.

### [P1] Member arrival has no Realtime local-notification fallback

The Spec lines 33 and 85-90 require one notification policy across local, Realtime fallback, and push. Ticket 03 lines 12-13 require the effective leader to receive one member-arrival notification.

`apps/mobile/src/state/useGroupNotifications.ts:207-335` has no `destination_arrivals` subscription. The existing listener at `apps/mobile/src/screens/MapScreen.tsx:657-659` only schedules a workflow reload. When APNs/FCM is unavailable, the leader receives updated data but no local arrival notification.

Add an INSERT-only arrival handler to the notification path, using the same stable identity as the push payload.

### [P1] Emoji validation accepts ordinary non-ASCII text

Ticket 07 line 14 requires ordinary text to be rejected at the trust boundary.

`apps/mobile/src/utils/destinationEmojiColor.ts:73-93` returns true for any code point greater than `0x7f`, so a single `中` or `é` is accepted as an Emoji. The database constraint in `supabase/migrations/20260730000000_destination_emoji_color_arrival_notify.sql:25-32` only limits length, so another client can persist the same invalid values.

Use an Emoji Unicode-property check for the single grapheme, with explicit handling for variation selectors, keycaps, flags, and ZWJ sequences; add CJK and accented-letter negative cases.

### [P1] KMZ decompression bypasses the declared 8 MiB safety limit

Ticket 01 lines 12-14 and Spec line 80 require oversized content to be rejected. `apps/mobile/src/utils/kmlLoad.ts:10-11` describes `KML_MAX_BYTES` as the maximum uncompressed payload.

The implementation checks only the compressed `ArrayBuffer` at lines 217-224. After `kmlFile.async('string')` at line 257, it parses the full XML without checking its decoded byte size. A small, highly compressed KMZ can therefore expand far beyond 8 MiB and cause memory pressure or a long JS-thread stall.

Check the extracted KML byte length before parsing and return the existing `oversize` error.

### [P1] Thermal and release-like acceptance gates remain open

Spec line 36 requires a controlled same-device/same-build baseline and release-like retest. The task reports explicitly state:

- `Report/08-stationary-thermal-performance-baseline.md:3,12-21,78-80`: device, build SHA, thermal state, CPU/frame ownership are unverified.
- `Report/12-release-like-integrated-device-verification.md:4,17-26,70-85`: no physical device run; picker, APNs/FCM, field arrival, UI/map camera, thermal, and outbox p95 gates are unverified.

The evidence-led no-op for speculative foreground refactors is reasonable, but it does not establish that the reported heating is solved or that the full task is ready for approval. Keep Ticket 08/12 open until release-like iOS and Android evidence is attached.

### [P2] Search animation resets before the search sheet finishes opening

Ticket 05 line 16 requires `animation complete → page open complete → reset`.

`apps/mobile/src/screens/MapScreen.tsx:3615-3621` waits only two `requestAnimationFrame` callbacks after setting `searchVisible`, about 32 ms at 60 Hz. `apps/mobile/src/components/OverlaySheet.tsx:86-94` opens over 320 ms and already exposes `onOpenComplete`.

Resolve the button’s Promise from the sheet’s `onOpenComplete`; do not approximate page completion with frame count.

### [P2] Destination Emoji is not consumed by the native Live Activity

Ticket 07 line 18 requires map and Live Activity display coverage.

The TypeScript state adds `destinationEmoji` at `apps/mobile/src/native/liveActivity.ts:86-90`, but the comment permits native code to ignore it. The iOS native state decoders at `apps/mobile/targets/live-activity/HitherGroupAttributes.swift:71-84` and `apps/mobile/modules/hither-live-activity/ios/HitherGroupAttributes.swift:71-84` do not decode or render this field.

Add the field to the native activity attributes/content state and render it with the same fallback semantics. Until verified on a native build, do not mark this acceptance criterion complete.

## Verification

- `npm.cmd test -- --runInBand`: **135 suites, 1,144 tests passed**
- `npm.cmd run typecheck`: **passed, 0 TypeScript errors**
- Physical iOS/Android, system document picker, APNs/FCM, native Live Activity, map camera visuals, cross-device sync, thermal state, and outbox p95: **Unverified**
- Migrations were reviewed as files only and were **not applied** to a database.

## Summary

Standards: **4 findings**, worst **P2** (native boundary and missing phase commits). Spec: **7 findings**, worst **P1** (arrival correctness/delivery, input safety, and open device/thermal gates).
