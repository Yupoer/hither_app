# Navigation Sync, Native Arrival Slider, and Debug Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix gathering-point navigation ordering and arrival controls, replace the arrival-radius control with a native stepped slider, make database sync drain local logs, and add a development-only deterministic location route player.

**Architecture:** Reuse the existing itinerary reorder callback and Supabase Realtime subscription so navigation promotion follows the same optimistic and persisted path as manual drag reorder. Keep location simulation behind the existing `src/native/location.ts` boundary so every foreground location consumer receives the same samples without touching production or background-location policy. Reuse the current local diagnostic/performance queues and make their flush result observable instead of introducing another log store.

**Tech Stack:** React Native 0.81, Expo SDK 54, TypeScript, Supabase Realtime/Postgres, `expo-location`, `expo-haptics`, `@react-native-community/slider`, Jest/ts-jest, react-test-renderer.

## Global Constraints

- Do not change location cadence, accuracy, route recomputation, background tracking, or other battery-optimization policy in this work.
- Do not add a Supabase migration: itinerary updates and Realtime subscriptions already exist.
- The debug route must be available only when `__DEV__ === true`; production/TestFlight release builds must continue using real Core Location.
- The debug route is a foreground business-flow test aid. It does not claim to test iOS suspension, background execution, thermal behavior, or real battery use.
- Preserve the existing `agent/sync-db-upload-logs` commit and build on top of it. Do not reset, rewrite, or discard it.
- During Grok implementation, do not commit, push, merge, or publish OTA. Codex reviews first; release is a separate Grok 4.5 effort-low stage.
- User-facing copy must exist in Traditional Chinese and English.
- `@react-native-community/slider` changes `package.json` and the native binary. This requires EAS Build and is not OTA-eligible.
- Avoid new abstractions beyond one pure itinerary helper and one development-only location simulator module.

---

### Task 1: Make the existing sync button prove that all local logs were drained

**Files:**
- Modify: `apps/mobile/src/state/performance.ts`
- Modify: `apps/mobile/src/utils/uploadLocalLogs.ts`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/__tests__/uploadLocalLogs.test.ts`
- Create: `apps/mobile/src/__tests__/performanceFlush.test.ts`

**Interfaces:**
- Consumes: `diagnostics.flush(): Promise<{ sent: number; remaining: number }>` and the existing `PerformanceService.uploadPerformanceBatch` uploader.
- Produces: `flushPerformance(): Promise<{ sent: number; remaining: number }>` and an `UploadLocalLogsResult` containing diagnostic and performance sent/remaining counts.

- [ ] **Step 1: Write failing tests for real performance-flush results**

Add coverage proving that accepted IDs are counted, failed uploads remain pending, and a caller can tell when the queue is empty:

```ts
expect(await flushPerformance()).toEqual({ sent: 2, remaining: 0 });
expect(await flushPerformance()).toEqual({ sent: 0, remaining: 2 });
```

In `performanceFlush.test.ts`, mock `../state/hitherDatabase` with an in-memory row array, mock `expo-crypto`, `expo-constants`, `expo-asset`, and `../native`, then call `configurePerformanceTracing` with an uploader that returns either all IDs or an empty array. Keep this test focused on `flushPerformance`; do not mount React Native.

Run:

```powershell
npm test -- --runInBand performance uploadLocalLogs
```

Expected: FAIL because `flushPerformance` currently returns `void` and `uploadLocalLogs` guesses success.

- [ ] **Step 2: Return observable counts from `flushPerformance`**

Add the minimal public result type:

```ts
export interface PerformanceFlushResult {
  sent: number;
  remaining: number;
}
```

Change `flushInFlight` to `Promise<PerformanceFlushResult> | null`, add one SQL `COUNT(*)` helper for rows where `uploaded_at IS NULL`, and return:

```ts
return {
  sent: accepted.length,
  remaining: await countPending(),
};
```

When the uploader rejects, keep the current retry accounting and return `sent: 0` with the actual remaining count. When another flush is active, await and return the same in-flight result.

- [ ] **Step 3: Drain both queues until empty or no progress**

Replace `MAX_PERFORMANCE_FLUSH_ROUNDS = 3` with the same bounded 50-round ceiling used for diagnostics. In `uploadLocalLogs`, loop on both queue results and stop when either `remaining === 0` or `sent === 0`.

Update the result:

```ts
export interface UploadLocalLogsResult {
  diagnosticSent: number;
  diagnosticRemaining: number;
  performanceSent: number;
  performanceRemaining: number;
}
```

Keep one `manual_log_upload` diagnostic marker so the button press itself is uploaded. Remove the post-drain `manual_log_upload_done` write because it creates a fresh pending log immediately after claiming the queue is empty.

- [ ] **Step 4: Make the sync alert use actual remaining counts**

In `syncFromDatabaseAndUploadLogs`, treat the log upload as complete only when both remaining counts are zero. Keep database refresh authoritative: a log upload failure must not roll back or report database synchronization as failed.

The handler remains:

```ts
await syncFromDatabase();
const result = await uploadLocalLogs({ source: 'destination_reorder_sync' });
```

Use the existing localized success/partial/failure strings; only add parameters if the existing strings cannot show both remaining counts.

- [ ] **Step 5: Run focused tests**

```powershell
npm test -- --runInBand performance uploadLocalLogs gatheringWorkflowContract
```

Expected: PASS, including a test where more than 300 performance rows are drained across batches.

---

### Task 2: Promote the leader-selected navigation destination to the first open slot of its day

**Files:**
- Modify: `apps/mobile/src/utils/tripDay.ts`
- Modify: `apps/mobile/src/screens/MapScreen/hooks/useJourneyNavigation.ts`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/__tests__/tripDay.test.ts`
- Modify: `apps/mobile/src/__tests__/journeyNavigation.test.tsx`
- Modify: `apps/mobile/src/__tests__/navigationIntegration.test.tsx`

**Interfaces:**
- Produces: `promoteDestinationWithinDay(destinations, destinationId)` returning the complete visible reorder payload.
- Consumes: the existing `handleReorder(updates)` optimistic/persisted path and `useGroupState` subscription to `itinerary_items`.

- [ ] **Step 1: Write the failing pure-order tests**

Add these cases to `tripDay.test.ts`:

```ts
expect(
  promoteDestinationWithinDay(
    [dest('d1a', 1, 0), dest('d1b', 1, 1), dest('d2a', 2, 2), dest('d2b', 2, 3)],
    'd2b',
  ).map((item) => item.id),
).toEqual(['d1a', 'd1b', 'd2b', 'd2a']);

expect(
  promoteDestinationWithinDay([dest('a', 1, 4), dest('b', 1, 9)], 'a')
    .map((item) => item.id),
).toEqual(['a', 'b']);
```

Also prove that an unknown destination returns the normal day/order sort unchanged and that no item crosses into another day.

Run:

```powershell
npm test -- --runInBand tripDay
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Add the smallest reusable itinerary helper**

In `tripDay.ts`, sort with the existing `sortDestinationsByDayOrder`, remove the target, and insert it at the first index whose normalized day matches the target day:

```ts
export function promoteDestinationWithinDay(
  destinations: Destination[],
  destinationId: string,
): { id: string; position: number; day: number }[] {
  const sorted = sortDestinationsByDayOrder(destinations);
  const target = sorted.find((item) => item.id === destinationId);
  if (!target) {
    return sorted.map((item, position) => ({
      id: item.id,
      position,
      day: item.day || 1,
    }));
  }
  const day = target.day || 1;
  const withoutTarget = sorted.filter((item) => item.id !== destinationId);
  const dayStart = withoutTarget.findIndex((item) => (item.day || 1) === day);
  const insertAt = dayStart < 0 ? withoutTarget.length : dayStart;
  withoutTarget.splice(insertAt, 0, target);
  return withoutTarget.map((item, position) => ({
    id: item.id,
    position,
    day: item.day || 1,
  }));
}
```

The returned `position` is the visible-order index. `MapScreen.handleReorder` remains responsible for remapping it onto existing open position slots so closed historical stops are not overwritten.

- [ ] **Step 3: Make `handleReorder` report persistence success**

Change its return type to `Promise<boolean>`:

```ts
if (!groupId) return false;
// existing optimistic update
try {
  await reorderDestinations(groupId, persistedUpdates);
  await refresh();
  return true;
} catch (error) {
  // existing alert and rollback
  await refresh();
  return false;
}
```

Manual drag callers may ignore the boolean. Navigation must use it as a gate.

- [ ] **Step 4: Reorder before starting the shared navigation session**

Add this required hook input:

```ts
reorderForNavigation: (
  updates: { id: string; position: number; day: number }[],
) => Promise<boolean>;
```

In the leader branch of `startNavigation`, before `startSession`:

```ts
const updates = promoteDestinationWithinDay(destinations, dest.id);
const nextIndex = updates.findIndex((item) => item.id === dest.id);
if (!(await reorderForNavigation(updates))) {
  throw new Error('destination_reorder_failed');
}
setSelectedIndex(Math.max(0, nextIndex));
await startSession(dest.id, requestRef.current.requestId);
```

Do not reorder for follower local route plans. If persistence fails, clear the optimistic pending target, show the existing failure alert, and do not start navigation. This guarantees the sequential arrival rule sees the promoted stop before navigation becomes active.

- [ ] **Step 5: Keep leader and followers centered on the reordered shared target**

Update the shared-target effect so both leader and followers resolve the target's new index when `destinations` changes. Keep the existing session/destination key guard so it runs once per meaningful target/order transition and does not create a render loop.

Supabase Realtime already watches `itinerary_items`; no new channel is required.

- [ ] **Step 6: Replace the obsolete hook test and prove call ordering**

Replace “does not reorder the persisted itinerary” with tests asserting:

```ts
expect(reorderForNavigation).toHaveBeenCalledWith([
  { id: 'destination-2', position: 0, day: 1 },
  { id: 'destination-1', position: 1, day: 1 },
]);
expect(reorderForNavigation.mock.invocationCallOrder[0])
  .toBeLessThan(startSession.mock.invocationCallOrder[0]);
```

Use a later destination as the clicked target and expect it at position 0. Add a failure case where reorder returns `false` and `startSession` is not called.

Add an integration assertion that, after applying the promoted order, `canMarkDestinationArrival` returns `true` for a solo leader navigating the selected stop. This locks the reported “已抵達 disappears” regression to its root cause rather than adding a solo-only UI exception.

- [ ] **Step 7: Run navigation tests**

```powershell
npm test -- --runInBand tripDay arrivalMarking
npx jest -c jest.config.components.js --runInBand src/__tests__/journeyNavigation.test.tsx src/__tests__/navigationIntegration.test.tsx
```

Expected: PASS. No new Supabase migration or polling path exists.

---

### Task 3: Replace the custom continuous arrival slider with a native stepped control

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/package-lock.json`
- Modify: `apps/mobile/src/state/PreferencesContext.tsx`
- Modify: `apps/mobile/src/components/PrefSlider.tsx`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Create: `apps/mobile/src/__tests__/arrivalRadiusPreference.test.ts`

**Interfaces:**
- Produces: `ARRIVAL_RADIUS_OPTIONS = [30, 50, 100, 300] as const` and a preference value always snapped to one option.
- Consumes: existing `selectionChanged()` haptic helper and `setArrivalRadiusM` persistence.

- [ ] **Step 1: Install the Expo-compatible native slider**

From `apps/mobile`:

```powershell
npx expo install @react-native-community/slider
```

Expected: Expo SDK 54 selects its compatible slider release and updates both package files. Do not manually guess a version if Expo reports a different compatible version.

- [ ] **Step 2: Write failing preference-detent tests**

Create tests for exact values and legacy persisted values:

```ts
expect(ARRIVAL_RADIUS_OPTIONS).toEqual([30, 50, 100, 300]);
expect(clampArrivalRadiusM(30)).toBe(30);
expect(clampArrivalRadiusM(87)).toBe(100);
expect(clampArrivalRadiusM(220)).toBe(300);
expect(clampArrivalRadiusM(Number.NaN)).toBe(50);
```

For an exact midpoint, choose the lower detent consistently to avoid a setting changing back and forth across launches.

Run:

```powershell
npm test -- --runInBand arrivalRadiusPreference
```

Expected: FAIL with the current continuous clamp.

- [ ] **Step 3: Snap stored values to the four supported radii**

Replace the min/max integer clamp with nearest-option selection:

```ts
export const ARRIVAL_RADIUS_OPTIONS = [30, 50, 100, 300] as const;
export const ARRIVAL_RADIUS_MIN_M = ARRIVAL_RADIUS_OPTIONS[0];
export const ARRIVAL_RADIUS_MAX_M = ARRIVAL_RADIUS_OPTIONS.at(-1)!;
export const DEFAULT_ARRIVAL_RADIUS_M = 50;
```

`clampArrivalRadiusM` must return the option with minimum absolute distance and preserve the earlier option on ties.

- [ ] **Step 4: Replace `PanResponder` with the native slider**

`PrefSlider` should wrap `@react-native-community/slider` and map its uniform index to the non-uniform meter values:

```tsx
<Slider
  minimumValue={0}
  maximumValue={values.length - 1}
  step={1}
  value={selectedIndex}
  minimumTrackTintColor={accent}
  maximumTrackTintColor="rgba(120,120,128,0.32)"
  onValueChange={handleIndexChange}
  accessibilityLabel={accessibilityLabel}
/>
```

`handleIndexChange` rounds the index, ignores the current detent, calls `selectionChanged()` exactly once for each changed detent, then calls `onChange(values[index])`. Keep the component name to minimize call-site churn; remove all custom track/thumb/PanResponder code.

- [ ] **Step 5: Pass detents from the tools pane**

Replace `min`/`max` props with:

```tsx
values={ARRIVAL_RADIUS_OPTIONS}
```

The existing visible meter value remains authoritative. Do not add a second setting or duplicate persistence.

- [ ] **Step 6: Run focused validation**

```powershell
npm test -- --runInBand arrivalRadiusPreference
npm run typecheck
```

Expected: PASS. Record that this is a native-binary change and therefore not OTA-safe.

---

### Task 4: Fix the unreadable arrival-radius reminder text at its actual style bug

**Files:**
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/__tests__/mapUiContracts.test.ts`

**Interfaces:**
- Reuses: existing `styles.accuracySubhint`, which already uses `glass.textTertiary`.

- [ ] **Step 1: Add a contract assertion for secondary text color**

Assert that `arrival.radiusHint` is rendered with `styles.accuracySubhint` and that the style uses `glass.textTertiary`.

- [ ] **Step 2: Apply the one-line root fix**

Change:

```tsx
<Text style={styles.accuracyHint}>{t('arrival.radiusHint')}</Text>
```

to:

```tsx
<Text style={styles.accuracySubhint}>{t('arrival.radiusHint')}</Text>
```

`styles.accuracyHint` does not exist, so React Native currently falls back to default black text. Do not add another duplicate style.

- [ ] **Step 3: Run the contract test**

```powershell
npm test -- --runInBand mapUiContracts
```

Expected: PASS.

---

### Task 5: Add a development-only fixed-route location player

**Files:**
- Create: `apps/mobile/src/native/debugLocation.ts`
- Modify: `apps/mobile/src/native/location.ts`
- Modify: `apps/mobile/src/screens/MapScreen/components/DiagnosticsOverlay.tsx`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/i18n/index.ts`
- Create: `apps/mobile/src/__tests__/debugLocation.test.ts`
- Modify: `apps/mobile/src/__tests__/diagnosticsUiContract.test.ts`

**Interfaces:**
- Produces: `startDebugRoute`, `stopDebugRoute`, `getDebugLocationSample`, `isDebugRouteActive`, `subscribeDebugLocation`, and pure `debugRouteSampleAt`.
- Consumes: existing `LocationSample`, `Destination`, `watchLocation`, and `getCurrentLocation` boundaries.

- [ ] **Step 1: Write deterministic route math tests**

Cover start, midpoint, destination, clamping, and playback rate:

```ts
const config = {
  destination: { latitude: 25.05, longitude: 121.52 },
  simulatedDurationMs: 60_000,
  playbackRate: 5,
};

expect(debugRouteSampleAt(config, 0).progress).toBe(0);
expect(debugRouteSampleAt(config, 6_000).progress).toBeCloseTo(0.5);
expect(debugRouteSampleAt(config, 12_000).progress).toBe(1);
```

Also assert that the final coordinate exactly equals the destination and all samples have finite coordinates/timestamps.

Run:

```powershell
npm test -- --runInBand debugLocation
```

Expected: FAIL because the simulator does not exist.

- [ ] **Step 2: Implement one foreground debug-location source**

Use a fixed approximately 600 m north-south line ending at the selected destination, a 1-second emission timer, and linear interpolation:

```ts
// ponytail: straight 600 m route; use a MapKit polyline only if route-shape testing becomes necessary.
const DEBUG_START_LATITUDE_OFFSET = 0.0054;
const EMIT_INTERVAL_MS = 1_000;
```

The controls are:

```ts
export interface DebugRouteConfig {
  destination: Coordinates;
  simulatedDurationMs: number;
  playbackRate: number;
}

export interface DebugRouteFrame {
  coordinates: Coordinates;
  accuracy: number;
  timestamp: number;
  progress: number;
}
```

`debugRouteSampleAt(config, elapsedWallMs, startedAt = 0)` returns `DebugRouteFrame`. `getDebugLocationSample()` strips `progress` structurally by returning the same object as a `LocationSample`-compatible value.

`startDebugRoute` must be a no-op outside `__DEV__`, stop an existing route before starting, emit the first sample immediately, and retain the final destination sample until explicitly stopped. `stopDebugRoute` clears the timer and active state.

- [ ] **Step 3: Route every foreground consumer through the simulator boundary**

At the start of `getCurrentLocation`, return `getDebugLocationSample()` when active.

In `watchLocation`, subscribe `onSample` to debug samples and keep the existing Expo subscription. Ignore real Expo callbacks while debug mode is active, then resume them automatically after debug mode stops:

```ts
const unsubscribeDebug = subscribeDebugLocation(onSample);
const sub = await Location.watchPositionAsync(options, (position) => {
  if (!isDebugRouteActive()) onSample(toSample(position));
});
return () => {
  unsubscribeDebug();
  sub.remove();
};
```

Do not modify `backgroundJourney.ts` or inject mock data into OS background tasks.

- [ ] **Step 4: Add controls to the existing Diagnostics overlay**

Pass the visible `destinations` into `DiagnosticsOverlay`. Render the section only inside `__DEV__`.

Controls:

- Destination: horizontally scrollable chips using active gathering-point titles; default to the current navigation target, otherwise the first destination.
- Simulated trip time: `1 / 5 / 15 / 30` minutes.
- Playback rate: `1x / 5x / 20x`.
- Start and Stop buttons.
- A visible warning that mock coordinates use the normal foreground UI/upload path and should be used only in a test group.

Do not introduce a picker dependency. Use existing `TouchableOpacity`, `ScrollView`, `glass` colors, and accessibility labels.

- [ ] **Step 5: Add localized copy and UI contract coverage**

Add Traditional Chinese and English keys for the debug title, destination, duration, playback rate, start, stop, active state, and test-group warning.

Update `diagnosticsUiContract.test.ts` to require:

```ts
expect(source).toContain('__DEV__');
expect(source).toContain('startDebugRoute');
expect(source).toContain('stopDebugRoute');
expect(source).toContain('debugLocation.warning');
```

- [ ] **Step 6: Run focused tests**

```powershell
npm test -- --runInBand debugLocation diagnosticsUiContract
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Manual development-build verification**

On an iOS Development Build or Expo Go foreground session:

1. Join a test group and open Diagnostics.
2. Select a destination, 5-minute simulated trip, and 20x playback.
3. Start route playback, then start navigation to the same gathering point.
4. Verify the map location moves smoothly, distance decreases, arrival threshold triggers at the selected detent, and Stop returns control to real Expo location.
5. Tap “同步資料庫” and verify the alert reports both database sync and log upload status.

Do not use this result as battery or background-location evidence.

---

### Task 6: Full verification and Codex review handoff

**Files:**
- Review only: every file changed since `7987375`

**Interfaces:**
- Produces: a clean, uncommitted implementation for Codex review.

- [ ] **Step 1: Run all required project checks**

From `apps/mobile`:

```powershell
npm test -- --runInBand
npx jest -c jest.config.components.js --runInBand
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 2: Inspect native dependency health**

```powershell
npx expo-doctor
```

Expected: no incompatible dependency warning for `@react-native-community/slider`.

- [ ] **Step 3: Confirm scope**

From repository root:

```powershell
git status -sb
git diff --stat
git diff --name-only
```

Expected: only files named in this plan plus this plan document. No `.env`, credentials, generated build folders, or battery-policy changes.

- [ ] **Step 4: Stop before release**

Do not commit or push. Return the diff and command results to Codex for review.

After Codex review passes, Codex will send a separate Grok 4.5 effort-low task to use `hither-commit-push-ota`. That release must commit and push explicitly, then stop OTA publication when the package/native change is detected and report that an EAS Build is required.
