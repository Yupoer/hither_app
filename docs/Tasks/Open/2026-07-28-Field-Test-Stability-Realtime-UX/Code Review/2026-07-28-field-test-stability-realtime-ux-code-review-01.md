# Field Test Stability / Realtime UX — Code Review 01

**Date:** 2026-07-28  
**Fixed point:** `e4e6644564bc8dbd6b8b5b2c28fce1b59375c86f`  
**Review scope:** Working tree relative to the fixed point, limited to this task's mobile implementation and supporting reports.

## Standards

### [P1] Avatar clipping regression breaks the test gate

**File:** `apps/mobile/src/screens/MyTeamsScreen.tsx:313`

The rewrite removed `overflow: 'hidden'` from the circular `avatarBubble` shell. Large emoji content can escape the circle, and the existing Dynamic Type contract now fails.

This violates:

- `CLAUDE.md:16`: completion requires `npm test` and `npm run typecheck` to pass.
- `CLAUDE.md:20`: the UI baseline must not be structurally changed without approval.

**Evidence:** `dynamicTypeContract.test.ts` fails its avatar-shell clipping assertion.

### [P2] Platform-native branching was added to a UI component

**File:** `apps/mobile/src/components/GroupMap.tsx:760`

The new transit props are selected through `Platform.OS` inside `GroupMap`. `CLAUDE.md:9` requires native capabilities and platform selection to be contained under `apps/mobile/src/native/`, with Expo Go fallback handled at that boundary.

Move the provider-specific transit configuration behind the existing native maps boundary instead of adding another UI-level platform branch.

### [P3] Unused target-pulse abstraction

**File:** `apps/mobile/src/utils/targetMarkerPulse.ts:12`

`TargetPulsePhase` has no caller. The implementation already uses a boolean and `Animated.Value`, so this exported interface is speculative generality and can be removed until a real consumer exists.

## Spec

### [P1] Android transit bridge targets an unavailable SDK API

**Files:**

- `apps/mobile/patches/react-native-maps+1.27.2.patch:81`
- `apps/mobile/node_modules/react-native-maps/android/build.gradle:101`

The patch calls `GoogleMap.setTransitEnabled()`, but `react-native-maps@1.27.2` defaults to `play-services-maps:19.1.0`, and the repository does not override `googlePlayServicesMapsVersion`.

Google introduced `setTransitEnabled()` in Maps SDK for Android `20.0.0`. Catching `Throwable` does not help because compilation fails before runtime when the method is absent.

**Impact:** The next Android native build is expected to fail.

**Required fix:** Pin Maps SDK `20.0.0` or newer through the supported Expo/Gradle configuration, then run a native Android build. Confirm the resulting minimum Android SDK requirement is acceptable.

**Reference:** [Google Maps SDK for Android release notes](https://developers.google.com/maps/documentation/android-sdk/release-notes)

### [P1] Force Refresh swallows the initiator's upload failure

**Files:**

- `apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts:167`
- `apps/mobile/src/screens/MapScreen.tsx:1924`

Spec lines `101–103` require Force Refresh to:

1. Obtain the initiator's one-shot location.
2. Upload it immediately.
3. Only then fan out refresh requests to peers.
4. Preserve failure feedback.

`refreshDeviceLocation()` catches and discards `enqueueUpload(..., { immediate: true })` failures, then returns coordinates as if the upload succeeded. `refreshAllLocations()` subsequently performs peer fan-out and gives no initiator-upload failure feedback.

**Impact:** The local blue dot moves, but the backend self timestamp/location can remain stale while the action appears successful.

**Required fix:** Let the immediate enqueue/flush error propagate for manual Force Refresh, stop peer fan-out, and show the existing failure alert.

### [P1] Required release-like device verification is incomplete

**Files:**

- `Spec/field-test-stability-realtime-ux-spec-2026-07-28.md:144`
- `Report/11-release-device-field-verification.md:3`

The Spec requires release-like iOS and Android sessions covering Podcast playback, foreground/background transitions, high-accuracy changes, map use, Live Activity, Force Refresh, thermal state, CPU, memory, frame stalls, audio interruption, network counts, and watchdog events.

The report states that no physical devices were available. Build identity, measurements, and Device QA sign-off remain empty.

**Impact:** Native OTA/team-entry termination, Android transit compilation/runtime, Live Activity output, heat, and audio behavior are unverified. The task cannot be considered release-complete.

### [P2] A permanent five-second polling loop re-renders MapScreen

**File:** `apps/mobile/src/screens/MapScreen.tsx:1631`

Spec line `69` explicitly says not to create another watcher or polling loop. Once any GPS sample has been accepted, `progressClockMs` updates every five seconds, even when there is no active journey or visible personal-progress surface.

**Impact:** The entire map screen repeatedly renders during stationary use, adding work to the heat/jank-sensitive path this task is meant to reduce.

**Required fix:** Use a single timeout for the stale threshold, or scope the timer to an active visible progress surface.

### [P2] A selected destination keeps pulsing after navigation ends

**Files:**

- `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts:181`
- `apps/mobile/src/screens/MapScreen.tsx:3855`

When navigation is paused, `activePoint` falls back to `selectedDestination`. `MapScreen` passes `activePoint.id` as `activeDestinationId`, so the selected marker continues pulsing despite there being no active navigation target.

This violates Spec lines `94–97`, which require animation only for the active target and cleanup when navigation ends.

**Required fix:** Pass an active marker ID only while `journeyActive` is true, using `navTarget.id`.

### [P2] Personal-progress freshness is calculated but never shown

**Files:**

- `apps/mobile/src/utils/personalProgress.ts:168`
- `apps/mobile/src/screens/MapScreen.tsx:1692`

The shared model calculates `live`, `stale`, and `unknown`, but only distance, ETA, progress, and arrival values are sent to the gathering card, My Progress, and Live Activity.

This does not satisfy Spec line `74`, which requires stale/unknown state to be surfaced while retaining the last valid value.

**Impact:** After GPS silence, old values remain visually indistinguishable from current data.

### [P2] My Teams redesign is outside the requested scope

**File:** `apps/mobile/src/screens/MyTeamsScreen.tsx`

The task required an idempotent post-OTA team-entry path. The diff also restructures and restyles the entire My Teams screen and removes the expanded large invite-code row.

This conflicts with:

- Spec line `155`: unrelated team-management redesign is out of scope.
- `CLAUDE.md:20`: do not substantially change the UI baseline without approval.

The redesign also caused the avatar clipping test regression described under Standards.

## Verification

### Jest

Command:

```powershell
npm.cmd test -- --runInBand
```

Result:

- Test suites: **124 passed, 1 failed, 125 total**
- Tests: **1029 passed, 1 failed, 1030 total**
- Failure: `src/__tests__/dynamicTypeContract.test.ts`

### TypeScript

Command:

```powershell
npm.cmd run typecheck
```

Result: failed at `src/__tests__/history.test.ts:122` because the fixture omits `DestinationArrival.groupId`, `source`, and `markedBy`.

That file is unchanged relative to the fixed point, so this is not counted as a finding introduced by this diff. The current checkout nevertheless does not satisfy the repository completion gate.

### Native/device verification

Not performed:

- Android native transit build
- iOS/Android release-like device sessions
- Podcast/audio regression test
- Thermal, CPU, memory, frame-stall, network, or watchdog measurement
- Live Activity target verification

## Summary

- **Standards:** 3 findings. Worst issue: the My Teams rewrite breaks the existing test gate.
- **Spec:** 7 findings. Worst issues: Android native compilation risk and Force Refresh reporting success after self-upload failure.
- **Disposition:** Do not mark the task release-complete until P1 findings are fixed and release-like device verification is signed off.
