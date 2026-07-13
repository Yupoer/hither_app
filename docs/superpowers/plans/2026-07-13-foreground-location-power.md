# Foreground Location Power Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use one foreground-only native location stream, default it to a low-power profile, add manual group refresh, and display member location freshness.

**Architecture:** `expo-location` remains the single native location provider and is lifecycle-controlled by `useDeviceLocation`. `MapScreen` owns refresh UI and relative-time presentation; pure profile/time helpers keep behavior testable without a device.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript, Jest/ts-jest, expo-location, react-native-maps.

## Global Constraints

- No new dependencies.
- Default profile is Balanced / 50 m / 30 s; high accuracy is High / 10 m / 5 s.
- Location watching runs only while AppState is active.
- Manual refresh uploads this device, then reloads cached group locations; it does not wake peer devices.
- Freshness becomes a fixed stale warning at 24 hours.

---

### Task 1: Testable location profiles and foreground lifecycle

**Files:**
- Modify: `apps/mobile/src/native/location.ts`
- Modify: `apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts`
- Test: `apps/mobile/src/__tests__/locationPolicy.test.ts`

**Interfaces:**
- Produces: `locationOptions(highAccuracy: boolean): Location.LocationOptions`
- Produces: `useDeviceLocation({ groupId, highAccuracy })` with `refreshDeviceLocation(): Promise<Coordinates | null>`

- [ ] **Step 1: Write failing profile tests**

```ts
expect(locationOptions(false)).toMatchObject({ accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 30_000 });
expect(locationOptions(true)).toMatchObject({ accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5_000 });
```

- [ ] **Step 2: Run `npm test -- --runInBand src/__tests__/locationPolicy.test.ts` and verify the missing export fails**
- [ ] **Step 3: Implement `locationOptions`, use it for both watch and one-shot refresh, and make the hook subscribe only while AppState is active**
- [ ] **Step 4: Re-run the focused test and verify PASS**

### Task 2: High-accuracy preference semantics

**Files:**
- Modify: `apps/mobile/src/state/PreferencesContext.tsx`
- Modify: `apps/mobile/src/screens/MapScreen/components/SettingsOverlay.tsx`
- Modify: `apps/mobile/src/i18n/index.ts`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`

**Interfaces:**
- Produces: `highAccuracy: boolean`, `setHighAccuracy(on: boolean): void`

- [ ] **Step 1: Rename the preference contract and storage key to `pref.highAccuracy`, defaulting to false**
- [ ] **Step 2: Change the settings switch copy to 高精準模式 / High accuracy and make ON mean higher accuracy**
- [ ] **Step 3: Pass `highAccuracy` into `useDeviceLocation` and run typecheck**

### Task 3: Single map tracker and manual refresh in member heading

**Files:**
- Modify: `apps/mobile/src/components/GroupMap.tsx`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`

**Interfaces:**
- Consumes: `refreshDeviceLocation(): Promise<Coordinates | null>` and `refresh(): Promise<void>`
- Produces: `refreshAllLocations(): Promise<void>`

- [ ] **Step 1: Remove `showsUserLocation` and render the current member marker instead of filtering it out**
- [ ] **Step 2: Make group-state refresh awaitable and implement refresh order: one-shot own fix/upload, then group reload**
- [ ] **Step 3: Add a refresh control to the right side of the member heading with spinner, disabled state, accessibility label, and existing failure alert**
- [ ] **Step 4: Run component Jest tests and typecheck**

### Task 4: Member location freshness

**Files:**
- Create: `apps/mobile/src/utils/locationFreshness.ts`
- Test: `apps/mobile/src/__tests__/locationFreshness.test.ts`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/i18n/index.ts`

**Interfaces:**
- Produces: `locationFreshness(lastUpdated: string | undefined, nowMs: number): { key: TranslationKey; value?: number }`

- [ ] **Step 1: Write failing tests for missing, just-now, minute, hour, and 24-hour stale boundaries**
- [ ] **Step 2: Run the focused test and verify RED**
- [ ] **Step 3: Implement the pure bucket function and add translated copy**
- [ ] **Step 4: Include `lastUpdated` in the flock view model and render freshness beneath member status, driven by the shared 30-second tick**
- [ ] **Step 5: Run focused tests and verify GREEN**

### Task 5: Full verification

**Files:**
- Verify all modified files

- [ ] **Step 1: Run `npm test -- --runInBand` and require zero failures**
- [ ] **Step 2: Run `npm run typecheck` and require exit 0**
- [ ] **Step 3: Run `npm run lint` and require exit 0 or report pre-existing findings separately**
- [ ] **Step 4: Inspect `git diff --check` and `git diff` for scope and accidental changes**
